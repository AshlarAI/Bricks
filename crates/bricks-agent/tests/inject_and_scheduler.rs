//! Integration tests for:
//! 1. `PermissionLevel::Forbidden` Bash calls denied without asking across ASK, EXECUTE, and CUSTOM.
//! 2. `Command::Inject` mid-run steering acceptance, rejection cases, and next-turn delivery.
//! 3. Wave scheduler concurrency (`is_concurrent_safe` parallel waves vs serialized calls and result order).

#[allow(dead_code)]
mod common;

use async_trait::async_trait;
use bricks_agent::control::scripted::{Reply, Script, ScriptedCatalog, ScriptedProvider};
use bricks_agent::control::*;
use bricks_agent::events::MAX_INJECTED_BYTES;
use bricks_agent::permission::{
    CustomRules, PermissionEffect, PermissionEngine, PermissionProfile, PolicyCell, SessionPolicy,
};
use bricks_agent::{Agent, BricksConfig};
use bricks_tools::bash::BashTool;
use bricks_tools::permissions::{
    AllowAll, PermissionDecision, PermissionPolicy, PermissionRequest,
};
use bricks_tools::{PermissionLevel, Tool, ToolCategory, ToolContext, ToolResult};
use bricks_types::Role;
use serde_json::{Value, json};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;
use tokio::sync::{Barrier, Notify};

// ─── Shared helpers ──────────────────────────────────────────────────────────

#[derive(Default)]
struct RecordingApprover(parking_lot::Mutex<Vec<String>>);

#[async_trait]
impl PermissionPolicy for RecordingApprover {
    async fn check(&self, request: &PermissionRequest) -> PermissionDecision {
        self.0.lock().push(request.tool_name.clone());
        PermissionDecision::Allow
    }
}

fn bricks_config() -> BricksConfig {
    let mut bricks = BricksConfig::default();
    bricks.agent.model = Some("test/a".into());
    bricks
}

async fn next_envelope(events: &mut EventStream) -> Envelope {
    tokio::time::timeout(Duration::from_secs(20), events.next())
        .await
        .expect("an event within 20 s")
        .expect("stream open")
}

async fn until_event(events: &mut EventStream, pred: impl Fn(&Event) -> bool) -> Vec<Envelope> {
    let mut out = Vec::new();
    loop {
        let e = next_envelope(events).await;
        let matched = pred(&e.event);
        out.push(e);
        if matched {
            return out;
        }
    }
}

async fn until_finished(events: &mut EventStream) -> Vec<Envelope> {
    until_event(events, |e| matches!(e, Event::RunFinished { .. })).await
}

async fn open_controller(
    dir: &tempfile::TempDir,
    replies: Vec<Reply>,
    policy: Option<SessionPolicy>,
    tools: Option<ToolFactory>,
) -> (Controller, EventStream, Arc<Script>) {
    let script = Script::new(replies);
    let catalog = ScriptedCatalog::new(&["a"], script.clone());
    let mut cfg = EngineConfig::new(dir.path(), catalog, bricks_config(), dir.path().join(".sessions"));
    cfg.permissions = policy.map(|p| common::default_store(dir.path(), &p));
    if let Some(factory) = tools {
        cfg.tools = factory;
    }
    let (ctl, mut events) = Controller::open(
        cfg,
        OpenOptions {
            session: SessionChoice::New,
            model: None,
            reasoning: None,
        },
    )
    .await
    .unwrap();
    let opened = next_envelope(&mut events).await;
    assert_eq!(opened.event.kind(), "session_opened");
    (ctl, events, script)
}

fn custom(edit: impl FnOnce(&mut CustomRules)) -> SessionPolicy {
    common::custom(edit)
}

// ─── 1. Forbidden Bash calls denied without asking ───────────────────────────

