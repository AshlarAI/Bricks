//! MCP servers, as every frontend reads them: the person's own, under
//! `mcp.servers` in `<home>/config.json`, and the project's, declared under
//! `mcp.servers` in `<project>/.bricks/config.json`. A server a repository
//! declares is connected only once the person approved it, as declared: a
//! changed declaration (command, arguments, URL, headers…) is asked again.
//! Approvals are kept in `<home>/mcp-approvals.json`, never in the repository.

use bricks_mcp::McpServerConfig;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};

/// One server and whether it is used.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ServerEntry {
    #[serde(flatten)]
    pub config: McpServerConfig,
    #[serde(default = "yes", skip_serializing_if = "is_true")]
    pub enabled: bool,
}

fn yes() -> bool {
    true
}

fn is_true(b: &bool) -> bool {
    *b
}

impl ServerEntry {
    pub fn new(config: McpServerConfig) -> Self {
        Self {
            config,
            enabled: true,
        }
    }

    /// What the approval of a project server covers: everything that says
    /// what runs or where it connects.
    pub fn fingerprint(&self) -> String {
        // Keys sorted at every level: maps (env, headers) have no order.
        let text = serde_json::to_value(&self.config)
            .map(|v| canonical(&v))
            .unwrap_or_default();
        let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
        for byte in text.bytes() {
            hash ^= u64::from(byte);
            hash = hash.wrapping_mul(0x0100_0000_01b3);
        }
        format!("{hash:016x}")
    }
}

/// JSON text with object keys sorted, at every level.
fn canonical(value: &Value) -> String {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let fields: Vec<String> = keys
                .into_iter()
                .map(|k| format!("{}:{}", Value::String(k.clone()), canonical(&map[k])))
                .collect();
            format!("{{{}}}", fields.join(","))
        }
        Value::Array(items) => {
            format!(
                "[{}]",
                items.iter().map(canonical).collect::<Vec<_>>().join(",")
            )
        }
        other => other.to_string(),
    }
}

/// Where a server is declared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    /// `<home>/config.json`: the person's own.
    User,
    /// `<project>/.bricks/config.json`.
    Project,
}

/// The person's decision on a server a project declares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    /// Not decided yet, or declared differently since: not connected.
    Pending,
    Approved,
    Denied,
}

/// A server as listed: where it comes from and, for a project's, the decision.
#[derive(Debug, Clone, PartialEq)]
pub struct ServerView {
    pub entry: ServerEntry,
    pub source: Source,
    /// `None` for the person's own servers.
    pub decision: Option<Decision>,
    /// Hidden by a server of the person's with the same name.
    pub shadowed: bool,
}

impl ServerView {
    /// Connected at the next session: enabled and, for a project's, approved.
    pub fn active(&self) -> bool {
        self.entry.enabled
            && !self.shadowed
            && match self.source {
                Source::User => true,
                Source::Project => self.decision == Some(Decision::Approved),
            }
    }
}

/// The servers of a home and a project.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Selection {
    pub servers: Vec<ServerView>,
    /// Files that could not be read, servers that are not valid.
    pub errors: Vec<String>,
}

impl Selection {
    /// The servers to connect, valid ones only.
    pub fn active(&self) -> Vec<McpServerConfig> {
        self.servers
            .iter()
            .filter(|s| s.active() && s.entry.config.validate().is_ok())
            .map(|s| s.entry.config.clone())
            .collect()
    }

    /// The project's servers that wait for the person's decision.
    pub fn pending(&self) -> Vec<&ServerView> {
        self.servers
            .iter()
            .filter(|s| {
                s.source == Source::Project && s.decision == Some(Decision::Pending) && !s.shadowed
            })
            .collect()
    }
}

// ─── Shared JSON section shape ───────────────────────────────────────────────

#[derive(Debug, Default, Deserialize)]
struct ConfigFileMcp {
    #[serde(default)]
    mcp: Option<McpSection>,
}

#[derive(Debug, Default, Deserialize)]
struct McpSection {
    #[serde(default)]
    servers: Vec<ServerEntry>,
}

// ─── The person's file (`<home>/config.json`) ────────────────────────────────

pub fn user_file(home: &Path) -> PathBuf {
    home.join("config.json")
}

/// The person's servers; an absent file has none, an invalid one is an error.
pub fn read_user(home: &Path) -> Result<Vec<ServerEntry>, String> {
    let _guard = crate::user_config_lock().lock();
    read_user_unlocked(home)
}

