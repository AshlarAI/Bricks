//! Long-term memory configuration from a project's `.bricks/config.json`.

use bricks_memory::LongTermMemory;
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;

/// Simplified long-term memory configuration (`memory` in `.bricks/config.json`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
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
struct ConfigJsonMemory {
    #[serde(default)]
    memory: Option<MemoryConfig>,
}

impl MemoryConfig {
    /// Parse `memory` from a JSON config document, returning defaults when absent.
    pub fn from_config_json(text: &str) -> Result<Self, String> {
        let parsed: ConfigJsonMemory = serde_json::from_str(text).map_err(|e| e.to_string())?;
        Ok(parsed.memory.unwrap_or_default())
    }
}

/// A long-term memory and a label that names where it is stored.
type MemoryAndLabel = (Arc<dyn LongTermMemory>, String);

/// The long-term memory, when `memory.enabled` is `true` in `.bricks/config.json`.
pub(crate) fn long_term_memory(wd: &Path) -> Result<Option<MemoryAndLabel>, String> {
    let path = crate::project_config_file(wd);
    let text = match std::fs::read_to_string(&path) {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };
    let cfg =
        MemoryConfig::from_config_json(&text).map_err(|e| format!("{}: {e}", path.display()))?;
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
    fn parses_memory_section_from_config_json() {
        let absent = MemoryConfig::from_config_json(r#"{"agent":{"model":"x/y"}}"#).unwrap();
        assert_eq!(absent, MemoryConfig::default());

        let configured = MemoryConfig::from_config_json(
            r#"{"memory":{"enabled":true,"max_index_notes":50,"max_index_tokens":800}}"#,
        )
        .unwrap();
        assert!(configured.enabled);
        assert_eq!(configured.max_index_notes, 50);
        assert_eq!(configured.max_index_tokens, 800);

        assert!(MemoryConfig::from_config_json(r#"{"memory":{"enabled":"oui"}}"#).is_err());
        assert!(
            MemoryConfig::from_config_json(r#"{"memory":{"unknown_key":1}}"#).is_err(),
            "unknown keys in memory are rejected"
        );
    }
}