#[tokio::test]
async fn forbidden_bash_calls_are_denied_without_asking_in_engine_and_controller() {
    let bash = BashTool::default();
    let forbidden_inputs = [
        json!({ "command": "rm -rf /" }),
        json!({ "command": "sudo ls" }),
    ];

    let policies = [
        ("ASK", SessionPolicy::chosen(PermissionProfile::Ask)),
        ("EXECUTE", SessionPolicy::chosen(PermissionProfile::Execute)),
        (
            "CUSTOM(Bash:Allow)",
            custom(|c| {
                c.tools.insert("Bash".into(), PermissionEffect::Allow);
            }),
        ),
        (
            "CUSTOM(execute:Allow)",
            custom(|c| {
                c.execute = PermissionEffect::Allow;
            }),
        ),
    ];

    for (label, policy) in &policies {
        for input in &forbidden_inputs {
            let level = bash.permission_level_for(input);
            assert_eq!(level, PermissionLevel::Forbidden, "{label} {input}");

            let approver = Arc::new(RecordingApprover::default());
            let engine = PermissionEngine::new(PolicyCell::new(policy.clone(), 0), approver.clone());
            let req = PermissionRequest {
                tool_name: "Bash".into(),
                tool_input: input.clone(),
                permission_level: level,
                category: ToolCategory::Shell,
                description: format!("Run {}", input["command"]),
                id: "req-1".into(),
                preview: None,
                agent_id: None,
                policy_revision: None,
            };
            let decision = engine.check(&req).await;
            assert!(
                matches!(decision, PermissionDecision::Deny(_)),
                "{label} {input}: expected Deny, got {decision:?}"
            );
            assert!(
                approver.0.lock().is_empty(),
                "{label} {input}: Forbidden must never prompt the approver"
            );
        }
    }

    // End-to-end through Controller for ASK, EXECUTE, and CUSTOM (with Bash: Allow & execute: Allow).
    let controller_policies = [
        ("ASK", SessionPolicy::chosen(PermissionProfile::Ask)),
        ("EXECUTE", SessionPolicy::chosen(PermissionProfile::Execute)),
        (
            "CUSTOM(Bash:Allow,execute:Allow)",
            custom(|c| {
                c.execute = PermissionEffect::Allow;
                c.tools.insert("Bash".into(), PermissionEffect::Allow);
            }),
        ),
    ];

    for (label, policy) in controller_policies {
        let dir = tempfile::tempdir().unwrap();
        let (ctl, mut events, _script) = open_controller(
            &dir,
            vec![
                Reply::tools(vec![
                    ("b1", "Bash", json!({ "command": "rm -rf /" })),
                    ("b2", "Bash", json!({ "command": "sudo ls" })),
                ]),
                Reply::text("done"),
            ],
            Some(policy),
            None,
        )
        .await;

        ctl.send(Command::Submit {
            prompt: Prompt::text("run forbidden"),
        })
        .unwrap();
        let evs = until_finished(&mut events).await;

        assert!(
            !evs.iter()
                .any(|e| matches!(e.event, Event::ApprovalRequested { .. })),
            "{label}: Forbidden must not request approval"
        );

        let finished: Vec<_> = evs
            .iter()
            .filter_map(|e| match &e.event {
                Event::ToolFinished {
                    tool_call_id,
                    is_error,
                    executed,
                    output,
                    ..
                } => Some((tool_call_id.as_str(), *is_error, *executed, output.as_str())),
                _ => None,
            })
            .collect();
        assert_eq!(finished.len(), 2, "{label}: {finished:?}");
        for (id, is_error, executed, output) in finished {
            assert!(is_error, "{label} {id}: expected error, got {output}");
            assert_eq!(
                executed,
                Some(false),
                "{label} {id}: Forbidden command must not execute"
            );
        }
        ctl.close().await;
    }
}

// ─── 2. Command::Inject ──────────────────────────────────────────────────────

/// A tool that waits for an external `Notify` signal before returning.
struct GateTool {
    gate: Arc<Notify>,
}

#[async_trait]
impl Tool for GateTool {
    fn name(&self) -> &str {
        "Gate"
    }
    fn description(&self) -> &str {
        "Waits for test notification before returning."
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::ReadOnly
    }
    fn input_schema(&self) -> Value {
        json!({ "type": "object" })
    }
    async fn execute(&self, _input: Value, _ctx: &ToolContext) -> ToolResult {
        self.gate.notified().await;
        ToolResult::success("gate opened")
    }
}

