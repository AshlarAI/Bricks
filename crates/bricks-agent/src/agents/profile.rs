//! Agent profiles: Markdown files with a strict YAML frontmatter.
//!
//! ```text
//! ---
//! name: explore
//! description: Read-only exploration and planning sub-agent.
//! model: inherit          # inherit | provider/model
//! effort: inherit         # optional reasoning effort (low | medium | high | inherit | ...)
//! permissions: inherit    # inherit | read_only | ask | execute
//! tools:                  # inherit | { allow: [...] } | { deny: [...] }
//!   deny:
//!     - Write
//!     - Edit
//! isolation: shared       # shared (default) | worktree
//! memory: read_only       # off | read_only | read_write
//! skills: []
//! ---
//! Instructions (the Markdown body, kept verbatim).
//! ```
//!
//! The frontmatter must open the file (`---` on the first line, an optional
//! BOM before it) and close on a line that is exactly `---`. It is parsed
//! with `serde-saphyr` under a small budget (depth, nodes, aliases, scalar
//! bytes); unknown or misspelled keys and duplicate keys are rejected, tags
//! are not executed, and nothing is interpolated from the environment.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Largest profile file.
pub const MAX_PROFILE_BYTES: usize = 64 * 1024;
/// Largest frontmatter.
pub const MAX_FRONTMATTER_BYTES: usize = 8 * 1024;
/// Maximum number of tool names in a single `Allow` or `Deny` list.
pub const MAX_TOOLS_ENTRIES: usize = 256;
/// Maximum number of skills in a profile.
pub const MAX_SKILLS: usize = 32;

const ALLOWED_FRONTMATTER_FIELDS: &str =
    "name, description, tools, permissions, model, effort, isolation, memory, skills";

/// Where a profile comes from, by decreasing priority.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfileScope {
    Project,
    User,
    BuiltIn,
}

impl ProfileScope {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Project => "project",
            Self::User => "user",
            Self::BuiltIn => "built_in",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProfileSource {
    pub scope: ProfileScope,
    /// The file (`None` for a built-in, which is compiled in).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<PathBuf>,
    /// `builtin:<name>.md` or the path, for messages.
    pub label: String,
    /// First 12 hex digits of the SHA-256 of the file.
    pub revision: String,
}

/// The model a profile asks for: `inherit` or `provider_id/model_id`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "value")]
pub enum ModelPref {
    #[default]
    Inherit,
    /// `provider_id/model_id`.
    Explicit(String),
}

impl ModelPref {
    pub fn parse(s: &str) -> Result<Self, String> {
        let s = s.trim();
        match s {
            "inherit" => Ok(Self::Inherit),
            _ if is_selection(s) => Ok(Self::Explicit(s.to_string())),
            _ => Err(format!(
                "model `{s}`: expected `inherit` or `provider_id/model_id`"
            )),
        }
    }

    pub fn label(&self) -> String {
        match self {
            Self::Inherit => "inherit".into(),
            Self::Explicit(s) => s.clone(),
        }
    }
}

fn is_selection(s: &str) -> bool {
    match s.split_once('/') {
        Some((p, m)) => {
            !p.is_empty()
                && !m.is_empty()
                && !s.chars().any(|c| c.is_whitespace() || c.is_control())
        }
        None => false,
    }
}

/// Structured tool filtering policy for a sub-agent profile.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolPolicy {
    #[default]
    Inherit,
    Allow(Vec<String>),
    Deny(Vec<String>),
}

impl ToolPolicy {
    /// Returns `true` when `name` is permitted by this tool policy.
    pub fn allows_tool(&self, name: &str) -> bool {
        match self {
            Self::Inherit => true,
            Self::Allow(allowed) => allowed.iter().any(|t| t == name),
            Self::Deny(denied) => !denied.iter().any(|t| t == name),
        }
    }

