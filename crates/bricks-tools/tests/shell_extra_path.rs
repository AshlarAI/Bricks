//! `[bash] extra_path`, proven with real processes and fake executables in
//! temporary directories (Unix). Nothing depends on what the machine has
//! installed, and the process environment is never changed.

#![cfg(unix)]

use bricks_tools::shell::bash::RunOutcome;
use bricks_tools::shell::{self, ShellConfig, ShellSessions};
use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

const TOOL: &str = "bricks-fake-tool";

/// A directory holding an executable `name` that prints `says`.
fn fake(name: &str, says: &str) -> tempfile::TempDir {
    let dir = tempfile::tempdir().unwrap();
    let file = dir.path().join(name);
    std::fs::write(&file, format!("#!/bin/sh\necho {says}\n")).unwrap();
    std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o755)).unwrap();
    dir
}

struct Fixture {
    id: String,
    config: ShellConfig,
    sessions: Arc<ShellSessions>,
    cwd: tempfile::TempDir,
}

impl Fixture {
    fn new(extra_path: Vec<PathBuf>) -> Self {
        let id = format!("test-{}", uuid::Uuid::new_v4());
        let config = ShellConfig {
            extra_path,
            base_dir: std::env::temp_dir().join("bricks-shell-tests"),
            ..ShellConfig::default()
        };
        Self {
            sessions: shell::session(&id, &config),
            config,
            id,
            cwd: tempfile::tempdir().unwrap(),
        }
    }

    async fn run(&self, command: &str) -> RunOutcome {
        let mut c = self
            .sessions
            .spawn_command(
                command,
                None,
                self.cwd.path(),
                &self.config,
                Duration::from_secs(20),
            )
            .await
            .unwrap();
        c.finish().await
    }

    async fn out(&self, command: &str) -> String {
        self.run(command).await.stdout.text.trim_end().to_string()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        shell::close_session_now(&self.id);
    }
}

fn entries(path: &str) -> Vec<PathBuf> {
    std::env::split_paths(path).collect()
}

fn process_path() -> String {
    std::env::var("PATH").unwrap()
}

#[tokio::test]
async fn a_tool_in_an_extra_directory_runs_after_the_existing_path() {
    let dir = fake(TOOL, "found");
    let f = Fixture::new(vec![dir.path().to_path_buf()]);
    assert_eq!(f.out(TOOL).await, "found");
    let expected = format!("{}:{}", process_path(), dir.path().display());
    assert_eq!(f.out("printf %s \"$PATH\"").await, expected);
}

#[tokio::test]
async fn a_background_task_has_the_extra_directory_too() {
    let dir = fake(TOOL, "found");
    let f = Fixture::new(vec![dir.path().to_path_buf()]);
    let task = f
        .sessions
        .start_task(
            &format!("{TOOL} > out.txt"),
            None,
            None,
            f.cwd.path(),
            &f.config,
        )
        .await
        .unwrap();
    assert!(task.wait_finished(Duration::from_secs(20)).await);
    let out = std::fs::read_to_string(f.cwd.path().join("out.txt")).unwrap();
    assert_eq!(out.trim_end(), "found");
}

/// `ls` exists on every Unix: the existing `PATH` keeps it, and between extra
/// directories the first one wins.
#[tokio::test]
async fn the_existing_path_then_the_configured_order_have_priority() {
    let shadow = fake("ls", "fake ls");
    let first = fake(TOOL, "first");
    let second = fake(TOOL, "second");
    let f = Fixture::new(vec![
        shadow.path().to_path_buf(),
        first.path().to_path_buf(),
        second.path().to_path_buf(),
    ]);
    let ls = f.out("command -v ls").await;
    assert!(!Path::new(&ls).starts_with(shadow.path()), "{ls}");
    assert_eq!(f.out(TOOL).await, "first");
}

#[tokio::test]
async fn an_entry_is_never_added_twice() {
    let dir = fake(TOOL, "found");
    let inherited = entries(&process_path()).remove(0);
    let with_slash = PathBuf::from(format!("{}/", dir.path().display()));
    let f = Fixture::new(vec![
        dir.path().to_path_buf(),
        with_slash,
        inherited.clone(),
        dir.path().to_path_buf(),
    ]);
    let path = entries(&f.out("printf %s \"$PATH\"").await);
    assert_eq!(path.iter().filter(|p| *p == dir.path()).count(), 1);
    let before = entries(&process_path());
    assert_eq!(path[..before.len()], before[..]);
    assert_eq!(path.len(), before.len() + 1);
}

#[tokio::test]
async fn without_configuration_the_path_is_the_one_of_the_process() {
    let dir = fake(TOOL, "found");
    let f = Fixture::new(Vec::new());
    assert_eq!(f.out("printf %s \"$PATH\"").await, process_path());
    assert_eq!(code_of(&f.run(TOOL).await), 127);
    assert_eq!(
        shell::session_path(&f.id, &f.config),
        std::env::var_os("PATH")
    );
    drop(dir);
}

fn code_of(o: &RunOutcome) -> i32 {
    match o.status {
        bricks_tools::shell::bash::RunStatus::Exited { code } => code,
        ref s => panic!("not exited: {s:?}"),
    }
}

/// The list applies when the state is created: what the session does with
/// `PATH` afterwards stands, and the process environment never moves.
#[tokio::test]
async fn a_later_change_of_path_in_the_session_is_kept() {
    let dir = fake(TOOL, "found");
    let later = fake("bricks-later-tool", "later");
    let before = std::env::var_os("PATH");
    let f = Fixture::new(vec![dir.path().to_path_buf()]);
    let replaced = format!("{}:/usr/bin:/bin", later.path().display());
    assert_eq!(code_of(&f.run(&format!("export PATH={replaced}")).await), 0);
    assert_eq!(f.out("printf %s \"$PATH\"").await, replaced);
    assert_eq!(f.out("bricks-later-tool").await, "later");
    assert_eq!(code_of(&f.run(TOOL).await), 127);
    assert_eq!(
        shell::session_path(&f.id, &f.config),
        Some(OsString::from(&replaced))
    );
    assert_eq!(std::env::var_os("PATH"), before);
}

/// Before its first command, a session is announced with the `PATH` it will
/// have, and looking at it does not create it.
#[tokio::test]
async fn the_path_of_a_session_not_started_yet_includes_the_extra_directories() {
    let dir = fake(TOOL, "found");
    let config = ShellConfig {
        extra_path: vec![dir.path().to_path_buf()],
        ..ShellConfig::default()
    };
    let id = format!("test-{}", uuid::Uuid::new_v4());
    let path = shell::session_path(&id, &config).unwrap();
    assert_eq!(
        path.to_str().unwrap(),
        format!("{}:{}", process_path(), dir.path().display())
    );
    assert_eq!(shell::session_cwd(&id), None);
}