#[tokio::test]
async fn command_inject_steers_active_run_and_reaches_next_model_turn() {
    let dir = tempfile::tempdir().unwrap();
    let gate = Arc::new(Notify::new());
    let gate_for_tools = Arc::clone(&gate);
    let factory: ToolFactory = Arc::new(move || {
        vec![Box::new(GateTool {
            gate: Arc::clone(&gate_for_tools),
        })]
    });

    let (ctl, mut events, script) = open_controller(
        &dir,
        vec![
            Reply::tool("g1", "Gate", json!({})),
            Reply::text("steered reply"),
        ],
        Some(SessionPolicy::chosen(PermissionProfile::Execute)),
        Some(factory),
    )
    .await;

    ctl.send(Command::Submit {
        prompt: Prompt::text("initial task"),
    })
    .unwrap();

    // Wait until the run is active and executing GateTool.
    until_event(&mut events, |e| matches!(e, Event::ToolStarted { .. })).await;
    assert!(matches!(ctl.snapshot().activity, Activity::Running { .. }));

    let steering = "Focus only on crate X";
    ctl.send(Command::Inject {
        text: steering.to_string(),
    })
    .unwrap();

    let evs = until_event(&mut events, |e| matches!(e, Event::MessageInjected { .. })).await;
    assert!(evs.iter().any(|e| matches!(
        &e.event,
        Event::MessageInjected { text } if text == steering
    )));

    // Unblock GateTool so turn 1 finishes and turn 2 begins.
    gate.notify_one();
    let rest = until_finished(&mut events).await;
    assert!(matches!(
        rest.last().unwrap().event,
        Event::RunFinished {
            outcome: RunOutcome::Succeeded,
            ..
        }
    ));

    let reqs = script.requests();
    assert_eq!(reqs.len(), 2, "expected 2 model turns");
    let turn2_user_texts: Vec<String> = reqs[1]
        .1
        .messages
        .iter()
        .filter(|m| m.role == Role::User)
        .filter_map(|m| m.get_text().map(str::to_string))
        .collect();
    assert!(
        turn2_user_texts.iter().any(|t| t == steering),
        "steering message missing from next turn: {turn2_user_texts:?}"
    );

    ctl.close().await;
}

#[tokio::test]
async fn command_inject_rejects_idle_empty_whitespace_and_oversized() {
    let dir = tempfile::tempdir().unwrap();
    let gate = Arc::new(Notify::new());
    let gate_for_tools = Arc::clone(&gate);
    let factory: ToolFactory = Arc::new(move || {
        vec![Box::new(GateTool {
            gate: Arc::clone(&gate_for_tools),
        })]
    });

    let (ctl, mut events, _script) = open_controller(
        &dir,
        vec![Reply::tool("g1", "Gate", json!({})), Reply::text("done")],
        Some(SessionPolicy::chosen(PermissionProfile::Execute)),
        Some(factory),
    )
    .await;

    // 1. Rejected when idle.
    let err = ctl
        .send(Command::Inject {
            text: "hello while idle".into(),
        })
        .unwrap_err();
    assert!(err.contains("no run"), "{err}");
    let evs = until_event(&mut events, |e| matches!(e, Event::CommandRejected { .. })).await;
    assert!(evs.iter().any(|e| matches!(
        &e.event,
        Event::CommandRejected { command, reason }
            if command == "inject" && reason.contains("no run")
    )));

    // Start an active run so active validation cases run.
    ctl.send(Command::Submit {
        prompt: Prompt::text("start"),
    })
    .unwrap();
    until_event(&mut events, |e| matches!(e, Event::ToolStarted { .. })).await;

    // 2. Rejected when empty or whitespace-only.
    for empty in ["", "   \n\t  "] {
        let err = ctl
            .send(Command::Inject {
                text: empty.to_string(),
            })
            .unwrap_err();
        assert!(err.contains("empty"), "{err}");
        let evs = until_event(&mut events, |e| matches!(e, Event::CommandRejected { .. })).await;
        assert!(evs.iter().any(|e| matches!(
            &e.event,
            Event::CommandRejected { command, reason }
                if command == "inject" && reason.contains("empty")
        )));
    }

    // 3. Rejected when over MAX_INJECTED_BYTES.
    let oversized = "x".repeat(MAX_INJECTED_BYTES + 1);
    let err = ctl.send(Command::Inject { text: oversized }).unwrap_err();
    assert!(err.contains("maximum length"), "{err}");
    let evs = until_event(&mut events, |e| matches!(e, Event::CommandRejected { .. })).await;
    assert!(evs.iter().any(|e| matches!(
        &e.event,
        Event::CommandRejected { command, reason }
            if command == "inject" && reason.contains("maximum length")
    )));

    gate.notify_one();
    until_finished(&mut events).await;

    // 4. Rejected again once the run has finished and controller is idle.
    let err = ctl
        .send(Command::Inject {
            text: "after finish".into(),
        })
        .unwrap_err();
    assert!(err.contains("no run"), "{err}");
    let evs = until_event(&mut events, |e| matches!(e, Event::CommandRejected { .. })).await;
    assert!(evs.iter().any(|e| matches!(
        &e.event,
        Event::CommandRejected { command, .. } if command == "inject"
    )));

    ctl.close().await;
}