    /// Normalize and validate tool entries in `Allow` / `Deny`.
    pub fn validate(&mut self) -> Result<(), String> {
        let list = match self {
            Self::Inherit => return Ok(()),
            Self::Allow(v) | Self::Deny(v) => v,
        };
        if list.len() > MAX_TOOLS_ENTRIES {
            return Err(format!(
                "tools: {} entries exceed the limit of {MAX_TOOLS_ENTRIES}",
                list.len()
            ));
        }
        for entry in list.iter_mut() {
            let trimmed = entry.trim();
            if is_blank(trimmed) || trimmed.chars().any(|c| c.is_whitespace() || c.is_control()) {
                return Err(format!(
                    "tools: invalid tool name `{entry}` (must be a non-empty identifier without whitespace)"
                ));
            }
            *entry = trimmed.to_string();
        }
        Ok(())
    }

    /// Short human-readable description for tool schemas and listings.
    pub fn summary(&self) -> String {
        match self {
            Self::Inherit => "inherit".into(),
            Self::Allow(tools) => format!("allow [{}]", tools.join(", ")),
            Self::Deny(tools) => format!("deny [{}]", tools.join(", ")),
        }
    }
}

/// Permission mode requested by a sub-agent profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProfilePermissions {
    #[default]
    Inherit,
    ReadOnly,
    Ask,
    Execute,
}

impl ProfilePermissions {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "inherit" => Ok(Self::Inherit),
            "read_only" | "readonly" | "read-only" => Ok(Self::ReadOnly),
            "ask" => Ok(Self::Ask),
            "execute" => Ok(Self::Execute),
            other => Err(format!(
                "permissions `{other}`: expected `inherit`, `read_only`, `ask`, or `execute`"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inherit => "inherit",
            Self::ReadOnly => "read_only",
            Self::Ask => "ask",
            Self::Execute => "execute",
        }
    }
}

/// Workspace isolation mode for a sub-agent profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Isolation {
    #[default]
    Shared,
    Worktree,
}

impl Isolation {
    pub fn parse(s: &str) -> Result<Self, String> {
        match s.trim().to_ascii_lowercase().as_str() {
            "shared" => Ok(Self::Shared),
            "worktree" => Ok(Self::Worktree),
            other => Err(format!(
                "isolation `{other}`: expected `shared` or `worktree`"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Shared => "shared",
            Self::Worktree => "worktree",
        }
    }
}

/// Memory access level requested by a sub-agent profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemoryAccess {
    Off,
    #[default]
    ReadOnly,
    ReadWrite,
}

impl MemoryAccess {
    pub fn parse(raw: &str) -> Result<Self, String> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "off" | "none" | "false" => Ok(Self::Off),
            "read" | "read_only" | "readonly" | "ro" => Ok(Self::ReadOnly),
            "read_write" | "readwrite" | "write" | "rw" => Ok(Self::ReadWrite),
            other => Err(format!(
                "memory `{other}`: expected `off`, `read_only`, or `read_write`"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::ReadOnly => "read_only",
            Self::ReadWrite => "read_write",
        }
    }
}

/// Validate an optional reasoning effort identifier (`low`, `medium`, `high`, `inherit`, etc.).
pub fn parse_effort(raw: &str) -> Result<String, String> {
    let s = raw.trim();
    if !s.is_empty()
        && s.len() <= 64
        && s.chars()
            .all(|c| c.is_alphanumeric() || matches!(c, '_' | '-' | '.'))
    {
        Ok(s.to_string())
    } else {
        Err(format!(
            "effort `{raw}`: expected `inherit`, `low`, `medium`, `high`, or a reasoning profile id (1-64 chars: letters, digits, `_`, `-`, `.`)"
        ))
    }
}

/// A parsed, validated sub-agent profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentProfile {
    pub name: String,
    pub description: String,
    pub tools: ToolPolicy,
    pub permissions: ProfilePermissions,
    pub model: ModelPref,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    pub isolation: Isolation,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory: Option<MemoryAccess>,
    pub skills: Vec<String>,
    /// The Markdown body, verbatim.
    pub instructions: String,
    pub source: ProfileSource,
}

impl AgentProfile {
    /// Whether this profile's `tools` policy permits the given tool name.
    pub fn allows_tool(&self, name: &str) -> bool {
        self.tools.allows_tool(name)
    }

    /// Returns `None` when effort is unset or `"inherit"`, otherwise the requested effort value.
    pub fn requested_effort(&self) -> Option<&str> {
        match self.effort.as_deref() {
            None | Some("inherit") => None,
            Some(other) => Some(other),
        }
    }
}

