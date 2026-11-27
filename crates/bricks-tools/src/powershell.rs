//! PowerShell tool: commands in this session's persistent PowerShell
//! (`pwsh`, or Windows PowerShell). `$env:…`, `Set-Location`, variables,
//! functions and aliases persist while the session lives.
//!
//! The result separates PowerShell's own success, cmdlet errors and the exit
//! code of a native program — which is reported only when one ran in that
//! command. A timeout replaces the session (reported); see
//! `crate::shell::powershell` and `docs/shell.md`.

use super::*;
use crate::shell::{self, powershell::PwshStatus};
use crate::tool_report::{ToolBody, ToolReport, ToolStatus};
use serde::Deserialize;
use std::time::Duration;

pub struct PowerShellTool;

#[async_trait]
impl Tool for PowerShellTool {
    fn name(&self) -> &str {
        "PowerShell"
    }
    fn description(&self) -> &str {
        "Run a command in this session's persistent PowerShell ($env:, Set-Location, variables, \
         functions and aliases persist). Available on Windows; on macOS/Linux uses pwsh if \
         installed. `timeout` in milliseconds (default 120000, max 600000)."
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::Execute
    }
    fn is_concurrent_safe(&self, _input: &Value) -> bool {
        false
    }
    fn category(&self) -> ToolCategory {
        ToolCategory::Shell
    }

    fn input_schema(&self) -> Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "command": { "type": "string", "description": "PowerShell command to execute" },
                "timeout": { "type": "integer", "description": "Timeout in milliseconds (default 120000, max 600000)" }
            },
            "required": ["command"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Input {
            command: String,
            timeout: Option<u64>,
        }
        let input: Input = match crate::tool_feedback::parse_input(self, &input) {
            Ok(i) => i,
            Err(e) => return e,
        };
        let config = crate::bash::shell_config(ctx);
        let timeout = input
            .timeout
            .map(Duration::from_millis)
            .unwrap_or(config.default_timeout)
            .min(config.max_timeout);
        let started = std::time::Instant::now();
        let sessions = shell::session(&ctx.session_id, &config);
        let session = match sessions.pwsh(&ctx.working_dir, &config).await {
            Ok(s) => s,
            Err(e) => {
                let mut r = ToolReport::new(
                    ToolStatus::Failure,
                    ToolBody::Streams {
                        stdout: String::new(),
                        stderr: String::new(),
                    },
                );
                r.termination = Some(format!("cannot launch: {e}"));
                r.duration = Some(started.elapsed());
                if e.kind() == std::io::ErrorKind::NotFound {
                    r.suggestion = Some(if cfg!(windows) {
                        "Check that PowerShell is available on PATH.".into()
                    } else {
                        "Install PowerShell (pwsh) or use the Bash tool.".into()
                    });
                }
                return ToolResult::from_report(r);
            }
        };
        let reset = sessions.take_reset_notice();
        let outcome = match session
            .run(
                &input.command,
                timeout,
                crate::bash::progress_for(ctx, "PowerShell"),
            )
            .await
        {
            Ok(o) => o,
            Err(e) => return ToolResult::error(format!("PowerShell session failed: {e}")),
        };
        ToolResult::from_report(report_from_outcome(outcome, timeout, reset))
    }
}

