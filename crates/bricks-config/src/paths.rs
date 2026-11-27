//! Where Bricks keeps its files.

use parking_lot::Mutex;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// `~/.bricks`, or `$BRICKS_HOME`.
pub fn bricks_home() -> PathBuf {
    if let Some(h) = std::env::var_os("BRICKS_HOME") {
        return PathBuf::from(h);
    }
    dirs::home_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".bricks")
}

/// The unified user configuration file: `<bricks_home>/config.json`.
pub fn user_config_file() -> PathBuf {
    bricks_home().join("config.json")
}

/// The project configuration file: `<project>/.bricks/config.json`.
pub fn project_config_file(project: &Path) -> PathBuf {
    project.join(".bricks").join("config.json")
}

/// Process-wide lock serializing read-modify-write updates to `config.json`
/// across subsystems (providers, MCP servers, preferences).
pub fn user_config_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

/// The skill store: `<bricks_home>/skills`, one standard skill folder per
/// installed skill.
pub fn skills_dir() -> PathBuf {
    bricks_home().join("skills")
}

/// The session store: `<bricks_home>/sessions`.
pub fn sessions_dir() -> PathBuf {
    bricks_home().join("sessions")
}

/// The providers file named by `$BRICKS_HOME` (`$BRICKS_HOME/config.json`),
/// or `None` when `BRICKS_HOME` is not set: the registry then reads its
/// default location (`~/.bricks/config.json`).
pub fn providers_file_from_env() -> Option<PathBuf> {
    std::env::var_os("BRICKS_HOME").map(|h| PathBuf::from(h).join("config.json"))
}
