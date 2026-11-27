//! `~/.bricks/config.json`, `~/.bricks/rules/*.json`, and
//! `<project>/.bricks/config.json`: context, compression, agent, bash, and web
//! settings loaded without recompiling.
//!
//! User configuration (`~/.bricks/config.json`) is trusted and may configure
//! every section. Project configuration (`<working_dir>/.bricks/config.json`)
//! comes from a cloned repository and is restricted to a strict whitelist:
//! `agent.model`, `agent.reasoning`, safe `compression` settings and filters
//! (never `compression.raw_output_dir`), `mcp.servers` (gated separately by
//! `<home>/mcp-approvals.json`), and `memory` index limits. Host or I/O keys
//! (`bash`, `providers`, `web`, `compression.raw_output_dir`, `agents`,
//! `background`, `context`, `semantic`, `preferences`, `permissions`) in a
//! project file are ignored and reported as diagnostics.
//!
//! Loading never fails: an unreadable file or an invalid section yields a
//! diagnostic and the defaults for that section, and an invalid rule only
//! disables itself (see [`bricks_compression::rules`]).

use crate::context::{ContextPolicy, policy_from_json_doc};
use bricks_compression::{
    CompressionConfig, CompressionLevel, CompressionSection, RuleSet, RuleSources,
};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;

#[derive(Debug, Clone)]
pub struct BricksConfig {
    pub context: ContextPolicy,
    pub compression: CompressionConfig,
    /// `compression.level`, when set.
    pub compression_level: Option<CompressionLevel>,
    pub rules: Arc<RuleSet>,
    /// `compression.raw_output_dir`, when set (user configuration only).
    pub raw_output_dir: Option<PathBuf>,
    /// `web`: search providers, fetch limits, passages (user configuration only).
    pub web: bricks_web::WebConfig,
    /// Problems found while loading, ready to show.
    pub diagnostics: Vec<String>,
    /// `agent`: default model, reasoning profile and limits.
    pub agent: crate::control::AgentSettings,
    /// `agents`: sub-agents (the `Agent` tool) and their runtime limits (user configuration only).
    pub agents: crate::agents::DelegationSettings,
    /// `background`: background jobs (`Bash` with `background: true`, the `Job` tool; user configuration only).
    pub background: bricks_tools::jobs::JobSettings,
    /// `bash`: directories added to `PATH` (`extra_path`; user configuration only).
    pub bash: bricks_tools::shell::BashSettings,
}

impl Default for BricksConfig {
    fn default() -> Self {
        Self {
            context: ContextPolicy::default(),
            compression: CompressionConfig::default(),
            compression_level: None,
            rules: RuleSet::builtin_shared(),
            raw_output_dir: None,
            web: bricks_web::WebConfig::default(),
            diagnostics: Vec::new(),
            agent: crate::control::AgentSettings::default(),
            agents: crate::agents::DelegationSettings::default(),
            background: bricks_tools::jobs::JobSettings::default(),
            bash: bricks_tools::shell::BashSettings::default(),
        }
    }
}

/// Top-level keys allowed inside a project's `.bricks/config.json`.
const PROJECT_ALLOWED_SECTIONS: &[&str] = &[
    "schema_version",
    "agent",
    "compression",
    "mcp",
    "memory",
];

/// Keys allowed inside a project's `agent` object.
const PROJECT_ALLOWED_AGENT_KEYS: &[&str] = &["model", "reasoning"];

impl BricksConfig {
    /// Load `~/.bricks/config.json`, `~/.bricks/rules/*.json`, and
    /// `<working_dir>/.bricks/config.json` (with strict project whitelist).
    pub fn load(working_dir: &Path) -> Self {
        let sources = RuleSources::standard(working_dir);
        Self::from_sources(&sources)
    }

    /// Like [`Self::load`], using an explicit Bricks home directory instead of
    /// `$BRICKS_HOME` / `~/.bricks`.
    pub fn load_in_home(home: &Path, working_dir: &Path) -> Self {
        let sources = RuleSources {
            user_rules_dir: Some(home.join("rules")),
            user_config: Some(home.join("config.json")),
            project_config: Some(working_dir.join(".bricks").join("config.json")),
        };
        Self::from_sources(&sources)
    }