// ─── 3. Wave scheduler (2.3) ─────────────────────────────────────────────────

#[derive(Default)]
struct WaveRecorder {
    active_concurrent: AtomicUsize,
    max_concurrent: AtomicUsize,
    active_serial: AtomicUsize,
    max_serial: AtomicUsize,
    active_total: AtomicUsize,
    max_total: AtomicUsize,
    events: parking_lot::Mutex<Vec<String>>,
}

impl WaveRecorder {
    fn record(&self, entry: impl Into<String>) {
        self.events.lock().push(entry.into());
    }
}

fn bump_max(current: &AtomicUsize, max: &AtomicUsize) -> usize {
    let val = current.fetch_add(1, Ordering::SeqCst) + 1;
    max.fetch_max(val, Ordering::SeqCst);
    val
}

/// Concurrent-safe tool (`is_concurrent_safe() == true`). When `barrier` is set,
/// calls synchronize at the barrier to prove true concurrent execution.
struct ConcurrentSafeTool {
    recorder: Arc<WaveRecorder>,
    barrier: Option<Arc<Barrier>>,
}

#[async_trait]
impl Tool for ConcurrentSafeTool {
    fn name(&self) -> &str {
        "SafeRead"
    }
    fn description(&self) -> &str {
        "Concurrent-safe test tool"
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::ReadOnly
    }
    fn is_concurrent_safe(&self, _input: &Value) -> bool {
        true
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "label": { "type": "string" } },
            "required": ["label"]
        })
    }
    async fn execute(&self, input: Value, _ctx: &ToolContext) -> ToolResult {
        let label = input["label"].as_str().unwrap_or("?").to_string();
        bump_max(&self.recorder.active_total, &self.recorder.max_total);
        bump_max(
            &self.recorder.active_concurrent,
            &self.recorder.max_concurrent,
        );
        self.recorder.record(format!("start:{label}"));
        if let Some(barrier) = &self.barrier {
            barrier.wait().await;
        } else {
            tokio::time::sleep(Duration::from_millis(15)).await;
        }
        self.recorder.record(format!("end:{label}"));
        self.recorder
            .active_concurrent
            .fetch_sub(1, Ordering::SeqCst);
        self.recorder.active_total.fetch_sub(1, Ordering::SeqCst);
        ToolResult::success(format!("safe:{label}"))
    }
}

/// Non-concurrent-safe tool (`is_concurrent_safe() == false`).
struct NonSafeTool {
    recorder: Arc<WaveRecorder>,
}