fn sanitize_json_error(e: &serde_json::Error) -> String {
    let msg = e.to_string();
    for prefix in ["invalid type: ", "invalid value: "] {
        if let Some(rest) = msg.strip_prefix(prefix) {
            let kind = rest.split([' ', ',']).next().unwrap_or("value");
            let expected = rest.find(", expected").map(|i| &rest[i..]).unwrap_or("");
            return format!("wrong type (got {kind}){expected}");
        }
    }
    if let Some(rest) = msg.strip_prefix("unknown variant ") {
        let expected = rest.find(", expected").map(|i| &rest[i..]).unwrap_or("");
        return format!("unknown value{expected}");
    }
    msg
}

fn read_user_unlocked(home: &Path) -> Result<Vec<ServerEntry>, String> {
    let path = user_file(home);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<ConfigFileMcp>(&text)
            .map(|f| f.mcp.map(|m| m.servers).unwrap_or_default())
            .map_err(|e| format!("{}: {}", path.display(), sanitize_json_error(&e))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// A server as written in the file: values left at their default are omitted.
fn compact(entry: &ServerEntry) -> Result<Value, String> {
    let mut value = serde_json::to_value(entry).map_err(|e| e.to_string())?;
    let defaults = serde_json::to_value(ServerEntry::new(McpServerConfig::stdio("", "", &[])))
        .map_err(|e| e.to_string())?;
    if let (Some(map), Some(defaults)) = (value.as_object_mut(), defaults.as_object()) {
        map.retain(|key, v| {
            key == "name"
                || match defaults.get(key) {
                    Some(d) => d != v,
                    None => {
                        !v.is_null()
                            && !matches!(v, Value::Array(a) if a.is_empty())
                            && !matches!(v, Value::Object(o) if o.is_empty())
                    }
                }
        });
        // An HTTP server needs its type; a stdio one is the default.
        if entry.config.server_type != "stdio" {
            map.insert(
                "type".into(),
                Value::String(entry.config.server_type.clone()),
            );
        }
    }
    Ok(value)
}

fn write_user_unlocked(home: &Path, servers: &[ServerEntry]) -> Result<(), String> {
    let path = user_file(home);
    let mut root: Map<String, Value> = match std::fs::read_to_string(&path) {
        Ok(text) => {
            let parsed: Value =
                serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
            match parsed {
                Value::Object(map) => map,
                _ => {
                    return Err(format!(
                        "{}: configuration root must be a JSON object",
                        path.display()
                    ));
                }
            }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            let mut m = Map::new();
            m.insert(
                "schema_version".into(),
                Value::from(bricks_provider::config::SCHEMA_VERSION),
            );
            m
        }
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    root.entry("schema_version".to_string())
        .or_insert_with(|| Value::from(bricks_provider::config::SCHEMA_VERSION));

    let list = servers.iter().map(compact).collect::<Result<Vec<_>, _>>()?;
    let mcp_obj = root
        .entry("mcp".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !mcp_obj.is_object() {
        *mcp_obj = Value::Object(Map::new());
    }
    if let Some(map) = mcp_obj.as_object_mut() {
        map.insert("servers".into(), Value::Array(list));
    }

    let text = serde_json::to_string_pretty(&Value::Object(root)).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(home).map_err(|e| format!("{}: {e}", home.display()))?;
    write_atomic_private(&path, format!("{text}\n").as_bytes())
        .map_err(|e| format!("{}: {e}", path.display()))
}

fn unique_tmp_path(dir: &Path, name: &str) -> PathBuf {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let seq = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    dir.join(format!(
        ".{name}.{}.{nanos:x}.{seq}.tmp",
        std::process::id()
    ))
}

fn write_atomic_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| std::io::Error::other("no parent folder"))?;
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("config.json");
    let tmp = unique_tmp_path(dir, name);
    let permissions = std::fs::metadata(path).map(|m| m.permissions()).ok();
    let written = (|| {
        let mut opts = std::fs::OpenOptions::new();
        opts.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if let Some(p) = permissions {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let masked = p.mode() & 0o700;
                std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(masked))?;
            }
            #[cfg(not(unix))]
            {
                std::fs::set_permissions(&tmp, p)?;
            }
        }
        std::fs::rename(&tmp, path)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    written
}

/// Adds a server of the person's. Refused when it is not valid or its name
/// is taken.
pub fn add_user(home: &Path, entry: ServerEntry) -> Result<(), String> {
    entry.config.validate()?;
    let _guard = crate::user_config_lock().lock();
    let mut servers = read_user_unlocked(home)?;
    if servers.iter().any(|s| s.config.name == entry.config.name) {
        return Err(format!(
            "an MCP server named '{}' already exists",
            entry.config.name
        ));
    }
    servers.push(entry);
    write_user_unlocked(home, &servers)
}

/// Removes a server of the person's; `false` when there was none.
pub fn remove_user(home: &Path, name: &str) -> Result<bool, String> {
    let _guard = crate::user_config_lock().lock();
    let mut servers = read_user_unlocked(home)?;
    let before = servers.len();
    servers.retain(|s| s.config.name != name);
    if servers.len() == before {
        return Ok(false);
    }
    write_user_unlocked(home, &servers).map(|_| true)
}

/// Turns a server of the person's on or off.
pub fn set_enabled(home: &Path, name: &str, enabled: bool) -> Result<(), String> {
    let _guard = crate::user_config_lock().lock();
    let mut servers = read_user_unlocked(home)?;
    let server = servers
        .iter_mut()
        .find(|s| s.config.name == name)
        .ok_or_else(|| format!("no MCP server named '{name}'"))?;
    server.enabled = enabled;
    write_user_unlocked(home, &servers)
}

// ─── The project's servers and their approvals ───────────────────────────────

pub fn project_file(project: &Path) -> PathBuf {
    crate::project_config_file(project)
}

/// The servers `<project>/.bricks/config.json` declares.
pub fn read_project(project: &Path) -> Result<Vec<ServerEntry>, String> {
    let path = project_file(project);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<ConfigFileMcp>(&text)
            .map(|f| f.mcp.map(|m| m.servers).unwrap_or_default())
            .map_err(|e| format!("{} (mcp): {}", path.display(), sanitize_json_error(&e))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct Approval {
    fingerprint: String,
    approved: bool,
}

pub fn approvals_file(home: &Path) -> PathBuf {
    home.join("mcp-approvals.json")
}

fn approval_key(project: &Path, name: &str) -> String {
    let project = std::fs::canonicalize(project).unwrap_or_else(|_| project.to_path_buf());
    format!("{}#{name}", project.display())
}

/// The decisions kept; an unreadable file is an error (never taken for none,
/// and never overwritten).
fn load_approvals(home: &Path) -> Result<BTreeMap<String, Approval>, String> {
    let path = approvals_file(home);
    match std::fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(BTreeMap::new()),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// The decisions, for reading: an unreadable file decides nothing (every
/// project server waits).
fn read_approvals(home: &Path) -> BTreeMap<String, Approval> {
    load_approvals(home).unwrap_or_default()
}

/// The person's decision on the project's server `entry`, as declared now.
pub fn decision(home: &Path, project: &Path, entry: &ServerEntry) -> Decision {
    match read_approvals(home).get(&approval_key(project, &entry.config.name)) {
        Some(a) if a.fingerprint == entry.fingerprint() => {
            if a.approved {
                Decision::Approved
            } else {
                Decision::Denied
            }
        }
        _ => Decision::Pending,
    }
}

/// Records the person's decision on the project's server `name`, as it is
/// declared now.
pub fn decide(home: &Path, project: &Path, name: &str, approved: bool) -> Result<(), String> {
    let entry = read_project(project)?
        .into_iter()
        .find(|s| s.config.name == name)
        .ok_or_else(|| format!("the project declares no MCP server named '{name}'"))?;
    let _guard = crate::user_config_lock().lock();
    let mut approvals = load_approvals(home)?;
    approvals.insert(
        approval_key(project, name),
        Approval {
            fingerprint: entry.fingerprint(),
            approved,
        },
    );
    let text = serde_json::to_string_pretty(&approvals).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(home).map_err(|e| e.to_string())?;
    let path = approvals_file(home);
    write_atomic_private(&path, text.as_bytes()).map_err(|e| e.to_string())
}

// ─── Both, as one selection ──────────────────────────────────────────────────

fn same_file(a: &Path, b: &Path) -> bool {
    if a == b {
        return true;
    }
    match (std::fs::canonicalize(a), std::fs::canonicalize(b)) {
        (Ok(ca), Ok(cb)) => ca == cb,
        _ => false,
    }
}

/// The servers of `home`, then those of `project` (when given). A project
/// server named like one of the person's is hidden by it. When `project`
/// points at the home directory itself (so `<project>/.bricks/config.json` is
/// `<home>/config.json`), the user servers are not duplicated as project ones.
pub fn select(home: &Path, project: Option<&Path>) -> Selection {
    let mut out = Selection::default();
    match read_user(home) {
        Ok(servers) => out
            .servers
            .extend(servers.into_iter().map(|entry| ServerView {
                entry,
                source: Source::User,
                decision: None,
                shadowed: false,
            })),
        Err(e) => out.errors.push(e),
    }
    if let Some(project) = project
        && !same_file(&user_file(home), &project_file(project))
    {
        match read_project(project) {
            Ok(servers) => {
                for entry in servers {
                    let shadowed = out.servers.iter().any(|s| {
                        s.source == Source::User && s.entry.config.name == entry.config.name
                    });
                    let decision = Some(decision(home, project, &entry));
                    out.servers.push(ServerView {
                        entry,
                        source: Source::Project,
                        decision,
                        shadowed,
                    });
                }
            }
            Err(e) => out.errors.push(e),
        }
    }
    for s in &out.servers {
        if s.entry.enabled
            && let Err(e) = s.entry.config.validate()
        {
            out.errors.push(e);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stdio(name: &str) -> ServerEntry {
        ServerEntry::new(McpServerConfig::stdio(name, "echo", &["hi"]))
    }

    fn write_project_cfg(project: &Path, body: &str) {
        let p = project_file(project);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    #[test]
    fn the_persons_servers_are_added_listed_turned_off_and_removed() {
        let home = tempfile::tempdir().unwrap();
        // Pre-existing sibling section in config.json must survive MCP writes.
        std::fs::write(
            user_file(home.path()),
            r#"{"schema_version":1,"preferences":{"theme":"dark"}}"#,
        )
        .unwrap();
        add_user(home.path(), stdio("a")).unwrap();
        add_user(
            home.path(),
            ServerEntry::new(McpServerConfig::http("b", "https://x.test/mcp")),
        )
        .unwrap();
        assert!(
            add_user(home.path(), stdio("a")).is_err(),
            "names are unique"
        );
        assert!(
            add_user(
                home.path(),
                ServerEntry::new(McpServerConfig::stdio("c", "", &[]))
            )
            .is_err(),
            "invalid servers are refused"
        );
        set_enabled(home.path(), "b", false).unwrap();
        let sel = select(home.path(), None);
        assert_eq!(sel.servers.len(), 2);
        assert_eq!(
            sel.active().len(),
            1,
            "a turned-off server is not connected"
        );
        assert!(remove_user(home.path(), "a").unwrap());
        assert!(!remove_user(home.path(), "a").unwrap());
        let saved: Value =
            serde_json::from_str(&std::fs::read_to_string(user_file(home.path())).unwrap())
                .unwrap();
        assert_eq!(saved["preferences"]["theme"], "dark");
        assert_eq!(saved["mcp"]["servers"][0]["name"], "b");
        assert_eq!(saved["mcp"]["servers"][0]["enabled"], false);
    }

    #[test]
    fn a_project_server_waits_for_approval_and_a_change_asks_again() {
        let home = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let json = r#"{
            "mcp": {
                "servers": [{ "name": "repo", "command": "node", "args": ["server.js"] }]
            }
        }"#;
        write_project_cfg(project.path(), json);
        let sel = select(home.path(), Some(project.path()));
        assert_eq!(sel.pending().len(), 1);
        assert!(sel.active().is_empty(), "not connected before approval");

        decide(home.path(), project.path(), "repo", true).unwrap();
        assert_eq!(select(home.path(), Some(project.path())).active().len(), 1);

        // The declaration changes: asked again.
        write_project_cfg(project.path(), &json.replace("server.js", "other.js"));
        let sel = select(home.path(), Some(project.path()));
        assert_eq!(sel.pending().len(), 1);
        assert!(sel.active().is_empty());

        decide(home.path(), project.path(), "repo", false).unwrap();
        let sel = select(home.path(), Some(project.path()));
        assert_eq!(sel.servers[0].decision, Some(Decision::Denied));
        assert!(sel.active().is_empty() && sel.pending().is_empty());
    }

    #[test]
    fn the_persons_server_hides_a_project_server_of_the_same_name() {
        let home = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        add_user(home.path(), stdio("same")).unwrap();
        write_project_cfg(
            project.path(),
            r#"{"mcp":{"servers":[{"name":"same","command":"evil"}]}}"#,
        );
        let sel = select(home.path(), Some(project.path()));
        let active = sel.active();
        assert_eq!(active.len(), 1);
        assert_eq!(active[0].command.as_deref(), Some("echo"));
        assert!(sel.pending().is_empty());
    }

    #[test]
    fn opening_home_as_project_does_not_duplicate_user_servers() {
        let root = tempfile::tempdir().unwrap();
        let home = root.path().join(".bricks");
        add_user(&home, stdio("mine")).unwrap();
        let sel = select(&home, Some(root.path()));
        assert_eq!(sel.servers.len(), 1);
        assert_eq!(sel.servers[0].source, Source::User);
        assert!(sel.errors.is_empty(), "{:?}", sel.errors);
    }

    #[test]
    fn unreadable_files_are_reported_not_taken_for_empty() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(user_file(home.path()), "{ broken").unwrap();
        let sel = select(home.path(), None);
        assert_eq!(sel.errors.len(), 1, "{:?}", sel.errors);
        assert!(
            add_user(home.path(), stdio("x")).is_err(),
            "an invalid file is never overwritten"
        );
    }
}