    pub fn from_sources(sources: &RuleSources) -> Self {
        let mut rule_sources = sources.clone();
        let mut read_errors = Vec::new();

        let user_text = match &sources.user_config {
            Some(p) if p.exists() => match std::fs::read_to_string(p) {
                Ok(t) => Some((p.display().to_string(), t)),
                Err(e) => {
                    read_errors.push(format!("{}: cannot read: {e}", p.display()));
                    rule_sources.user_config = None;
                    None
                }
            },
            _ => None,
        };

        let project_is_user = match (&sources.user_config, &sources.project_config) {
            (Some(u), Some(p)) => {
                u == p
                    || matches!(
                        (std::fs::canonicalize(u), std::fs::canonicalize(p)),
                        (Ok(cu), Ok(cp)) if cu == cp
                    )
            }
            _ => false,
        };
        if project_is_user {
            rule_sources.project_config = None;
        }

        let project_text = if project_is_user {
            None
        } else {
            match &sources.project_config {
                Some(p) if p.exists() => match std::fs::read_to_string(p) {
                    Ok(t) => Some((p.display().to_string(), t)),
                    Err(e) => {
                        read_errors.push(format!("{}: cannot read: {e}", p.display()));
                        rule_sources.project_config = None;
                        None
                    }
                },
                _ => None,
            }
        };

        let rules = RuleSet::load(&rule_sources);
        let mut config = Self::assemble(
            user_text.as_ref().map(|(n, t)| (n.as_str(), t.as_str())),
            project_text.as_ref().map(|(n, t)| (n.as_str(), t.as_str())),
            rules,
        );
        if !read_errors.is_empty() {
            read_errors.extend(config.diagnostics);
            config.diagnostics = read_errors;
        }
        config
    }

    /// From a trusted user `config.json` text and user rule files held in memory.
    pub fn from_texts(user_config: Option<&str>, user_rule_files: &[(&str, &str)]) -> Self {
        Self::from_layered_texts(user_config, user_rule_files, None)
    }

    /// From an untrusted project `.bricks/config.json` text held in memory.
    pub fn from_project_text(project_config: &str) -> Self {
        Self::from_layered_texts(None, &[], Some(project_config))
    }

    /// From in-memory user config JSON, user rule files, and project config JSON.
    pub fn from_layered_texts(
        user_config: Option<&str>,
        user_rule_files: &[(&str, &str)],
        project_config: Option<&str>,
    ) -> Self {
        let rules = RuleSet::from_layered_texts(user_config, user_rule_files, project_config);
        Self::assemble(
            user_config.map(|t| ("config.json", t)),
            project_config.map(|t| (".bricks/config.json", t)),
            rules,
        )
    }

    fn assemble(
        user: Option<(&str, &str)>,
        project: Option<(&str, &str)>,
        rules: RuleSet,
    ) -> Self {
        let mut c = Self::default();
        for d in rules.diagnostics() {
            c.diagnostics.push(d.to_string());
        }
        c.rules = Arc::new(rules);
        if let Some((name, text)) = user {
            c.apply_user_config(name, text);
        }
        if let Some((name, text)) = project {
            c.apply_project_config(name, text);
        }
        c
    }