#[derive(Deserialize)]
struct Frontmatter {
    name: String,
    description: String,
    #[serde(default)]
    tools: Option<ToolPolicy>,
    #[serde(default)]
    permissions: Option<String>,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    effort: Option<String>,
    #[serde(default)]
    isolation: Option<String>,
    #[serde(default)]
    memory: Option<String>,
    #[serde(default)]
    skills: Option<Vec<String>>,
    /// Any unknown or misspelled field is captured here and rejected explicitly.
    #[serde(flatten)]
    unknown: BTreeMap<String, serde::de::IgnoredAny>,
}

fn is_blank(s: &str) -> bool {
    s.chars().all(|c| {
        c.is_whitespace()
            || matches!(
                c,
                '\u{180E}' | '\u{200B}' | '\u{200C}' | '\u{200D}' | '\u{2060}' | '\u{FEFF}'
            )
    })
}

/// A profile name: 1-64 of `a-z`, `0-9`, `_`, `-`, starting with a letter
/// or a digit.
pub fn valid_name(name: &str) -> bool {
    let mut chars = name.chars();
    matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c.is_ascii_digit())
        && name.len() <= 64
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

pub fn revision_of(text: &str) -> String {
    Sha256::digest(text.as_bytes())
        .iter()
        .take(6)
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Split `---` frontmatter / body.
pub fn split_frontmatter(text: &str) -> Result<(&str, &str), String> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let first_end = text.find('\n').unwrap_or(text.len());
    if text[..first_end].trim_end() != "---" {
        return Err("the file must start with a `---` line opening the frontmatter".into());
    }
    let rest = &text[(first_end + 1).min(text.len())..];
    let mut offset = 0;
    for line in rest.split_inclusive('\n') {
        if line.trim_end_matches(['\n', '\r']).trim_end() == "---" {
            let front = &rest[..offset];
            let body = &rest[offset + line.len()..];
            return Ok((front, body));
        }
        offset += line.len();
    }
    Err("the frontmatter is not closed by a `---` line".into())
}

fn parse_options() -> serde_saphyr::Options {
    let mut budget = serde_saphyr::Budget::default();
    budget.max_depth = 8;
    budget.max_nodes = 256;
    budget.max_events = 2_048;
    budget.max_aliases = 16;
    budget.max_anchors = 16;
    budget.max_documents = 1;
    budget.max_total_scalar_bytes = 16 * 1024;
    let mut o = serde_saphyr::Options::default();
    o.budget = Some(budget);
    o.duplicate_keys = serde_saphyr::DuplicateKeyPolicy::Error;
    o.reject_unsupported_tags = true;
    o.with_snippet = false;
    o
}

fn is_turn_cap_field(key: &str) -> bool {
    matches!(key, "max_turns" | "maxTurns" | "max-turns")
}

