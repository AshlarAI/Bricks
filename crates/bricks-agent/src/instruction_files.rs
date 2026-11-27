//! Differential instruction file loader (`AGENTS.md`) using SHA-256 hashes.

use crate::system_prompt::{escape_data, neutralize_boundary};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

const INSTRUCTION_FILE_NAME: &str = "AGENTS.md";
const MAX_WALK_DEPTH: usize = 4;
const MAX_WALK_ENTRIES: usize = 2_000;

/// Result of inspecting workspace instruction files (`AGENTS.md`) for changes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InstructionUpdate {
    /// No instruction files exist, or none changed since the previous check.
    Unchanged,
    /// Full set of instruction files (first turn or after compaction).
    Full(String),
    /// Only added, modified, or removed instruction files since the last turn.
    Delta(String),
}

/// Tracks SHA-256 digests of workspace `AGENTS.md` files across turns so only
/// initial snapshots, post-compaction refreshes, or changed files consume tokens.
#[derive(Debug, Clone)]
pub struct InstructionFilesState {
    hashes: BTreeMap<PathBuf, [u8; 32]>,
    needs_full: bool,
    stale: bool,
}

impl Default for InstructionFilesState {
    fn default() -> Self {
        Self::new()
    }
}

impl InstructionFilesState {
    /// Create a fresh tracker that will emit [`InstructionUpdate::Full`] on the
    /// next collection (when instruction files exist).
    pub fn new() -> Self {
        Self {
            hashes: BTreeMap::new(),
            needs_full: true,
            stale: true,
        }
    }

    /// Force the next collection to re-scan and emit [`InstructionUpdate::Full`]
    /// (for example after conversation compaction clears prior context).
    pub fn mark_compacted(&mut self) {
        self.needs_full = true;
        self.stale = true;
    }

    /// Mark workspace instruction files as potentially modified (user turn start
    /// or mutative tool execution) so the next turn re-checks SHA-256 digests.
    pub fn mark_stale(&mut self) {
        self.stale = true;
    }

    /// Whether a filesystem scan is needed before the next request.
    pub fn is_dirty(&self) -> bool {
        self.stale || self.needs_full
    }

    /// Discover `AGENTS.md` files for `working_dir`, compare SHA-256 hashes
    /// against the last seen snapshot, and emit only what needs to be sent.
    pub fn collect(&mut self, working_dir: &Path) -> InstructionUpdate {
        let discovered = discover(working_dir);
        self.apply_discovered(working_dir, discovered)
    }

    /// Diff an already-discovered map of `AGENTS.md` files against the tracked
    /// digests and clear the `stale` flag.
    fn apply_discovered(
        &mut self,
        working_dir: &Path,
        discovered: BTreeMap<PathBuf, ([u8; 32], String)>,
    ) -> InstructionUpdate {
        let next_hashes: BTreeMap<PathBuf, [u8; 32]> = discovered
            .iter()
            .map(|(path, (hash, _))| (path.clone(), *hash))
            .collect();
        self.stale = false;

        if self.needs_full {
            self.hashes = next_hashes;
            self.needs_full = false;
            if discovered.is_empty() {
                return InstructionUpdate::Unchanged;
            }
            return InstructionUpdate::Full(render_full(&discovered, working_dir));
        }

        let mut changed = Vec::new();
        for (path, (hash, content)) in &discovered {
            if self.hashes.get(path) != Some(hash) {
                changed.push((path.as_path(), content.as_str()));
            }
        }
        let mut removed = Vec::new();
        for path in self.hashes.keys() {
            if !next_hashes.contains_key(path) {
                removed.push(path.as_path());
            }
        }

        if changed.is_empty() && removed.is_empty() {
            return InstructionUpdate::Unchanged;
        }

        let delta = render_delta(&changed, &removed, working_dir);
        self.hashes = next_hashes;
        InstructionUpdate::Delta(delta)
    }
}

fn discover(working_dir: &Path) -> BTreeMap<PathBuf, ([u8; 32], String)> {
    let mut files = BTreeMap::new();
    if !working_dir.is_dir() {
        return files;
    }

    // Walk ancestor directories from the nearest `.git` root down to `working_dir`.
    if let Some(repo_root) = working_dir.ancestors().find(|d| d.join(".git").exists()) {
        let mut chain: Vec<&Path> = working_dir
            .ancestors()
            .take_while(|d| *d != repo_root)
            .collect();
        chain.push(repo_root);
        chain.reverse();
        for dir in chain {
            insert_if_present(&dir.join(INSTRUCTION_FILE_NAME), &mut files);
        }
    } else {
        insert_if_present(&working_dir.join(INSTRUCTION_FILE_NAME), &mut files);
    }

    // Walk nested subdirectories under `working_dir` respecting `.gitignore`.
    let walker = ignore::WalkBuilder::new(working_dir)
        .max_depth(Some(MAX_WALK_DEPTH))
        .standard_filters(true)
        .build();
    for (visited, entry) in walker.flatten().enumerate() {
        if visited >= MAX_WALK_ENTRIES {
            break;
        }
        if entry.file_type().is_some_and(|ft| ft.is_file())
            && entry.file_name() == INSTRUCTION_FILE_NAME
        {
            insert_if_present(entry.path(), &mut files);
        }
    }

    files
}