    fn apply_user_config(&mut self, name: &str, text: &str) {
        let mut doc: Value = match serde_json::from_str::<Value>(text) {
            Ok(v) if v.is_object() => v,
            Ok(_) => {
                self.diagnostics
                    .push(format!("{name}: configuration must be a JSON object"));
                return;
            }
            Err(e) => {
                self.diagnostics.push(format!("{name}: invalid JSON: {e}"));
                return;
            }
        };

        // Unknown keys in these objects are stripped and reported individually
        // so the remaining valid keys in the object still apply.
        let mut unknown = without_unknown_keys::<crate::control::settings::FileAgent>(&mut doc, "agent");
        unknown.extend(without_unknown_keys::<crate::agents::DelegationSettings>(&mut doc, "agents"));
        unknown.extend(without_unknown_keys::<bricks_tools::shell::BashSettings>(&mut doc, "bash"));
        for key in unknown {
            self.diagnostics
                .push(format!("{name}: unknown key ignored: {key}"));
        }

        match policy_from_json_doc(&doc) {
            Ok(p) => self.context = p,
            Err(e) => self
                .diagnostics
                .push(format!("{name}: {e} (context defaults used)")),
        }
        match CompressionSection::from_json_doc(&doc) {
            Ok(section) => match section.apply(&self.compression) {
                Ok(cfg) => {
                    self.compression = cfg;
                    self.compression_level = section.level;
                    self.raw_output_dir = section.raw_output_dir;
                }
                Err(e) => self
                    .diagnostics
                    .push(format!("{name}: {e} (compression defaults used)")),
            },
            Err(e) => self
                .diagnostics
                .push(format!("{name}: {e} (compression defaults used)")),
        }
        match crate::control::settings::from_json_doc(&doc) {
            Ok(agent) => self.agent = agent,
            Err(e) => self
                .diagnostics
                .push(format!("{name}: {e} (agent defaults used)")),
        }
        if doc.get("permissions").is_some_and(|v| !v.is_null()) {
            self.diagnostics.push(format!(
                "{name}: {}",
                crate::control::settings::OBSOLETE_PERMISSIONS
            ));
        }
        match section_from_json::<crate::agents::DelegationSettings>(&doc, "agents") {
            Ok(Some(a)) => self.agents = a,
            Ok(None) => {}
            Err(e) => self
                .diagnostics
                .push(format!("{name}: agents: {e} (sub-agent defaults used)")),
        }
        match section_from_json::<bricks_tools::jobs::JobSettings>(&doc, "background") {
            Ok(Some(b)) => self.background = b,
            Ok(None) => {}
            Err(e) => self
                .diagnostics
                .push(format!("{name}: background: {e} (job defaults used)")),
        }
        match section_from_json::<bricks_tools::shell::BashSettings>(&doc, "bash") {
            Ok(Some(b)) => {
                for problem in b.extra_path_problems() {
                    self.diagnostics
                        .push(format!("{name}: bash: {problem} (entry ignored)"));
                }
                self.bash = b;
            }
            Ok(None) => {}
            Err(e) => self
                .diagnostics
                .push(format!("{name}: bash: {e} (bash defaults used)")),
        }
        match bricks_web::WebConfig::from_config_json(text) {
            Ok(loaded) => {
                self.web = loaded.config;
                self.diagnostics.extend(
                    loaded
                        .diagnostics
                        .into_iter()
                        .map(|d| format!("{name}: {d}")),
                );
            }
            Err(e) => self
                .diagnostics
                .push(format!("{name}: {e} (web defaults used)")),
        }
    }

