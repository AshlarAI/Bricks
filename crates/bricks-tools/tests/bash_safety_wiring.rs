//! Integration tests for Bash safety classification wiring, session override
//! checks (`ShellState` aliases/functions), and PowerShell concurrency safety.

use bricks_tools::bash::BashTool;
use bricks_tools::permissions::AllowAll;
use bricks_tools::powershell::PowerShellTool;
use bricks_tools::shell::{self, ShellConfig};
use bricks_tools::{CostTracker, Extensions, PermissionLevel, Tool, ToolContext};
use serde_json::json;
use std::path::Path;
use std::sync::Arc;

fn make_ctx(dir: &Path, session_id: String) -> ToolContext {
    ToolContext {
        working_dir: dir.to_path_buf(),
        session_id,
        permissions: Arc::new(AllowAll),
        cost_tracker: Arc::new(CostTracker::new()),
        mcp_manager: None,
        extensions: Extensions::default(),
    }
}

#[test]
fn bash_permission_level_for_classifies_readonly_forbidden_and_execute() {
    let tool = BashTool::default();

    for cmd in ["ls -la", "git status", "cat README.md"] {
        assert_eq!(
            tool.permission_level_for(&json!({ "command": cmd })),
            PermissionLevel::ReadOnly,
            "expected ReadOnly for {cmd:?}"
        );
    }

    for cmd in [
        "sudo rm -rf /",
        "rm -rf /",
        "dd if=/dev/zero of=/dev/sda",
        ":(){ :|:& };:",
    ] {
        assert_eq!(
            tool.permission_level_for(&json!({ "command": cmd })),
            PermissionLevel::Forbidden,
            "expected Forbidden for {cmd:?}"
        );
    }

    for cmd in [
        "mkdir -p foo",
        "cargo build",
        "rm file.txt",
        "curl https://example.com",
        "ls | grep x",
        "ls (",
        "$CMD arg",
    ] {
        assert_eq!(
            tool.permission_level_for(&json!({ "command": cmd })),
            PermissionLevel::Execute,
            "expected Execute for {cmd:?}"
        );
    }

    // Missing or non-string command defaults conservatively to Execute.
    assert_eq!(
        tool.permission_level_for(&json!({})),
        PermissionLevel::Execute
    );
    assert_eq!(
        tool.permission_level_for(&json!({ "command": 42 })),
        PermissionLevel::Execute
    );

    // Background execution of an otherwise safe command requires Execute.
    assert_eq!(
        tool.permission_level_for(&json!({ "command": "ls -la", "background": true })),
        PermissionLevel::Execute
    );

    // Forbidden commands stay Forbidden even when `background: true` is set.
    assert_eq!(
        tool.permission_level_for(&json!({ "command": "sudo rm -rf /", "background": true })),
        PermissionLevel::Forbidden
    );
}

#[tokio::test]
async fn bash_permission_level_for_ctx_flips_on_alias_and_function_overrides() {
    let dir = tempfile::tempdir().unwrap();
    let tool = BashTool::default();
    let safe_input = json!({ "command": "ls -la" });

    // Case 1: Alias override on `ls`.
    let alias_session = format!("bash-wiring-alias-{}", uuid::Uuid::new_v4());
    let alias_ctx = make_ctx(dir.path(), alias_session.clone());

    assert_eq!(
        tool.permission_level_for_ctx(&safe_input, &alias_ctx),
        PermissionLevel::ReadOnly
    );
    assert!(tool.is_concurrent_safe_ctx(&safe_input, &alias_ctx));

    let sess = shell::session(&alias_session, &ShellConfig::default());
    // Still safe before any alias or function is defined.
    assert_eq!(
        tool.permission_level_for_ctx(&safe_input, &alias_ctx),
        PermissionLevel::ReadOnly
    );
    assert!(tool.is_concurrent_safe_ctx(&safe_input, &alias_ctx));

    let launch = sess.state().launch(dir.path());
    let mut end = launch.base.clone();
    end.aliases
        .insert("ls".to_string(), b"alias ls='rm -rf'\n".to_vec());
    assert!(sess.state().publish(launch.seq, &launch.base, &end));

    assert_eq!(
        tool.permission_level_for_ctx(&safe_input, &alias_ctx),
        PermissionLevel::Execute
    );
    assert!(!tool.is_concurrent_safe_ctx(&safe_input, &alias_ctx));

    shell::close_session(&alias_session).await;

    // Case 2: Function override on `ls`.
    let fn_session = format!("bash-wiring-fn-{}", uuid::Uuid::new_v4());
    let fn_ctx = make_ctx(dir.path(), fn_session.clone());

    assert_eq!(
        tool.permission_level_for_ctx(&safe_input, &fn_ctx),
        PermissionLevel::ReadOnly
    );
    assert!(tool.is_concurrent_safe_ctx(&safe_input, &fn_ctx));

    let fn_sess = shell::session(&fn_session, &ShellConfig::default());
    let fn_launch = fn_sess.state().launch(dir.path());
    let mut fn_end = fn_launch.base.clone();
    fn_end
        .functions
        .insert("ls".to_string(), b"ls () { echo overridden; }\n".to_vec());
    assert!(
        fn_sess
            .state()
            .publish(fn_launch.seq, &fn_launch.base, &fn_end)
    );

    assert_eq!(
        tool.permission_level_for_ctx(&safe_input, &fn_ctx),
        PermissionLevel::Execute
    );
    assert!(!tool.is_concurrent_safe_ctx(&safe_input, &fn_ctx));

    shell::close_session(&fn_session).await;
}

#[test]
fn powershell_is_never_concurrent_safe() {
    let tool = PowerShellTool;
    assert!(!tool.is_concurrent_safe(&json!({ "command": "Get-ChildItem" })));
    assert!(!tool.is_concurrent_safe(&json!({})));
}