/// Parse and strictly validate a profile file.
pub fn parse_profile(text: &str, source: ProfileSource) -> Result<AgentProfile, String> {
    let file = &source.label;
    if text.len() > MAX_PROFILE_BYTES {
        return Err(format!(
            "{file}: {} bytes: profiles are limited to {MAX_PROFILE_BYTES} bytes",
            text.len()
        ));
    }
    let (front, body) = split_frontmatter(text).map_err(|e| format!("{file}: {e}"))?;
    if front.len() > MAX_FRONTMATTER_BYTES {
        return Err(format!(
            "{file}: frontmatter of {} bytes: limited to {MAX_FRONTMATTER_BYTES} bytes",
            front.len()
        ));
    }
    let mut f: Frontmatter = serde_saphyr::from_str_with_options(front, parse_options())
        .map_err(|e| format!("{file}: frontmatter: {e}"))?;

    if let Some(key) = f.unknown.keys().find(|k| is_turn_cap_field(k)) {
        return Err(format!(
            "{file}: frontmatter field `{key}` is not supported (sub-agents have no turn cap; remove `{key}`)"
        ));
    }
    if let Some(key) = f.unknown.keys().next() {
        return Err(format!(
            "{file}: unknown or misspelled frontmatter field `{key}` (allowed fields: {ALLOWED_FRONTMATTER_FIELDS})"
        ));
    }

    let name = f.name.trim().to_string();
    if !valid_name(&name) {
        return Err(format!(
            "{file}: field `name` (`{}`): must be 1-64 characters among a-z, 0-9, `_`, `-`, starting with a letter or digit",
            f.name
        ));
    }

    let description = f.description.trim().to_string();
    if is_blank(&description) {
        return Err(format!("{file}: field `description` is empty"));
    }
    if description.chars().count() > 1_024 {
        return Err(format!(
            "{file}: field `description` is longer than 1024 characters"
        ));
    }

    let mut tools = f.tools.take().unwrap_or_default();
    tools.validate().map_err(|e| format!("{file}: {e}"))?;

    let permissions = match f.permissions.as_deref() {
        Some(raw) => ProfilePermissions::parse(raw).map_err(|e| format!("{file}: {e}"))?,
        None => ProfilePermissions::Inherit,
    };

    let model = ModelPref::parse(f.model.as_deref().unwrap_or("inherit"))
        .map_err(|e| format!("{file}: {e}"))?;

    let effort = f
        .effort
        .as_deref()
        .map(parse_effort)
        .transpose()
        .map_err(|e| format!("{file}: {e}"))?;

    let isolation = Isolation::parse(f.isolation.as_deref().unwrap_or("shared"))
        .map_err(|e| format!("{file}: {e}"))?;

    let memory = f
        .memory
        .as_deref()
        .map(MemoryAccess::parse)
        .transpose()
        .map_err(|e| format!("{file}: {e}"))?;

    let skills: Vec<String> = f
        .skills
        .unwrap_or_default()
        .into_iter()
        .map(|s| s.trim().to_string())
        .collect();
    if skills.len() > MAX_SKILLS {
        return Err(format!(
            "{file}: field `skills` has more than {MAX_SKILLS} skills"
        ));
    }
    if let Some(s) = skills.iter().find(|s| is_blank(s)) {
        return Err(format!(
            "{file}: field `skills` contains an empty skill `{s}`"
        ));
    }

    Ok(AgentProfile {
        name,
        description,
        tools,
        permissions,
        model,
        effort,
        isolation,
        memory,
        skills,
        instructions: body.to_string(),
        source,
    })
}