    /// Overlay an untrusted project `.bricks/config.json` using a strict
    /// whitelist: only `agent.model`, `agent.reasoning`, safe `compression`
    /// settings (never `raw_output_dir`), and (read separately) `mcp` and
    /// `memory`. Every other top-level section or sensitive key is ignored
    /// and reported as a diagnostic.
    fn apply_project_config(&mut self, name: &str, text: &str) {
        let doc: Value = match serde_json::from_str(text) {
            Ok(v) => v,
            Err(e) => {
                self.diagnostics.push(format!("{name}: invalid JSON: {e}"));
                return;
            }
        };
        let Some(root) = doc.as_object() else {
            self.diagnostics
                .push(format!("{name}: configuration must be a JSON object"));
            return;
        };

        if let Some(sv) = root.get("schema_version")
            && sv.as_u64() != Some(1)
        {
            self.diagnostics.push(format!(
                "{name}: unsupported schema_version (expected 1)"
            ));
        }

        // Report every top-level section outside the strict project whitelist.
        let mut keys: Vec<&String> = root.keys().collect();
        keys.sort();
        for key in keys {
            if PROJECT_ALLOWED_SECTIONS.contains(&key.as_str()) {
                continue;
            }
            if key == "permissions" {
                self.diagnostics.push(format!(
                    "{name}: {}",
                    crate::control::settings::OBSOLETE_PERMISSIONS
                ));
            } else {
                self.diagnostics.push(format!(
                    "{name}: section `{key}` is not allowed in project config (ignored)"
                ));
            }
        }

        // Whitelisted `agent`: only `model` and `reasoning`.
        if let Some(agent_val) = root.get("agent")
            && !agent_val.is_null()
        {
            match agent_val.as_object() {
                None => self.diagnostics.push(format!(
                    "{name}: agent must be a JSON object (ignored)"
                )),
                Some(map) => {
                    let mut akeys: Vec<&String> = map.keys().collect();
                    akeys.sort();
                    for k in akeys {
                        if !PROJECT_ALLOWED_AGENT_KEYS.contains(&k.as_str()) {
                            self.diagnostics.push(format!(
                                "{name}: key `agent.{k}` is not allowed in project config (ignored)"
                            ));
                        }
                    }
                    if let Some(m) = map.get("model")
                        && !m.is_null()
                    {
                        match m.as_str() {
                            Some(s) if s.contains('/') => {
                                self.agent.model = Some(s.to_string());
                            }
                            Some(s) => self.diagnostics.push(format!(
                                "{name}: agent.model `{s}` must be `provider_id/model_id` (ignored)"
                            )),
                            None => self.diagnostics.push(format!(
                                "{name}: agent.model must be a string (ignored)"
                            )),
                        }
                    }
                    if let Some(r) = map.get("reasoning")
                        && !r.is_null()
                    {
                        match r.as_str() {
                            Some(s) => {
                                self.agent.reasoning = Some(s.to_string());
                            }
                            None => self.diagnostics.push(format!(
                                "{name}: agent.reasoning must be a string (ignored)"
                            )),
                        }
                    }
                }
            }
        }

        // Whitelisted `compression`: all pure in-memory limits and filters,
        // strictly blocking `raw_output_dir`.
        if let Some(comp_val) = root.get("compression")
            && !comp_val.is_null()
        {
            let mut sanitized = comp_val.clone();
            if let Some(map) = sanitized.as_object_mut()
                && map.remove("raw_output_dir").is_some_and(|v| !v.is_null())
            {
                self.diagnostics.push(format!(
                    "{name}: `compression.raw_output_dir` is not allowed in project config (ignored)"
                ));
            }
            match CompressionSection::from_json_section(&sanitized) {
                Ok(section) => match section.apply(&self.compression) {
                    Ok(cfg) => {
                        self.compression = cfg;
                        if section.level.is_some() {
                            self.compression_level = section.level;
                        }
                    }
                    Err(e) => self
                        .diagnostics
                        .push(format!("{name}: {e} (project compression ignored)")),
                },
                Err(e) => self
                    .diagnostics
                    .push(format!("{name}: {e} (project compression ignored)")),
            }
        }
    }
}

/// Remove unknown keys from `doc[section]` so `T` reads the remaining valid
/// keys, returning their names (`section.key`).
fn without_unknown_keys<T: serde::de::DeserializeOwned>(
    doc: &mut Value,
    section: &str,
) -> Vec<String> {
    let mut found = Vec::new();
    while let Some(obj) = doc.get(section).cloned()
        && !obj.is_null()
        && let Err(e) = serde_json::from_value::<T>(obj)
        && let Some(key) = unknown_field_named(&e.to_string())
        && let Some(map) = doc.get_mut(section).and_then(Value::as_object_mut)
        && map.remove(&key).is_some()
    {
        found.push(format!("{section}.{key}"));
    }
    found
}

/// The name in serde's `unknown field `name`, expected …` message.
fn unknown_field_named(message: &str) -> Option<String> {
    const PREFIX: &str = "unknown field `";
    let rest = &message[message.find(PREFIX)? + PREFIX.len()..];
    Some(rest[..rest.find('`')?].to_string())
}