fn report_from_outcome(
    outcome: crate::shell::powershell::PwshOutcome,
    timeout: Duration,
    reset: Option<String>,
) -> ToolReport {
    let mut report = ToolReport::new(
        ToolStatus::Success,
        ToolBody::Streams {
            stdout: outcome.stdout.text.clone(),
            stderr: outcome.stderr.text.clone(),
        },
    );
    match outcome.status {
        PwshStatus::Completed {
            ok,
            cmdlet_errors,
            native_exit,
        } => {
            let failed = !ok || cmdlet_errors > 0 || native_exit.is_some_and(|c| c != 0);
            report.status = if failed {
                ToolStatus::Failure
            } else {
                ToolStatus::Success
            };
            report.exit_code = native_exit;
            if native_exit.is_none() {
                report.termination = Some(format!(
                    "no native program ran; PowerShell {} ({} cmdlet error(s))",
                    if ok { "succeeded" } else { "failed" },
                    cmdlet_errors
                ));
            } else if cmdlet_errors > 0 {
                report.notes.push(format!(
                    "{cmdlet_errors} cmdlet error(s) in addition to the native program"
                ));
            }
        }
        PwshStatus::TimedOut => {
            report.status = ToolStatus::TimedOut;
            report.timeout = Some(timeout);
            report.termination = Some("no exit code (PowerShell session destroyed)".into());
        }
        PwshStatus::SessionEnded { code } => {
            report.status = ToolStatus::Failure;
            report.exit_code = code;
            if code.is_none() {
                report.termination = Some("PowerShell session ended without a status".into());
            }
        }
    }
    report.duration = Some(outcome.duration);
    if let Some(r) = reset {
        report.notes.push(r);
    }
    report.notes.extend(outcome.notes);
    report.data = Some(serde_json::json!({ "cwd": outcome.cwd }));
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shell::capture::Captured;
    use crate::shell::powershell::PwshOutcome;
    use std::path::PathBuf;

    fn outcome(status: PwshStatus) -> PwshOutcome {
        PwshOutcome {
            status,
            stdout: Captured::default(),
            stderr: Captured::default(),
            duration: Duration::from_millis(25),
            cwd: Some(PathBuf::from("/tmp")),
            notes: Vec::new(),
        }
    }

    #[test]
    fn description_and_schema_document_timeout_default_and_max() {
        let tool = PowerShellTool;
        let desc = tool.description();
        assert!(desc.contains("default 120000"), "{desc}");
        assert!(desc.contains("max 600000"), "{desc}");

        let schema = tool.input_schema();
        let timeout_desc = schema["properties"]["timeout"]["description"]
            .as_str()
            .expect("timeout description");
        assert!(timeout_desc.contains("default 120000"), "{timeout_desc}");
        assert!(timeout_desc.contains("max 600000"), "{timeout_desc}");
    }

    #[tokio::test]
    async fn launch_failure_returns_english_error_and_suggestion() {
        let dir = tempfile::tempdir().unwrap();
        let extensions = Extensions::default();
        extensions.insert(crate::shell::ShellConfig {
            pwsh_path: Some(PathBuf::from("bricks-nonexistent-pwsh-binary")),
            ..Default::default()
        });
        let ctx = ToolContext {
            working_dir: dir.path().to_path_buf(),
            session_id: format!("pwsh-missing-{}", uuid::Uuid::new_v4()),
            permissions: Arc::new(crate::permissions::AllowAll),
            cost_tracker: Arc::new(CostTracker::new()),
            mcp_manager: None,
            extensions,
        };
        let res = PowerShellTool
            .execute(serde_json::json!({ "command": "Write-Output ok" }), &ctx)
            .await;
        assert!(res.is_error);
        let report = res.report.expect("report");
        let term = report.termination.as_deref().unwrap_or("");
        assert!(term.starts_with("cannot launch:"), "{term}");
        let suggestion = report.suggestion.as_deref().unwrap_or("");
        if cfg!(windows) {
            assert_eq!(suggestion, "Check that PowerShell is available on PATH.");
        } else {
            assert_eq!(
                suggestion,
                "Install PowerShell (pwsh) or use the Bash tool."
            );
        }
    }

    #[test]
    fn outcome_reports_use_english_messages() {
        let r_ok = report_from_outcome(
            outcome(PwshStatus::Completed {
                ok: true,
                cmdlet_errors: 0,
                native_exit: None,
            }),
            Duration::from_secs(1),
            None,
        );
        assert_eq!(r_ok.status, ToolStatus::Success);
        assert_eq!(
            r_ok.termination.as_deref(),
            Some("no native program ran; PowerShell succeeded (0 cmdlet error(s))")
        );

        let r_cmdlet_err = report_from_outcome(
            outcome(PwshStatus::Completed {
                ok: false,
                cmdlet_errors: 2,
                native_exit: None,
            }),
            Duration::from_secs(1),
            None,
        );
        assert_eq!(r_cmdlet_err.status, ToolStatus::Failure);
        assert_eq!(
            r_cmdlet_err.termination.as_deref(),
            Some("no native program ran; PowerShell failed (2 cmdlet error(s))")
        );

        let r_native_and_cmdlet = report_from_outcome(
            outcome(PwshStatus::Completed {
                ok: false,
                cmdlet_errors: 1,
                native_exit: Some(0),
            }),
            Duration::from_secs(1),
            None,
        );
        assert_eq!(r_native_and_cmdlet.status, ToolStatus::Failure);
        assert_eq!(r_native_and_cmdlet.exit_code, Some(0));
        assert_eq!(
            r_native_and_cmdlet.notes,
            vec!["1 cmdlet error(s) in addition to the native program"]
        );

        let r_timeout =
            report_from_outcome(outcome(PwshStatus::TimedOut), Duration::from_secs(5), None);
        assert_eq!(r_timeout.status, ToolStatus::TimedOut);
        assert_eq!(
            r_timeout.termination.as_deref(),
            Some("no exit code (PowerShell session destroyed)")
        );

        let r_ended = report_from_outcome(
            outcome(PwshStatus::SessionEnded { code: None }),
            Duration::from_secs(1),
            None,
        );
        assert_eq!(r_ended.status, ToolStatus::Failure);
        assert_eq!(
            r_ended.termination.as_deref(),
            Some("PowerShell session ended without a status")
        );
    }
}
