//! The lifetime of a root run's commands, through the controller and real
//! processes. An in-flight foreground command ends when its run is cancelled;
//! an explicit `background: true` job outlives the run and ends with the
//! session. The project's `[bash] extra_path` reaches the Bash tool.

#![cfg(unix)]

#[allow(dead_code)]
mod common;

use bricks_agent::BricksConfig;
use bricks_agent::control::scripted::{Reply, Script, ScriptedCatalog};
use bricks_agent::control::*;
use bricks_agent::permission::{PermissionProfile, SessionPolicy};
use bricks_tools::shell::procs;
use serde_json::json;
use std::path::Path;
use std::time::Duration;

async fn open(dir: &Path, replies: Vec<Reply>, extra_path: Vec<String>) -> (Controller, EventStream) {
    let catalog = ScriptedCatalog::new(&["a"], Script::new(replies));
    let mut bricks = BricksConfig::default();
    bricks.agent.model = Some("test/a".into());
    bricks.bash.extra_path = extra_path;
    let mut cfg = EngineConfig::new(dir, catalog, bricks, dir.join(".sessions"));
    cfg.interactive = false;
    // Commands run without asking: the session's policy is EXECUTE.
    cfg.permissions = Some(common::default_store(
        dir,
        &SessionPolicy::chosen(PermissionProfile::Execute),
    ));
    Controller::open(
        cfg,
        OpenOptions {
            session: SessionChoice::New,
            model: None,
            reasoning: None,
        },
    )
    .await
    .unwrap()
}

/// The next event matching `pred`.
async fn until(events: &mut EventStream, pred: impl Fn(&Event) -> bool) -> Event {
    loop {
        let e = tokio::time::timeout(Duration::from_secs(30), events.next())
            .await
            .expect("the event within 30 s")
            .expect("the stream open");
        if pred(&e.event) {
            return e.event;
        }
    }
}

fn finished(call: &'static str) -> impl Fn(&Event) -> bool {
    move |e| matches!(e, Event::ToolFinished { tool_call_id, .. } if tool_call_id == call)
}

/// The pid a command wrote to `path` when it started.
async fn pid_in(path: &Path) -> u32 {
    for _ in 0..400 {
        if let Ok(text) = std::fs::read_to_string(path)
            && let Ok(pid) = text.trim().parse()
        {
            return pid;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("no pid written to {}", path.display());
}

/// A shell command that records its pid and sleeps.
fn sleeper(pidfile: &Path) -> String {
    format!(
        "sh -c 'echo $$ > \"{}\"; exec sleep 300'",
        pidfile.display()
    )
}

#[tokio::test]
async fn cancelling_a_run_stops_foreground_commands_while_background_jobs_outlive_it() {
    let dir = tempfile::tempdir().unwrap();
    let foreground_pid = dir.path().join("foreground.pid");
    let background_pid = dir.path().join("background.pid");
    let (ctl, mut events) = open(
        dir.path(),
        vec![
            Reply::tool(
                "bg",
                "Bash",
                json!({ "command": sleeper(&background_pid), "background": true }),
            ),
            Reply::tool("fg", "Bash", json!({ "command": sleeper(&foreground_pid) })),
            Reply::hang(),
        ],
        Vec::new(),
    )
    .await;
    ctl.send(Command::Submit {
        prompt: Prompt::text("start the jobs"),
    })
    .unwrap();

    until(&mut events, finished("bg")).await;
    let background = pid_in(&background_pid).await;
    let foreground = pid_in(&foreground_pid).await;
    assert!(procs::is_running(background), "the background job runs");
    assert!(procs::is_running(foreground), "the foreground command runs");

    ctl.send(Command::Cancel).unwrap();
    until(&mut events, |e| matches!(e, Event::RunFinished { .. })).await;
    assert!(
        procs::wait_gone(&[foreground], Duration::from_secs(5)).await,
        "the foreground command outlived its cancelled run"
    );
    assert!(
        procs::is_running(background),
        "a background job must outlive its run"
    );

    ctl.close().await;
    assert!(
        procs::wait_gone(&[background], Duration::from_secs(5)).await,
        "the background job outlived its session"
    );
}

#[tokio::test]
async fn the_project_extra_path_reaches_the_bash_tool() {
    let dir = tempfile::tempdir().unwrap();
    let bin_dir = dir.path().join("custom-bin");
    std::fs::create_dir(&bin_dir).unwrap();
    let (ctl, mut events) = open(
        dir.path(),
        vec![
            Reply::tool("ep", "Bash", json!({ "command": "echo \"$PATH\"" })),
            Reply::text("done"),
        ],
        vec![bin_dir.display().to_string()],
    )
    .await;
    ctl.send(Command::Submit {
        prompt: Prompt::text("check path"),
    })
    .unwrap();
    let Event::ToolFinished {
        is_error, output, ..
    } = until(&mut events, finished("ep")).await
    else {
        unreachable!()
    };
    assert!(!is_error, "{output}");
    assert!(
        output.contains(&bin_dir.display().to_string()),
        "{output}"
    );
    until(&mut events, |e| matches!(e, Event::RunFinished { .. })).await;
    ctl.close().await;
}
