//! Long-term memory configuration from a project's `bricks.toml`.

use bricks_memory::LongTermMemory;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;

/// Simplified long-term memory configuration (`[memory]` in `bricks.toml`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct MemoryConfig {
    /// Whether long-term memory is active for the project. Defaults to `false`.
    pub enabled: bool,
    /// Maximum number of notes included in the memory index.
    pub max_index_notes: usize,
    /// Maximum estimated tokens for the memory index.
    pub max_index_tokens: usize,
}

impl Default for MemoryConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            max_index_notes: 200,
            max_index_tokens: 1500,
        }
    }
}

#[derive(Debug, Default, Deserialize)]
struct BricksTomlMemory {
    #[serde(default)]
    memory: Option<MemoryConfig>,
}

impl MemoryConfig {
    /// Parse `[memory]` from a `bricks.toml` document, returning defaults when absent.
    pub fn from_bricks_toml(text: &str) -> Result<Self, String> {
        let parsed: BricksTomlMemory = toml::from_str(text).map_err(|e| e.to_string())?;
        Ok(parsed.memory.unwrap_or_default())
    }
}

/// A long-term memory and a label that names where it is stored.
type MemoryAndLabel = (Arc<dyn LongTermMemory>, String);

/// The long-term memory, when `[memory] enabled = true`.
pub(crate) fn long_term_memory(wd: &Path) -> Result<Option<MemoryAndLabel>, String> {
    let text = match std::fs::read_to_string(wd.join("bricks.toml")) {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let cfg = MemoryConfig::from_bricks_toml(&text).map_err(|e| format!("bricks.toml: {e}"))?;
    if !cfg.enabled {
        return Ok(None);
    }
    let project_dir = wd.join(".bricks").join("memory");
    let global_dir = crate::bricks_home().join("memory").join("global");
    let mem = bricks_memory::ScopedFileMemory::new(
        Some(Arc::new(bricks_memory::FileNoteStore::new(&project_dir))),
        Some(Arc::new(bricks_memory::FileNoteStore::new(global_dir))),
        wd.file_name().map(|n| n.to_string_lossy().into_owned()),
    )
    .with_index_limits(cfg.max_index_notes, cfg.max_index_tokens);
    let label = format!("file memory ({})", project_dir.display());
    Ok(Some((Arc::new(mem), label)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_disabled_with_index_limits() {
        let cfg = MemoryConfig::default();
        assert!(!cfg.enabled);
        assert_eq!(cfg.max_index_notes, 200);
        assert_eq!(cfg.max_index_tokens, 1500);
    }

    #[test]
    fn parses_memory_section_from_bricks_toml() {
        let absent = MemoryConfig::from_bricks_toml("[agent]\nmodel = \"x\"\n").unwrap();
        assert_eq!(absent, MemoryConfig::default());

        let configured = MemoryConfig::from_bricks_toml(
            "[memory]\nenabled = true\nmax_index_notes = 50\nmax_index_tokens = 800\n",
        )
        .unwrap();
        assert!(configured.enabled);
        assert_eq!(configured.max_index_notes, 50);
        assert_eq!(configured.max_index_tokens, 800);

        assert!(MemoryConfig::from_bricks_toml("[memory]\nenabled = \"oui\"\n").is_err());
    }
}
