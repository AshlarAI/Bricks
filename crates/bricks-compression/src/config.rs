//! Compression settings and their `compression` section in JSON configuration.
//!
//! The defaults are starting points chosen for a 100k–200k-token context and
//! typical developer tooling, not universal values; every one can be changed.

use crate::json_view::JsonViewOptions;
use crate::level::CompressionLevel;
use crate::log::LogLimits;
use serde::Deserialize;
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CompressionConfig {
    pub log: LogLimits,
    pub json: JsonViewOptions,
    /// JSON documents at least this large are summarised (`minimal`; the
    /// `aggressive` level uses a quarter of it).
    pub json_summary_min_bytes: usize,
    /// At `aggressive`, source files with at least this many lines are shown
    /// as Tree-sitter skeletons when read without `offset`/`limit`.
    pub skeleton_min_lines: usize,
    /// Hard cap of any tool output entering the context, at every level
    /// (including `off`): longer outputs are cut keeping diagnostics, with a
    /// reference to the full text.
    pub max_output_chars: usize,
    /// Source files larger than this are not re-read from disk for a view.
    pub max_file_bytes: usize,
}

impl Default for CompressionConfig {
    fn default() -> Self {
        Self {
            log: LogLimits::default(),
            json: JsonViewOptions::default(),
            json_summary_min_bytes: 16 * 1024,
            skeleton_min_lines: 150,
            max_output_chars: 40_000,
            max_file_bytes: 4 * 1024 * 1024,
        }
    }
}

/// The `compression` object of a JSON configuration file (rules live in
/// `compression.filters.<id>` and are read by [`crate::rules::RuleSet`]).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CompressionSection {
    pub level: Option<CompressionLevel>,
    pub max_output_chars: Option<usize>,
    pub max_lines: Option<usize>,
    pub max_error_lines: Option<usize>,
    pub max_block_lines: Option<usize>,
    pub context_lines: Option<usize>,
    pub max_line_chars: Option<usize>,
    pub json_summary_min_bytes: Option<usize>,
    pub json_sample_items: Option<usize>,
    pub json_max_depth: Option<usize>,
    pub json_max_keys: Option<usize>,
    pub json_max_string_chars: Option<usize>,
    pub json_max_output_bytes: Option<usize>,
    pub skeleton_min_lines: Option<usize>,
    /// Directory where full outputs are saved (default: a per-session
    /// directory under the system temporary directory). Only allowed in user
    /// configuration; ignored in project configuration.
    pub raw_output_dir: Option<PathBuf>,
    /// Rules; validated separately so one bad rule never rejects the section.
    #[serde(default)]
    pub filters: Option<serde_json::Value>,
}

impl CompressionSection {
    /// Read the `compression` object of a JSON configuration text. A missing
    /// object is the default section.
    pub fn from_config_json(text: &str) -> Result<Self, String> {
        let doc: serde_json::Value =
            serde_json::from_str(text).map_err(|e| format!("invalid JSON: {e}"))?;
        Self::from_json_doc(&doc)
    }

    /// Read the `compression` object from an already-parsed JSON document.
    pub fn from_json_doc(doc: &serde_json::Value) -> Result<Self, String> {
        let Some(obj) = doc.as_object() else {
            return Err("configuration must be a JSON object".into());
        };
        match obj.get("compression") {
            None | Some(serde_json::Value::Null) => Ok(Self::default()),
            Some(v) => Self::from_json_section(v),
        }
    }

    /// Deserialize a `compression` section JSON value directly.
    pub fn from_json_section(v: &serde_json::Value) -> Result<Self, String> {
        serde_path_to_error::deserialize(v).map_err(|e| {
            let path = e.path().to_string();
            format!("compression field `{path}`: {}", e.into_inner())
        })
    }

    /// Apply the section over `base`.
    pub fn apply(&self, base: &CompressionConfig) -> Result<CompressionConfig, String> {
        let mut c = base.clone();
        macro_rules! set {
            ($field:expr, $value:expr, $name:literal) => {
                if let Some(v) = $value {
                    if v == 0 {
                        return Err(format!("[compression] `{}` must be greater than 0", $name));
                    }
                    $field = v;
                }
            };
        }
        set!(
            c.max_output_chars,
            self.max_output_chars,
            "max_output_chars"
        );
        set!(c.log.max_lines, self.max_lines, "max_lines");
        set!(
            c.log.max_error_lines,
            self.max_error_lines,
            "max_error_lines"
        );
        set!(
            c.log.max_block_lines,
            self.max_block_lines,
            "max_block_lines"
        );
        set!(c.log.max_line_chars, self.max_line_chars, "max_line_chars");
        set!(
            c.json_summary_min_bytes,
            self.json_summary_min_bytes,
            "json_summary_min_bytes"
        );
        set!(
            c.json.sample_items,
            self.json_sample_items,
            "json_sample_items"
        );
        set!(c.json.max_depth, self.json_max_depth, "json_max_depth");
        set!(c.json.max_keys, self.json_max_keys, "json_max_keys");
        set!(
            c.json.max_string_chars,
            self.json_max_string_chars,
            "json_max_string_chars"
        );
        set!(
            c.json.max_output_bytes,
            self.json_max_output_bytes,
            "json_max_output_bytes"
        );
        set!(
            c.skeleton_min_lines,
            self.skeleton_min_lines,
            "skeleton_min_lines"
        );
        if let Some(n) = self.context_lines {
            c.log.context_lines = n;
        }
        Ok(c)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn section_overrides_defaults() {
        let s = CompressionSection::from_config_json(
            r#"{
                "compression": {
                    "level": "aggressive",
                    "max_error_lines": 400,
                    "json_sample_items": 5,
                    "filters": {
                        "x": { "match": [{ "program": "x" }] }
                    }
                }
            }"#,
        )
        .unwrap();
        assert_eq!(s.level, Some(CompressionLevel::Aggressive));
        let c = s.apply(&CompressionConfig::default()).unwrap();
        assert_eq!(c.log.max_error_lines, 400);
        assert_eq!(c.json.sample_items, 5);
    }

    #[test]
    fn unknown_fields_and_zero_limits_are_errors() {
        let e = CompressionSection::from_config_json(
            r#"{"compression":{"max_eror_lines":1}}"#,
        )
        .unwrap_err();
        assert!(e.contains("max_eror_lines"), "{e}");
        let s = CompressionSection::from_config_json(
            r#"{"compression":{"max_lines":0}}"#,
        )
        .unwrap();
        assert!(s.apply(&CompressionConfig::default()).is_err());
    }

    #[test]
    fn missing_section_is_default() {
        let s = CompressionSection::from_config_json(
            r#"{"context":{"safety_margin_tokens":1}}"#,
        )
        .unwrap();
        assert!(s.level.is_none());
    }
}