/// The name a broken file was meant to define (its `name:` line, else the
/// file stem), so that an invalid file still shadows lower scopes.
pub fn intended_name(text: &str, stem: &str) -> String {
    if let Ok((front, _)) = split_frontmatter(text) {
        for line in front.lines() {
            if let Some(v) = line.strip_prefix("name:") {
                let v = v.trim().trim_matches(['"', '\'']);
                if valid_name(v) {
                    return v.to_string();
                }
            }
        }
    }
    stem.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src() -> ProfileSource {
        ProfileSource {
            scope: ProfileScope::Project,
            path: Some(PathBuf::from(".bricks/agents/test.md")),
            label: ".bricks/agents/test.md".into(),
            revision: "x".into(),
        }
    }

    const GOOD: &str = "---\nname: researcher\ndescription: >\n  Finds things.\nmodel: inherit\neffort: high\npermissions: read_only\ntools:\n  allow:\n    - Read\n    - Grep\n    - Bash\nisolation: worktree\nmemory: read_only\nskills: []\n---\n\n# Researcher\n\nBody with --- inside a line.\n";

    #[test]
    fn parses_a_complete_profile_and_keeps_the_body() {
        let p = parse_profile(GOOD, src()).unwrap();
        assert_eq!(p.name, "researcher");
        assert_eq!(p.description, "Finds things.");
        assert_eq!(p.model, ModelPref::Inherit);
        assert_eq!(p.effort.as_deref(), Some("high"));
        assert_eq!(p.requested_effort(), Some("high"));
        assert_eq!(p.permissions, ProfilePermissions::ReadOnly);
        assert_eq!(
            p.tools,
            ToolPolicy::Allow(vec!["Read".into(), "Grep".into(), "Bash".into()])
        );
        assert!(p.allows_tool("Bash"));
        assert!(p.allows_tool("Read"));
        assert!(!p.allows_tool("Write"));
        assert_eq!(p.isolation, Isolation::Worktree);
        assert_eq!(p.memory, Some(MemoryAccess::ReadOnly));
        assert!(p.skills.is_empty());
        assert_eq!(
            p.instructions,
            "\n# Researcher\n\nBody with --- inside a line.\n"
        );
        // CRLF and a BOM.
        let crlf = format!("\u{feff}{}", GOOD.replace('\n', "\r\n"));
        assert_eq!(parse_profile(&crlf, src()).unwrap().name, "researcher");
    }

    #[test]
    fn defaults_are_applied_when_optional_fields_are_omitted() {
        let p = parse_profile(
            "---\nname: minimal\ndescription: Minimal agent.\n---\nBody\n",
            src(),
        )
        .unwrap();
        assert_eq!(p.tools, ToolPolicy::Inherit);
        assert!(p.allows_tool("Write"));
        assert!(p.allows_tool("Bash"));
        assert_eq!(p.permissions, ProfilePermissions::Inherit);
        assert_eq!(p.model, ModelPref::Inherit);
        assert_eq!(p.effort, None);
        assert_eq!(p.requested_effort(), None);
        assert_eq!(p.isolation, Isolation::Shared);
        assert_eq!(p.memory, None);
        assert!(p.skills.is_empty());
    }

    #[test]
    fn tool_policy_inherit_allow_and_deny() {
        let inherit =
            parse_profile("---\nname: a\ndescription: d\ntools: inherit\n---\n", src()).unwrap();
        assert_eq!(inherit.tools, ToolPolicy::Inherit);
        assert!(inherit.allows_tool("Bash"));
        assert!(inherit.allows_tool("Write"));

        let allow = parse_profile(
            "---\nname: a\ndescription: d\ntools:\n  allow: [Read, Bash]\n---\n",
            src(),
        )
        .unwrap();
        assert!(allow.allows_tool("Read"));
        assert!(allow.allows_tool("Bash"));
        assert!(!allow.allows_tool("Write"));

        let deny = parse_profile(
            "---\nname: a\ndescription: d\ntools:\n  deny: [Write, Edit]\n---\n",
            src(),
        )
        .unwrap();
        assert!(deny.allows_tool("Bash"));
        assert!(deny.allows_tool("Read"));
        assert!(!deny.allows_tool("Write"));
        assert!(!deny.allows_tool("Edit"));
    }

    #[test]
    fn strict_yaml_rejects_unknown_misspelled_and_max_turns_with_file_and_field() {
        let with = |extra: &str| format!("---\nname: a\ndescription: d\n{extra}---\nbody\n");

        for field in ["max_turns", "maxTurns", "max-turns"] {
            let err = parse_profile(&with(&format!("{field}: 25\n")), src()).unwrap_err();
            assert!(
                err.contains(".bricks/agents/test.md") && err.contains(field),
                "expected file and field `{field}` in error: {err}"
            );
            assert!(err.contains("no turn cap"), "{err}");
        }

        for (extra, field) in [
            ("colour: red\n", "colour"),
            ("toools: inherit\n", "toools"),
            ("permission: ask\n", "permission"),
            ("reasoning: high\n", "reasoning"),
            ("background: true\n", "background"),
        ] {
            let err = parse_profile(&with(extra), src()).unwrap_err();
            assert!(
                err.contains(".bricks/agents/test.md") && err.contains(field),
                "expected file and field `{field}` in error: {err}"
            );
        }
    }

    #[test]
    fn rejects_invalid_values_and_malformed_frontmatter() {
        let with = |extra: &str| format!("---\nname: a\ndescription: d\n{extra}---\nbody\n");
        for (extra, needle) in [
            ("permissions: allow_all\n", "permissions"),
            ("tools: all\n", "frontmatter"),
            ("tools: [Read]\n", "frontmatter"),
            ("tools:\n  allow: [Read]\n  deny: [Write]\n", "frontmatter"),
            ("tools:\n  allow: [\"\"]\n", "invalid tool name"),
            ("model: gpt\n", "provider_id/model_id"),
            ("model: auto\n", "provider_id/model_id"),
            ("effort: \"very high\"\n", "effort"),
            ("effort: \"\"\n", "effort"),
            ("isolation: auto\n", "shared"),
            ("isolation: vm\n", "shared"),
            ("name: b\n", "duplicate"),
            ("skills: [\" \"]\n", "empty"),
            ("memory: admin\n", "memory"),
        ] {
            let e = parse_profile(&with(extra), src()).unwrap_err();
            assert!(
                e.to_lowercase().contains(&needle.to_lowercase()),
                "{extra}: {e}"
            );
            assert!(e.contains(".bricks/agents/test.md"), "{extra}: {e}");
        }
        assert!(parse_profile("no frontmatter", src()).is_err());
        assert!(
            parse_profile("---\nname: a\n", src())
                .unwrap_err()
                .contains("not closed")
        );
        assert!(parse_profile("---\nname: A B\ndescription: d\n---\n", src()).is_err());
        assert!(parse_profile("---\nname: a\ndescription: \"  \"\n---\n", src()).is_err());
        assert!(parse_profile("---\nname: a\n---\n", src()).is_err());
        assert!(parse_profile("---\ndescription: d\n---\n", src()).is_err());
    }

    #[test]
    fn permission_and_model_and_effort_variants() {
        for (raw, expected) in [
            ("inherit", ProfilePermissions::Inherit),
            ("read_only", ProfilePermissions::ReadOnly),
            ("ask", ProfilePermissions::Ask),
            ("execute", ProfilePermissions::Execute),
        ] {
            let p = parse_profile(
                &format!("---\nname: a\ndescription: d\npermissions: {raw}\n---\n"),
                src(),
            )
            .unwrap();
            assert_eq!(p.permissions, expected);
        }

        let explicit = parse_profile(
            "---\nname: a\ndescription: d\nmodel: anthropic/claude-sonnet-4\neffort: inherit\n---\n",
            src(),
        )
        .unwrap();
        assert_eq!(
            explicit.model,
            ModelPref::Explicit("anthropic/claude-sonnet-4".into())
        );
        assert_eq!(explicit.effort.as_deref(), Some("inherit"));
        assert_eq!(explicit.requested_effort(), None);
    }

    #[test]
    fn bounded_yaml() {
        // Alias expansion ("billion laughs") stays within the budget.
        let mut bomb =
            String::from("---\nname: a\ndescription: d\nskills: &a [x, x, x, x, x, x, x, x]\n");
        for i in 0..20 {
            bomb.push_str(&format!("k{i}: &b{i} [*a, *a, *a, *a, *a, *a, *a, *a]\n"));
        }
        bomb.push_str("---\n");
        assert!(parse_profile(&bomb, src()).is_err());
        // Deep nesting.
        let deep = format!(
            "---\nname: a\ndescription: {}x{}\n---\n",
            "[".repeat(50),
            "]".repeat(50)
        );
        assert!(parse_profile(&deep, src()).is_err());
        // Size.
        let big = format!(
            "---\nname: a\ndescription: d\n---\n{}",
            "x".repeat(MAX_PROFILE_BYTES)
        );
        assert!(parse_profile(&big, src()).unwrap_err().contains("limited"));
        // A tag is data at most, never executed; an unknown one is refused.
        assert!(
            parse_profile("---\nname: a\ndescription: !!python/object x\n---\n", src()).is_err()
        );
        // No environment interpolation.
        let p = parse_profile("---\nname: a\ndescription: ${HOME}\n---\n", src()).unwrap();
        assert_eq!(p.description, "${HOME}");
    }

    #[test]
    fn intended_name_of_a_broken_file() {
        assert_eq!(
            intended_name("---\nname: x1\ncolour: [\n---\n", "file"),
            "x1"
        );
        assert_eq!(intended_name("garbage", "file"), "file");
    }

    #[test]
    fn memory_access_frontmatter_parses_and_rejects_invalid_values() {
        let p = parse_profile(
            "---\nname: a\ndescription: d\nmemory: read_write\n---\n",
            src(),
        )
        .unwrap();
        assert_eq!(p.memory, Some(MemoryAccess::ReadWrite));

        let p = parse_profile("---\nname: a\ndescription: d\nmemory: off\n---\n", src()).unwrap();
        assert_eq!(p.memory, Some(MemoryAccess::Off));

        let p = parse_profile("---\nname: a\ndescription: d\n---\n", src()).unwrap();
        assert_eq!(p.memory, None);

        assert!(
            parse_profile("---\nname: a\ndescription: d\nmemory: admin\n---\n", src()).is_err()
        );
    }
}
