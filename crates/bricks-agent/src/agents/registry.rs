//! The profile registry: project > user > built-in.
//!
//! * Project profiles are `<workspace>/.bricks/agents/*.md`, where the
//!   workspace is the session's working directory (the folder whose
//!   `bricks.toml` applies); parent folders are not searched.
//! * User profiles are `~/.bricks/agents/*.md`.
//! * Built-in profiles are compiled in and parsed by the same strict parser.
//!
//! A higher scope shadows a lower one by name, **even when it is invalid**:
//! a broken project profile makes that name unavailable with its
//! diagnostic, it is never silently replaced by a user or built-in profile.
//! Two files with the same name in one scope make that name unavailable too.
//! Other profiles stay usable.
//!
//! [`ProfileCatalog`] dynamically reloads profiles from disk on every lookup,
//! list, snapshot, or tool-description formatting call so newly created,
//! edited, or deleted `.bricks/agents/*.md` and `~/.bricks/agents/*.md` files
//! take effect immediately without a restart. Running instances keep the
//! `Arc<AgentProfile>` they were started with.

use super::profile::{
    AgentProfile, ProfileScope, ProfileSource, intended_name, parse_profile, revision_of,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// Files read per scope directory.
pub const MAX_PROFILES_PER_SCOPE: usize = 256;

/// The built-in profiles (`crates/bricks-agent/agents/*.md`).
pub const BUILT_IN: &[(&str, &str)] = &[
    ("general.md", include_str!("../../agents/general.md")),
    ("explore.md", include_str!("../../agents/explore.md")),
];

/// A file found in a scope folder.
enum Found {
    Text {
        label: String,
        path: Option<PathBuf>,
        text: String,
    },
    TooLarge {
        label: String,
        path: PathBuf,
        size: u64,
    },
}

/// Where to look for custom profile files.
#[derive(Debug, Clone, Default)]
pub struct ProfileSources {
    pub project_dir: Option<PathBuf>,
    pub user_dir: Option<PathBuf>,
}

impl ProfileSources {
    /// `<workspace>/.bricks/agents` and `~/.bricks/agents`.
    pub fn standard(workspace: &Path) -> Self {
        Self {
            project_dir: Some(workspace.join(".bricks").join("agents")),
            user_dir: dirs::home_dir().map(|h| h.join(".bricks").join("agents")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileDiagnostic {
    /// File (or `builtin:x.md`).
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone)]
enum Entry {
    Valid(Arc<AgentProfile>),
    Invalid { source: String, error: String },
}

#[derive(Debug, Clone)]
struct Slot {
    scope: ProfileScope,
    entry: Entry,
    /// Lower scopes defining the same name.
    shadows: Vec<(ProfileScope, String)>,
}

/// One line of the catalogue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileListing {
    pub name: String,
    pub description: String,
    pub scope: ProfileScope,
    pub source: String,
    /// Usable (`false`: see `error`).
    pub valid: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Lower-priority definitions of this name, hidden by this one.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub shadows: Vec<String>,
}

/// An immutable snapshot of the profiles at a point in time.
#[derive(Debug, Clone, Default)]
pub struct ProfileRegistry {
    slots: BTreeMap<String, Slot>,
    pub diagnostics: Vec<ProfileDiagnostic>,
}

impl ProfileRegistry {
    /// Built-ins, then user and project profiles over them.
    pub fn load(sources: &ProfileSources) -> Self {
        let mut reg = Self::default();
        let builtins: Vec<Found> = BUILT_IN
            .iter()
            .map(|(f, t)| Found::Text {
                label: format!("builtin:{f}"),
                path: None,
                text: t.to_string(),
            })
            .collect();
        reg.add_scope(ProfileScope::BuiltIn, builtins);
        if let Some(d) = &sources.user_dir {
            let files = reg.read_dir(d);
            reg.add_scope(ProfileScope::User, files);
        }
        if let Some(d) = &sources.project_dir {
            let files = reg.read_dir(d);
            reg.add_scope(ProfileScope::Project, files);
        }
        reg
    }

    /// Only the built-in profiles.
    pub fn built_in() -> Self {
        Self::load(&ProfileSources::default())
    }

    fn read_dir(&mut self, dir: &Path) -> Vec<Found> {
        let rd = match std::fs::read_dir(dir) {
            Ok(rd) => rd,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Vec::new(),
            Err(e) => {
                self.diagnostics.push(ProfileDiagnostic {
                    source: dir.display().to_string(),
                    message: format!("cannot read profile directory: {e}"),
                });
                return Vec::new();
            }
        };
        let mut paths: Vec<PathBuf> = rd
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|e| e == "md") && p.is_file())
            .collect();
        paths.sort();
        if paths.len() > MAX_PROFILES_PER_SCOPE {
            self.diagnostics.push(ProfileDiagnostic {
                source: dir.display().to_string(),
                message: format!(
                    "{} profile files: only the first {MAX_PROFILES_PER_SCOPE} (by name) are read",
                    paths.len()
                ),
            });
            paths.truncate(MAX_PROFILES_PER_SCOPE);
        }
        let mut out = Vec::new();
        for p in paths {
            let label = p.display().to_string();
            let size = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
            if size as usize > super::profile::MAX_PROFILE_BYTES {
                // Still shadows its name: never fall back silently.
                out.push(Found::TooLarge {
                    label,
                    path: p,
                    size,
                });
                continue;
            }
            match std::fs::read_to_string(&p) {
                Ok(text) => out.push(Found::Text {
                    label,
                    path: Some(p),
                    text,
                }),
                Err(e) => self.diagnostics.push(ProfileDiagnostic {
                    source: label,
                    message: format!("cannot read: {e}"),
                }),
            }
        }
        out
    }

    fn add_scope(&mut self, scope: ProfileScope, files: Vec<Found>) {
        let mut here: BTreeMap<String, Vec<(String, Entry)>> = BTreeMap::new();
        for found in files {
            let (label, name, entry) = match found {
                Found::TooLarge { label, path, size } => (
                    label.clone(),
                    stem_of(Some(&path), &label),
                    Entry::Invalid {
                        source: label,
                        error: format!(
                            "{size} bytes: profiles are limited to {} bytes",
                            super::profile::MAX_PROFILE_BYTES
                        ),
                    },
                ),
                Found::Text { label, path, text } => {
                    let stem = stem_of(path.as_deref(), &label);
                    let source = ProfileSource {
                        scope,
                        path,
                        label: label.clone(),
                        revision: revision_of(&text),
                    };
                    match parse_profile(&text, source) {
                        Ok(p) => (label, p.name.clone(), Entry::Valid(Arc::new(p))),
                        Err(e) => (
                            label.clone(),
                            intended_name(&text, &stem),
                            Entry::Invalid {
                                source: label,
                                error: e,
                            },
                        ),
                    }
                }
            };
            if let Entry::Invalid { source, error } = &entry {
                self.diagnostics.push(ProfileDiagnostic {
                    source: source.clone(),
                    message: format!("profile `{name}` is invalid: {error}"),
                });
            }
            here.entry(name).or_default().push((label, entry));
        }
        for (name, mut defs) in here {
            let entry = if defs.len() > 1 {
                let labels: Vec<String> = defs.iter().map(|(l, _)| l.clone()).collect();
                let error = format!(
                    "defined {} times in the {} scope ({}): none is used",
                    defs.len(),
                    scope.as_str(),
                    labels.join(", ")
                );
                self.diagnostics.push(ProfileDiagnostic {
                    source: labels.join(", "),
                    message: format!("profile `{name}`: {error}"),
                });
                Entry::Invalid {
                    source: labels.join(", "),
                    error,
                }
            } else {
                defs.remove(0).1
            };
            let mut shadows = Vec::new();
            if let Some(lower) = self.slots.remove(&name) {
                shadows.push((lower.scope, slot_label(&lower)));
                shadows.extend(lower.shadows);
            }
            self.slots.insert(
                name,
                Slot {
                    scope,
                    entry,
                    shadows,
                },
            );
        }
    }

    /// A usable profile, or why not.
    pub fn get(&self, name: &str) -> Result<Arc<AgentProfile>, String> {
        match self.slots.get(name) {
            Some(Slot {
                entry: Entry::Valid(p),
                ..
            }) => Ok(Arc::clone(p)),
            Some(Slot {
                entry: Entry::Invalid { source, error },
                scope,
                ..
            }) => Err(format!(
                "profile `{name}` ({} scope, {source}) is invalid: {error}",
                scope.as_str()
            )),
            None => {
                let known: Vec<&str> = self
                    .slots
                    .iter()
                    .filter(|(_, s)| matches!(s.entry, Entry::Valid(_)))
                    .map(|(n, _)| n.as_str())
                    .take(40)
                    .collect();
                Err(format!(
                    "no profile `{name}`; available: {}",
                    if known.is_empty() {
                        "(none)".to_string()
                    } else {
                        known.join(", ")
                    }
                ))
            }
        }
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// Every name, by name.
    pub fn list(&self) -> Vec<ProfileListing> {
        self.slots
            .iter()
            .map(|(name, s)| ProfileListing {
                name: name.clone(),
                description: match &s.entry {
                    Entry::Valid(p) => p.description.clone(),
                    Entry::Invalid { .. } => String::new(),
                },
                scope: s.scope,
                source: slot_label(s),
                valid: matches!(s.entry, Entry::Valid(_)),
                error: match &s.entry {
                    Entry::Invalid { error, .. } => Some(error.clone()),
                    Entry::Valid(_) => None,
                },
                shadows: s
                    .shadows
                    .iter()
                    .map(|(sc, l)| format!("{} ({l})", sc.as_str()))
                    .collect(),
            })
            .collect()
    }

    /// Names and descriptions matching `query` (case-insensitive substring;
    /// all when empty), one page of `per_page`. Returns the page and the
    /// number of matches.
    pub fn search(
        &self,
        query: &str,
        page: usize,
        per_page: usize,
    ) -> (Vec<ProfileListing>, usize) {
        let q = query.trim().to_lowercase();
        let all: Vec<ProfileListing> = self
            .list()
            .into_iter()
            .filter(|l| {
                q.is_empty()
                    || l.name.to_lowercase().contains(&q)
                    || l.description.to_lowercase().contains(&q)
            })
            .collect();
        let total = all.len();
        let per = per_page.clamp(1, 100);
        (
            all.into_iter()
                .skip(page.saturating_mul(per))
                .take(per)
                .collect(),
            total,
        )
    }

    /// Maximum byte size of [`Self::format_for_tool`] so large profile folders
    /// cannot blow up every model request or trigger provider schema limits.
    pub const MAX_TOOL_DESCRIPTION_BYTES: usize = 8 * 1024;

    /// Format available profiles (built-ins + custom) for embedding directly into
    /// the `Agent` tool schema/description. Invalid custom profiles are surfaced
    /// explicitly so malformed files are never silently ignored. When the full
    /// rendering exceeds [`Self::MAX_TOOL_DESCRIPTION_BYTES`] (8 KiB), it falls
    /// back to a compact names-only listing.
    pub fn format_for_tool(&self) -> String {
        let mut valid_lines = Vec::new();
        let mut valid_names = Vec::new();
        let mut invalid_lines = Vec::new();
        let mut invalid_names = Vec::new();
        for (name, slot) in &self.slots {
            match &slot.entry {
                Entry::Valid(p) => {
                    let mut attrs = vec![
                        format!("isolation: {}", p.isolation.as_str()),
                        format!("tools: {}", p.tools.summary()),
                    ];
                    if p.permissions != super::profile::ProfilePermissions::Inherit {
                        attrs.push(format!("permissions: {}", p.permissions.as_str()));
                    }
                    if p.model != super::profile::ModelPref::Inherit {
                        attrs.push(format!("model: {}", p.model.label()));
                    }
                    if let Some(effort) = p.requested_effort() {
                        attrs.push(format!("effort: {effort}"));
                    }
                    valid_names.push(name.clone());
                    valid_lines.push(format!(
                        "- `{name}` ({}): {} [{}]",
                        slot.scope.as_str(),
                        p.description,
                        attrs.join(", ")
                    ));
                }
                Entry::Invalid { source, error } => {
                    invalid_names.push(format!("`{name}` ({source})"));
                    invalid_lines.push(format!(
                        "- `{name}` ({}, {source}): {error}",
                        slot.scope.as_str()
                    ));
                }
            }
        }

        let mut out = String::from("Available profiles:\n");
        if valid_lines.is_empty() {
            out.push_str("(none)");
        } else {
            out.push_str(&valid_lines.join("\n"));
        }
        if !invalid_lines.is_empty() {
            out.push_str("\n\nInvalid profiles (fix or remove):\n");
            out.push_str(&invalid_lines.join("\n"));
        }
        if out.len() <= Self::MAX_TOOL_DESCRIPTION_BYTES {
            return out;
        }

        let mut compact = String::from("Available profiles (names only; truncated to 8 KiB):\n");
        if valid_names.is_empty() {
            compact.push_str("(none)");
        } else {
            compact.push_str(&valid_names.join(", "));
        }
        if !invalid_names.is_empty() {
            compact.push_str(&format!(
                "\n\nInvalid profiles ({}; fix or remove): {}",
                invalid_names.len(),
                invalid_names.join(", ")
            ));
        }
        if compact.len() > Self::MAX_TOOL_DESCRIPTION_BYTES {
            const SUFFIX: &str = "...";
            let mut cut = Self::MAX_TOOL_DESCRIPTION_BYTES.saturating_sub(SUFFIX.len());
            while cut > 0 && !compact.is_char_boundary(cut) {
                cut -= 1;
            }
            compact.truncate(cut);
            compact.push_str(SUFFIX);
        }
        compact
    }
}

fn stem_of(path: Option<&Path>, label: &str) -> String {
    path.and_then(|p| p.file_stem())
        .and_then(|s| s.to_str())
        .map(str::to_string)
        .unwrap_or_else(|| {
            label
                .trim_start_matches("builtin:")
                .trim_end_matches(".md")
                .to_string()
        })
}

fn slot_label(s: &Slot) -> String {
    match &s.entry {
        Entry::Valid(p) => p.source.label.clone(),
        Entry::Invalid { source, .. } => source.clone(),
    }
}

/// The dynamic profile catalog of a session.
///
/// Re-reads `.bricks/agents/*.md` and `~/.bricks/agents/*.md` on every lookup,
/// list, snapshot, or tool-description formatting call so newly created
/// directories and updated files are picked up without a restart.
pub struct ProfileCatalog {
    sources: ProfileSources,
    current: parking_lot::RwLock<Arc<ProfileRegistry>>,
}

impl ProfileCatalog {
    pub fn new(sources: ProfileSources) -> Self {
        let reg = ProfileRegistry::load(&sources);
        Self {
            sources,
            current: parking_lot::RwLock::new(Arc::new(reg)),
        }
    }

    /// Dynamically load the latest profile snapshot from disk.
    pub fn snapshot(&self) -> Arc<ProfileRegistry> {
        self.reload()
    }

    /// Explicitly reload profiles from disk. Running instances keep their profiles.
    pub fn reload(&self) -> Arc<ProfileRegistry> {
        let reg = Arc::new(ProfileRegistry::load(&self.sources));
        *self.current.write() = Arc::clone(&reg);
        reg
    }

    /// Look up a profile by name (reloading from disk).
    pub fn get(&self, name: &str) -> Result<Arc<AgentProfile>, String> {
        self.snapshot().get(name)
    }

    /// List all profiles (reloading from disk).
    pub fn list(&self) -> Vec<ProfileListing> {
        self.snapshot().list()
    }

    /// Diagnostics from the latest dynamic load.
    pub fn diagnostics(&self) -> Vec<ProfileDiagnostic> {
        self.snapshot().diagnostics.clone()
    }

    /// Format available profiles for embedding into the `Agent` tool schema/description.
    pub fn format_for_tool(&self) -> String {
        self.snapshot().format_for_tool()
    }

    pub fn sources(&self) -> &ProfileSources {
        &self.sources
    }
}

#[cfg(test)]
mod tests {
    use super::super::profile::{Isolation, ModelPref, ProfilePermissions, ToolPolicy};
    use super::*;

    fn profile(name: &str, desc: &str) -> String {
        format!("---\nname: {name}\ndescription: {desc}\n---\nInstructions of {name} ({desc}).\n")
    }

    #[test]
    fn built_in_general_and_explore_load_through_strict_parser() {
        let reg = ProfileRegistry::built_in();
        assert!(reg.diagnostics.is_empty(), "{:?}", reg.diagnostics);
        let names: Vec<String> = reg.list().into_iter().map(|l| l.name).collect();
        assert_eq!(names, vec!["explore", "general"]);

        let general = reg.get("general").unwrap();
        assert_eq!(general.model, ModelPref::Inherit);
        assert_eq!(general.permissions, ProfilePermissions::Inherit);
        assert_eq!(general.tools, ToolPolicy::Inherit);
        assert_eq!(general.isolation, Isolation::Shared);
        assert!(general.allows_tool("Bash"));
        assert!(general.allows_tool("Write"));
        assert!(general.allows_tool("Edit"));
        assert!(general.allows_tool("Agent"));

        let explore = reg.get("explore").unwrap();
        assert_eq!(explore.model, ModelPref::Inherit);
        assert_eq!(explore.permissions, ProfilePermissions::Inherit);
        assert_eq!(explore.isolation, Isolation::Shared);
        // Bash and read-only tools MUST be allowed in explore.
        assert!(explore.allows_tool("Bash"));
        assert!(explore.allows_tool("Read"));
        assert!(explore.allows_tool("Grep"));
        assert!(explore.allows_tool("Glob"));
        assert!(explore.allows_tool("CodeScout"));
        assert!(explore.allows_tool("memory_read"));
        // Mutating and delegation tools MUST be denied in explore.
        for denied in [
            "Write",
            "Edit",
            "ApplyPatch",
            "Agent",
            "Managent",
            "Messagent",
            "memory_write",
            "memory_update",
            "memory_delete",
        ] {
            assert!(!explore.allows_tool(denied), "explore must deny `{denied}`");
        }
    }

    #[test]
    fn dynamic_loading_sees_newly_created_dir_and_project_overrides_user() {
        let d = tempfile::tempdir().unwrap();
        let proj = d.path().join("project").join(".bricks").join("agents");
        let user = d.path().join("home").join(".bricks").join("agents");
        // Neither directory exists when ProfileCatalog is created.
        let cat = ProfileCatalog::new(ProfileSources {
            project_dir: Some(proj.clone()),
            user_dir: Some(user.clone()),
        });
        assert_eq!(cat.list().len(), 2);
        assert!(cat.get("custom_role").is_err());

        // Create user directory and profile dynamically without restart or reload().
        std::fs::create_dir_all(&user).unwrap();
        std::fs::write(
            user.join("custom_role.md"),
            profile("custom_role", "user version"),
        )
        .unwrap();
        let from_user = cat.get("custom_role").unwrap();
        assert_eq!(from_user.description, "user version");
        assert_eq!(from_user.source.scope, ProfileScope::User);

        // Create project directory and override the same name dynamically.
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(
            proj.join("override.md"),
            profile("custom_role", "project version"),
        )
        .unwrap();
        let from_proj = cat.get("custom_role").unwrap();
        assert_eq!(from_proj.description, "project version");
        assert_eq!(from_proj.source.scope, ProfileScope::Project);

        // Running instances keep the Arc<AgentProfile> they were started with.
        assert_eq!(from_user.description, "user version");

        // Project profile also overrides built-in `explore`.
        std::fs::write(
            proj.join("explore.md"),
            profile("explore", "project explore"),
        )
        .unwrap();
        let explore = cat.get("explore").unwrap();
        assert_eq!(explore.description, "project explore");
        assert_eq!(explore.source.scope, ProfileScope::Project);
        let listing = cat
            .list()
            .into_iter()
            .find(|l| l.name == "custom_role")
            .unwrap();
        assert_eq!(listing.shadows.len(), 1);
        assert!(listing.shadows[0].starts_with("user"));
    }

    #[test]
    fn invalid_or_duplicated_profile_surfaces_explicit_errors_and_never_falls_back() {
        let d = tempfile::tempdir().unwrap();
        let proj = d.path().join("p");
        std::fs::create_dir_all(&proj).unwrap();
        // Invalid project override of a built-in (unknown field + maxTurns).
        std::fs::write(
            proj.join("explore.md"),
            "---\nname: explore\ndescription: d\nmaxTurns: 10\n---\n",
        )
        .unwrap();
        // Misspelled field in another custom file.
        std::fs::write(
            proj.join("typo.md"),
            "---\nname: typo\ndescription: d\nisolationn: shared\n---\n",
        )
        .unwrap();
        // Two files, one name.
        std::fs::write(proj.join("a.md"), profile("twin", "one")).unwrap();
        std::fs::write(proj.join("b.md"), profile("twin", "two")).unwrap();
        // Garbage file named by its stem.
        std::fs::write(proj.join("broken.md"), "not a profile").unwrap();
        std::fs::write(proj.join("ok.md"), profile("ok", "fine")).unwrap();

        let reg = ProfileRegistry::load(&ProfileSources {
            project_dir: Some(proj),
            user_dir: None,
        });
        let e = reg.get("explore").unwrap_err();
        assert!(
            e.contains("project scope") && e.contains("maxTurns") && e.contains("explore.md"),
            "{e}"
        );
        let typo_err = reg.get("typo").unwrap_err();
        assert!(
            typo_err.contains("isolationn") && typo_err.contains("typo.md"),
            "{typo_err}"
        );
        assert!(reg.get("twin").unwrap_err().contains("defined 2 times"));
        assert!(reg.get("broken").is_err());
        assert!(reg.get("ok").is_ok(), "others stay usable");
        assert!(reg.get("general").is_ok());
        assert!(reg.diagnostics.len() >= 4);
        assert!(
            reg.diagnostics
                .iter()
                .any(|d| d.source.ends_with("explore.md"))
        );
        assert!(reg.get("nope").unwrap_err().contains("available"));

        let formatted = reg.format_for_tool();
        assert!(formatted.contains("`general` (built_in)"));
        assert!(formatted.contains("`ok` (project)"));
        assert!(formatted.contains("Invalid profiles"));
        assert!(formatted.contains("maxTurns"));
        assert!(formatted.contains("isolationn"));
    }

    #[test]
    fn format_for_tool_renders_builtins_and_custom_profiles() {
        let d = tempfile::tempdir().unwrap();
        let proj = d.path().join("p");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(
            proj.join("reviewer.md"),
            "---\nname: reviewer\ndescription: Reviews code.\nisolation: worktree\npermissions: read_only\neffort: high\n---\nReview carefully.\n",
        )
        .unwrap();

        let cat = ProfileCatalog::new(ProfileSources {
            project_dir: Some(proj),
            user_dir: None,
        });
        let text = cat.format_for_tool();
        assert!(text.contains("`general` (built_in)"), "{text}");
        assert!(text.contains("`explore` (built_in)"), "{text}");
        assert!(
            text.contains("`reviewer` (project): Reviews code."),
            "{text}"
        );
        assert!(text.contains("isolation: worktree"), "{text}");
        assert!(text.contains("permissions: read_only"), "{text}");
        assert!(text.contains("effort: high"), "{text}");
        assert!(!text.contains("Invalid profiles"), "{text}");
    }

    #[test]
    fn a_huge_page_is_empty_not_a_panic() {
        let reg = ProfileRegistry::built_in();
        let (items, total) = reg.search("", usize::MAX, 20);
        assert!(items.is_empty());
        assert_eq!(total, 2);
    }

    #[test]
    fn search_is_paged() {
        let d = tempfile::tempdir().unwrap();
        let proj = d.path().join("p");
        std::fs::create_dir_all(&proj).unwrap();
        for i in 0..30 {
            std::fs::write(
                proj.join(format!("c{i:02}.md")),
                profile(&format!("custom-{i:02}"), "custom role"),
            )
            .unwrap();
        }
        let reg = ProfileRegistry::load(&ProfileSources {
            project_dir: Some(proj),
            user_dir: None,
        });
        assert_eq!(reg.len(), 32, "2 built-ins + 30 custom profiles");
        let (page, total) = reg.search("custom", 1, 10);
        assert_eq!(total, 30);
        assert_eq!(page.len(), 10);
        assert_eq!(page[0].name, "custom-10");
        let (_, total) = reg.search("no-such-role-zz", 0, 10);
        assert_eq!(total, 0);
        let (p, _) = reg.search("EXPLORATION", 0, 10);
        assert_eq!(p[0].name, "explore");
    }

    #[test]
    fn format_for_tool_caps_at_8_kib_with_names_only_fallback() {
        let d = tempfile::tempdir().unwrap();
        let proj = d.path().join("p");
        std::fs::create_dir_all(&proj).unwrap();
        let long_desc = "x".repeat(600);
        for i in 0..25 {
            std::fs::write(
                proj.join(format!("big-{i:02}.md")),
                profile(&format!("big-{i:02}"), &long_desc),
            )
            .unwrap();
        }
        let reg = ProfileRegistry::load(&ProfileSources {
            project_dir: Some(proj),
            user_dir: None,
        });
        let formatted = reg.format_for_tool();
        assert!(
            formatted.len() <= ProfileRegistry::MAX_TOOL_DESCRIPTION_BYTES,
            "got {} bytes",
            formatted.len()
        );
        assert!(formatted.contains("names only"));
        assert!(formatted.contains("general"));
        assert!(formatted.contains("explore"));
        assert!(formatted.contains("big-00"));
        assert!(formatted.contains("big-24"));
    }
}