#[async_trait]
impl Tool for NonSafeTool {
    fn name(&self) -> &str {
        "SerialWrite"
    }
    fn description(&self) -> &str {
        "Non-concurrent-safe test tool"
    }
    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::Execute
    }
    fn is_concurrent_safe(&self, _input: &Value) -> bool {
        false
    }
    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": { "label": { "type": "string" } },
            "required": ["label"]
        })
    }
    async fn execute(&self, input: Value, _ctx: &ToolContext) -> ToolResult {
        let label = input["label"].as_str().unwrap_or("?").to_string();
        let total = bump_max(&self.recorder.active_total, &self.recorder.max_total);
        let serial = bump_max(&self.recorder.active_serial, &self.recorder.max_serial);
        assert_eq!(total, 1, "serial tool {label} overlapped with another call");
        assert_eq!(serial, 1, "serial tool {label} overlapped with serial call");
        self.recorder.record(format!("start:{label}"));
        tokio::time::sleep(Duration::from_millis(20)).await;
        self.recorder.record(format!("end:{label}"));
        self.recorder.active_serial.fetch_sub(1, Ordering::SeqCst);
        self.recorder.active_total.fetch_sub(1, Ordering::SeqCst);
        ToolResult::success(format!("serial:{label}"))
    }
}

#[tokio::test]
async fn concurrent_safe_tools_in_one_turn_execute_concurrently() {
    let dir = tempfile::tempdir().unwrap();
    let recorder = Arc::new(WaveRecorder::default());
    let barrier = Arc::new(Barrier::new(3));
    let script = Script::new(vec![
        Reply::tools(vec![
            ("c1", "SafeRead", json!({ "label": "r1" })),
            ("c2", "SafeRead", json!({ "label": "r2" })),
            ("c3", "SafeRead", json!({ "label": "r3" })),
        ]),
        Reply::text("done"),
    ]);

    let agent = Agent::builder()
        .provider(ScriptedProvider::new("test", script))
        .working_dir(dir.path())
        .tool(ConcurrentSafeTool {
            recorder: Arc::clone(&recorder),
            barrier: Some(barrier),
        })
        .permission_policy(AllowAll)
        .auto_compact(false)
        .build()
        .unwrap();

    let out = tokio::time::timeout(Duration::from_secs(5), agent.run("parallel reads"))
        .await
        .expect("barrier must not deadlock if tools run concurrently")
        .unwrap();

    assert_eq!(recorder.max_concurrent.load(Ordering::SeqCst), 3);
    assert_eq!(out.tool_calls.len(), 3);
    let results: Vec<&str> = out
        .tool_calls
        .iter()
        .map(|c| c.result.lines().last().unwrap_or(""))
        .collect();
    assert_eq!(results, vec!["safe:r1", "safe:r2", "safe:r3"]);
}

#[tokio::test]
async fn non_concurrent_safe_tools_execute_strictly_sequentially() {
    let dir = tempfile::tempdir().unwrap();
    let recorder = Arc::new(WaveRecorder::default());
    let script = Script::new(vec![
        Reply::tools(vec![
            ("s1", "SerialWrite", json!({ "label": "w1" })),
            ("s2", "SerialWrite", json!({ "label": "w2" })),
            ("s3", "SerialWrite", json!({ "label": "w3" })),
        ]),
        Reply::text("done"),
    ]);

    let agent = Agent::builder()
        .provider(ScriptedProvider::new("test", script))
        .working_dir(dir.path())
        .tool(NonSafeTool {
            recorder: Arc::clone(&recorder),
        })
        .permission_policy(AllowAll)
        .auto_compact(false)
        .build()
        .unwrap();

    let out = agent.run("serial writes").await.unwrap();
    assert_eq!(recorder.max_serial.load(Ordering::SeqCst), 1);
    assert_eq!(recorder.max_total.load(Ordering::SeqCst), 1);
    assert_eq!(
        *recorder.events.lock(),
        vec![
            "start:w1",
            "end:w1",
            "start:w2",
            "end:w2",
            "start:w3",
            "end:w3",
        ]
    );
    let results: Vec<&str> = out
        .tool_calls
        .iter()
        .map(|c| c.result.lines().last().unwrap_or(""))
        .collect();
    assert_eq!(results, vec!["serial:w1", "serial:w2", "serial:w3"]);

    // Also verify mutative BashTool calls in the same turn run in order without racing.
    let bash_dir = tempfile::tempdir().unwrap();
    let bash_script = Script::new(vec![
        Reply::tools(vec![
            ("b1", "Bash", json!({ "command": "echo hi > a.txt" })),
            (
                "b2",
                "Bash",
                json!({ "command": "cat a.txt > b.txt && echo bye >> b.txt" }),
            ),
        ]),
        Reply::text("done"),
    ]);
    let bash_agent = Agent::builder()
        .provider(ScriptedProvider::new("test", bash_script))
        .working_dir(bash_dir.path())
        .tool(BashTool::default())
        .permission_policy(AllowAll)
        .auto_compact(false)
        .build()
        .unwrap();

    let bash_out = bash_agent.run("mutative bash").await.unwrap();
    assert_eq!(bash_out.tool_calls.len(), 2);
    assert!(!bash_out.tool_calls[0].is_error);
    assert!(!bash_out.tool_calls[1].is_error);
    let content = std::fs::read_to_string(bash_dir.path().join("b.txt")).unwrap();
    assert_eq!(content, "hi\nbye\n");
    if let Some(id) = bash_agent.session_id() {
        bricks_tools::shell::close_session(id).await;
    }
}