fn insert_if_present(path: &Path, out: &mut BTreeMap<PathBuf, ([u8; 32], String)>) {
    if out.contains_key(path) {
        return;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return;
    };
    let digest: [u8; 32] = Sha256::digest(&bytes).into();
    let content = String::from_utf8_lossy(&bytes).into_owned();
    out.insert(path.to_path_buf(), (digest, content));
}

fn display_path(path: &Path, working_dir: &Path) -> String {
    path.strip_prefix(working_dir)
        .unwrap_or(path)
        .display()
        .to_string()
}

fn render_full(files: &BTreeMap<PathBuf, ([u8; 32], String)>, working_dir: &Path) -> String {
    let mut out = String::from("<project_instructions>");
    for (path, (_, content)) in files {
        let label = escape_data(&display_path(path, working_dir));
        let body = neutralize_boundary(content.trim_end());
        out.push_str(&format!(
            "\n<instruction_file path=\"{label}\">\n{body}\n</instruction_file>"
        ));
    }
    out.push_str("\n</project_instructions>");
    out
}

fn render_delta(changed: &[(&Path, &str)], removed: &[&Path], working_dir: &Path) -> String {
    let mut out = String::from("<project_instructions delta=\"true\">");
    for &(path, content) in changed {
        let label = escape_data(&display_path(path, working_dir));
        let body = neutralize_boundary(content.trim_end());
        out.push_str(&format!(
            "\n<instruction_file path=\"{label}\" status=\"updated\">\n{body}\n</instruction_file>"
        ));
    }
    for &path in removed {
        let label = escape_data(&display_path(path, working_dir));
        out.push_str(&format!(
            "\n<instruction_file path=\"{label}\" status=\"removed\" />"
        ));
    }
    out.push_str("\n</project_instructions>");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_workspace_returns_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let mut state = InstructionFilesState::new();
        assert_eq!(state.collect(dir.path()), InstructionUpdate::Unchanged);
        assert_eq!(state.collect(dir.path()), InstructionUpdate::Unchanged);
    }

    #[test]
    fn full_then_unchanged_then_modified_then_removed_then_compacted() {
        let dir = tempfile::tempdir().unwrap();
        let root_agents = dir.path().join("AGENTS.md");
        let sub_dir = dir.path().join("crates/core");
        std::fs::create_dir_all(&sub_dir).unwrap();
        let sub_agents = sub_dir.join("AGENTS.md");

        std::fs::write(&root_agents, "Root rule 1").unwrap();
        std::fs::write(&sub_agents, "Sub rule 1").unwrap();

        let mut state = InstructionFilesState::new();

        // First collect emits Full with both files.
        let first = state.collect(dir.path());
        let InstructionUpdate::Full(full_text) = first else {
            panic!("expected Full, got {first:?}");
        };
        assert!(full_text.contains("path=\"AGENTS.md\""));
        assert!(full_text.contains("Root rule 1"));
        assert!(full_text.contains("path=\"crates/core/AGENTS.md\""));
        assert!(full_text.contains("Sub rule 1"));

        // Repeat without edits emits Unchanged.
        assert_eq!(state.collect(dir.path()), InstructionUpdate::Unchanged);

        // Modify only sub_agents -> Delta includes only sub_agents.
        std::fs::write(&sub_agents, "Sub rule 2").unwrap();
        let mod_update = state.collect(dir.path());
        let InstructionUpdate::Delta(delta_text) = mod_update else {
            panic!("expected Delta, got {mod_update:?}");
        };
        assert!(delta_text.contains("crates/core/AGENTS.md"));
        assert!(delta_text.contains("Sub rule 2"));
        assert!(!delta_text.contains("Root rule 1"));

        // Repeat emits Unchanged.
        assert_eq!(state.collect(dir.path()), InstructionUpdate::Unchanged);

        // Remove sub_agents -> Delta includes removed notice.
        std::fs::remove_file(&sub_agents).unwrap();
        let rem_update = state.collect(dir.path());
        let InstructionUpdate::Delta(rem_text) = rem_update else {
            panic!("expected Delta, got {rem_update:?}");
        };
        assert!(rem_text.contains("crates/core/AGENTS.md"));
        assert!(rem_text.contains("status=\"removed\""));
        assert!(!rem_text.contains("Root rule 1"));

        // Compaction forces Full again on next collect.
        state.mark_compacted();
        let after_compact = state.collect(dir.path());
        let InstructionUpdate::Full(compact_text) = after_compact else {
            panic!("expected Full after mark_compacted, got {after_compact:?}");
        };
        assert!(compact_text.contains("Root rule 1"));
        assert!(!compact_text.contains("crates/core/AGENTS.md"));
    }

    #[test]
    fn discovers_ancestor_agents_inside_git_repo_when_working_in_subdir() {
        let repo = tempfile::tempdir().unwrap();
        std::fs::create_dir(repo.path().join(".git")).unwrap();
        std::fs::write(repo.path().join("AGENTS.md"), "Repo root rule").unwrap();
        let subdir = repo.path().join("packages/app");
        std::fs::create_dir_all(&subdir).unwrap();
        std::fs::write(subdir.join("AGENTS.md"), "App rule").unwrap();

        let mut state = InstructionFilesState::new();
        let InstructionUpdate::Full(text) = state.collect(&subdir) else {
            panic!("expected Full");
        };
        assert!(text.contains("Repo root rule"));
        assert!(text.contains("App rule"));
    }
}