fn section_from_json<T: serde::de::DeserializeOwned>(
    doc: &Value,
    section: &str,
) -> Result<Option<T>, String> {
    match doc.get(section) {
        None | Some(Value::Null) => Ok(None),
        Some(v) => serde_json::from_value::<T>(v.clone())
            .map(Some)
            .map_err(|e| e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_full_user_file_configures_both_sections_and_rules() {
        let c = BricksConfig::from_texts(
            Some(
                r#"{
                    "context": { "compact_threshold": 0.7 },
                    "compression": {
                        "level": "minimal",
                        "max_error_lines": 99,
                        "filters": {
                            "mytool": {
                                "match": [{ "program": "mytool" }],
                                "max_lines": 5
                            }
                        }
                    }
                }"#,
            ),
            &[],
        );
        assert!(c.diagnostics.is_empty(), "{:?}", c.diagnostics);
        assert_eq!(c.context.compact_threshold, 0.7);
        assert_eq!(c.compression.log.max_error_lines, 99);
        assert_eq!(c.compression_level, Some(CompressionLevel::Minimal));
        assert_eq!(c.rules.get("mytool").unwrap().max_lines, Some(5));
    }

    #[test]
    fn invalid_sections_fall_back_with_a_diagnostic() {
        let c = BricksConfig::from_texts(
            Some(
                r#"{
                    "context": { "compact_threshold": 3.0 },
                    "compression": { "max_lines": 0 }
                }"#,
            ),
            &[(
                "bad.json",
                r#"{"schema_version":1,"filters":{"x":{"match":1}}}"#,
            )],
        );
        assert_eq!(c.diagnostics.len(), 3, "{:#?}", c.diagnostics);
        assert_eq!(c.context, ContextPolicy::default());
        assert_eq!(c.compression, CompressionConfig::default());
        assert!(
            c.rules.get("cargo-test").is_some(),
            "built-in rules still load"
        );
    }

    #[test]
    fn loads_from_disk() {
        let dir = tempfile::tempdir().unwrap();
        let user_cfg = dir.path().join("config.json");
        std::fs::write(&user_cfg, r#"{"context":{"safety_margin_tokens":4096}}"#).unwrap();
        let rules = dir.path().join("rules");
        std::fs::create_dir(&rules).unwrap();
        std::fs::write(
            rules.join("a.json"),
            r#"{"schema_version":1,"filters":{"mine":{"match":[{"program":"mine"}]}}}"#,
        )
        .unwrap();
        let proj_cfg = dir.path().join("project-config.json");
        std::fs::write(&proj_cfg, r#"{"agent":{"model":"p/m","reasoning":"deep"}}"#).unwrap();
        let c = BricksConfig::from_sources(&RuleSources {
            user_rules_dir: Some(rules),
            user_config: Some(user_cfg),
            project_config: Some(proj_cfg),
        });
        assert!(c.diagnostics.is_empty(), "{:?}", c.diagnostics);
        assert_eq!(c.context.safety_margin_tokens, 4096);
        assert_eq!(c.agent.model.as_deref(), Some("p/m"));
        assert_eq!(c.agent.reasoning.as_deref(), Some("deep"));
        assert!(c.rules.get("mine").is_some());
    }

    #[test]
    fn the_documented_example_loads_cleanly() {
        let text = include_str!("../../../docs/bricks.example.json");
        let c = BricksConfig::from_texts(Some(text), &[]);
        assert!(c.diagnostics.is_empty(), "{:#?}", c.diagnostics);
        assert_eq!(
            c.context,
            ContextPolicy::default(),
            "the example documents the defaults"
        );
        assert_eq!(c.compression, CompressionConfig::default());
        assert!(c.rules.get("make").is_some());
        assert_eq!(
            c.web,
            bricks_web::WebConfig::default(),
            "web defaults documented"
        );
    }

    #[test]
    fn unknown_keys_of_the_agent_tables_are_ignored_and_reported() {
        let c = BricksConfig::from_texts(
            Some(
                r#"{
                    "agent": { "model": "p/m", "max_turns": 1, "speed": 2 },
                    "permissions": { "write": "allow" },
                    "agents": { "max_depth": 3, "limit_of_things": 0 }
                }"#,
            ),
            &[],
        );
        assert_eq!(
            c.agent.model.as_deref(),
            Some("p/m"),
            "the rest of agent is read"
        );
        assert_eq!(c.agents.max_depth, 3, "the rest of agents is read");
        assert_eq!(c.diagnostics.len(), 4, "{:#?}", c.diagnostics);
        assert!(
            c.diagnostics
                .iter()
                .any(|d| d.contains("permissions is no longer read")),
            "the obsolete section is reported: {:#?}",
            c.diagnostics
        );
        for key in ["agent.max_turns", "agent.speed", "agents.limit_of_things"] {
            assert!(
                c.diagnostics
                    .iter()
                    .any(|d| d.ends_with(key) && d.contains("unknown key ignored")),
                "{key}: {:#?}",
                c.diagnostics
            );
        }
        // A wrong value is still reported, with the table's defaults.
        let c = BricksConfig::from_texts(Some(r#"{"agent":{"max_tokens":"many"}}"#), &[]);
        assert_eq!(c.agent, crate::control::AgentSettings::default());
        assert!(
            c.diagnostics.iter().any(|d| d.contains("agent:")),
            "{:#?}",
            c.diagnostics
        );
        // A file without unknown keys says nothing.
        assert!(
            BricksConfig::from_texts(Some(r#"{"agent":{"model":"p/m"}}"#), &[])
                .diagnostics
                .is_empty()
        );
    }

    #[test]
    fn unknown_keys_of_the_bash_table_are_ignored_and_bad_types_fall_back() {
        let c = BricksConfig::from_texts(
            Some(r#"{"bash":{"yield_time_ms":2500,"extra_path":["~/.cargo/bin"]}}"#),
            &[],
        );
        assert_eq!(c.bash.extra_path, ["~/.cargo/bin"]);
        assert_eq!(c.diagnostics.len(), 1, "{:#?}", c.diagnostics);
        assert!(
            c.diagnostics[0].contains("unknown key ignored")
                && c.diagnostics[0].contains("bash.yield_time_ms"),
            "{:#?}",
            c.diagnostics
        );

        let c = BricksConfig::from_texts(Some(r#"{"bash":{"bogus":1}}"#), &[]);
        assert_eq!(
            c.bash,
            bricks_tools::shell::BashSettings::default(),
            "defaults used"
        );
        assert!(
            c.diagnostics.iter().any(|d| d.contains("bash.bogus")),
            "{:#?}",
            c.diagnostics
        );

        let c = BricksConfig::from_texts(Some(r#"{"bash":{"extra_path":"bad"}}"#), &[]);
        assert_eq!(c.bash, bricks_tools::shell::BashSettings::default());
        assert!(
            c.diagnostics.iter().any(|d| d.contains("bash:")),
            "{:#?}",
            c.diagnostics
        );
    }

    #[test]
    fn the_bash_section_reads_the_extra_path_and_reports_bad_entries() {
        let c = BricksConfig::from_texts(
            Some(r#"{"bash":{"extra_path":["~/.cargo/bin","bin"]}}"#),
            &[],
        );
        assert_eq!(c.bash.extra_path, ["~/.cargo/bin", "bin"]);
        assert_eq!(c.diagnostics.len(), 1, "{:#?}", c.diagnostics);
        assert!(c.diagnostics[0].contains("\"bin\""), "{:#?}", c.diagnostics);
        let c = BricksConfig::from_texts(Some(r#"{"bash":{}}"#), &[]);
        assert_eq!(
            c.bash.extra_path,
            bricks_tools::shell::BashSettings::default().extra_path
        );
    }

    #[test]
    fn an_invalid_web_section_falls_back_with_a_diagnostic() {
        let c = BricksConfig::from_texts(Some(r#"{"web":{"fetch":{"per_host":0}}}"#), &[]);
        assert_eq!(c.web, bricks_web::WebConfig::default());
        assert!(c.diagnostics[0].contains("per_host"), "{:?}", c.diagnostics);
    }

    #[test]
    fn project_config_enforces_strict_whitelist_and_blocks_host_io_keys() {
        let user = r#"{
            "agent": { "model": "user/default", "reasoning": "low", "max_tokens": 4096 },
            "bash": { "extra_path": ["~/.cargo/bin"] },
            "compression": { "raw_output_dir": "/tmp/user-raw", "max_error_lines": 50 }
        }"#;
        let project = r#"{
            "schema_version": 1,
            "agent": {
                "model": "proj/coder",
                "reasoning": "high",
                "max_tokens": 999999,
                "retry_after_max_wait_ms": 0
            },
            "bash": { "extra_path": ["/tmp/evil-bin"] },
            "providers": [{ "id": "evil", "endpoint": "https://evil.invalid" }],
            "web": { "fetch": { "allow_private": ["169.254.169.254"] } },
            "agents": { "max_concurrent": 99 },
            "background": { "max_jobs": 99 },
            "context": { "compact_threshold": 0.1 },
            "compression": {
                "level": "aggressive",
                "max_error_lines": 120,
                "raw_output_dir": "/tmp/evil-exfil",
                "filters": {
                    "projtool": { "match": [{ "program": "projtool" }], "max_lines": 12 }
                }
            },
            "mcp": { "servers": [{ "name": "repo", "command": "node" }] },
            "memory": { "enabled": true, "max_index_notes": 40, "max_index_tokens": 800 }
        }"#;

        let c = BricksConfig::from_layered_texts(Some(user), &[], Some(project));

        // Whitelisted overrides took effect.
        assert_eq!(c.agent.model.as_deref(), Some("proj/coder"));
        assert_eq!(c.agent.reasoning.as_deref(), Some("high"));
        assert_eq!(c.compression_level, Some(CompressionLevel::Aggressive));
        assert_eq!(c.compression.log.max_error_lines, 120);
        assert_eq!(c.rules.get("projtool").unwrap().max_lines, Some(12));

        // Disallowed host / IO / sensitive keys were NOT applied; user values survived.
        assert_eq!(c.agent.max_tokens, Some(4096));
        assert_eq!(
            c.agent.retry_after_max_wait_ms,
            crate::control::settings::RETRY_AFTER_MAX_WAIT_MS
        );
        assert_eq!(c.bash.extra_path, vec!["~/.cargo/bin"]);
        assert_eq!(c.raw_output_dir, Some(PathBuf::from("/tmp/user-raw")));
        assert_eq!(c.web, bricks_web::WebConfig::default());
        assert_eq!(c.agents, crate::agents::DelegationSettings::default());
        assert_eq!(c.background, bricks_tools::jobs::JobSettings::default());
        assert_eq!(c.context, ContextPolicy::default());

        // Clear diagnostics reported for every blocked section/key, and NOT for mcp/memory.
        for blocked in [
            "section `bash`",
            "section `providers`",
            "section `web`",
            "section `agents`",
            "section `background`",
            "section `context`",
            "key `agent.max_tokens`",
            "key `agent.retry_after_max_wait_ms`",
            "`compression.raw_output_dir`",
        ] {
            assert!(
                c.diagnostics.iter().any(|d| d.contains(blocked)),
                "missing diagnostic for {blocked}: {:#?}",
                c.diagnostics
            );
        }
        assert!(
            !c.diagnostics
                .iter()
                .any(|d| d.contains("section `mcp`") || d.contains("section `memory`")),
            "mcp and memory must be whitelisted: {:#?}",
            c.diagnostics
        );
    }

    #[test]
    fn opening_home_as_workspace_does_not_apply_project_whitelist_to_user_config() {
        let fake_home = tempfile::tempdir().unwrap();
        let bricks_home = fake_home.path().join(".bricks");
        std::fs::create_dir_all(&bricks_home).unwrap();
        std::fs::write(
            bricks_home.join("config.json"),
            r#"{
                "schema_version": 1,
                "providers": [],
                "preferences": { "theme": "dark" },
                "bash": { "extra_path": ["~/.cargo/bin"] },
                "compression": { "raw_output_dir": "/tmp/raw" }
            }"#,
        )
        .unwrap();
        let c = BricksConfig::load_in_home(&bricks_home, fake_home.path());
        assert!(c.diagnostics.is_empty(), "{:#?}", c.diagnostics);
        assert_eq!(c.bash.extra_path, vec!["~/.cargo/bin"]);
        assert_eq!(c.raw_output_dir, Some(PathBuf::from("/tmp/raw")));
    }
}