#[tokio::test]
async fn mixed_wave_batch_runs_waves_in_order_and_preserves_result_order() {
    let dir = tempfile::tempdir().unwrap();
    let recorder = Arc::new(WaveRecorder::default());

    // [concurrent_safe, concurrent_safe, non_safe, non_safe, concurrent_safe]
    let script = Script::new(vec![
        Reply::tools(vec![
            ("id-0", "SafeRead", json!({ "label": "c0" })),
            ("id-1", "SafeRead", json!({ "label": "c1" })),
            ("id-2", "SerialWrite", json!({ "label": "n2" })),
            ("id-3", "SerialWrite", json!({ "label": "n3" })),
            ("id-4", "SafeRead", json!({ "label": "c4" })),
        ]),
        Reply::text("all waves complete"),
    ]);

    let agent = Agent::builder()
        .provider(ScriptedProvider::new("test", script.clone()))
        .working_dir(dir.path())
        .tool(ConcurrentSafeTool {
            recorder: Arc::clone(&recorder),
            barrier: None,
        })
        .tool(NonSafeTool {
            recorder: Arc::clone(&recorder),
        })
        .permission_policy(AllowAll)
        .auto_compact(false)
        .build()
        .unwrap();

    let out = agent.run("mixed wave").await.unwrap();
    assert_eq!(recorder.max_serial.load(Ordering::SeqCst), 1);

    // Check wave ordering in execution trace:
    // Wave 1 (c0, c1) finishes completely before Wave 2 (n2), which finishes before
    // Wave 3 (n3), which finishes before Wave 4 (c4).
    let log = recorder.events.lock().clone();
    let pos = |entry: &str| {
        log.iter()
            .position(|e| e == entry)
            .unwrap_or_else(|| panic!("missing {entry} in {log:?}"))
    };
    assert!(pos("end:c0") < pos("start:n2"), "{log:?}");
    assert!(pos("end:c1") < pos("start:n2"), "{log:?}");
    assert!(pos("end:n2") < pos("start:n3"), "{log:?}");
    assert!(pos("end:n3") < pos("start:c4"), "{log:?}");

    // Tool call records and next-turn ToolResult blocks keep exact original call order.
    let ids: Vec<&str> = out.tool_calls.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, vec!["id-0", "id-1", "id-2", "id-3", "id-4"]);
    let results: Vec<&str> = out
        .tool_calls
        .iter()
        .map(|c| c.result.lines().last().unwrap_or(""))
        .collect();
    assert_eq!(
        results,
        vec![
            "safe:c0",
            "safe:c1",
            "serial:n2",
            "serial:n3",
            "safe:c4"
        ]
    );

    let reqs = script.requests();
    assert_eq!(reqs.len(), 2);
    let result_ids: Vec<String> = reqs[1]
        .1
        .messages
        .iter()
        .flat_map(|m| m.content_blocks())
        .filter_map(|b| match b {
            bricks_types::ContentBlock::ToolResult { tool_use_id, .. } => {
                Some(tool_use_id.clone())
            }
            _ => None,
        })
        .collect();
    assert_eq!(result_ids, vec!["id-0", "id-1", "id-2", "id-3", "id-4"]);
}
