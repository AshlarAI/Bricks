//! The native sub-agent tools: `Agent` (one mission or several, each in the
//! background) and `Managent` (instances, results, waits, ChangeSets, rebasing).
//! They are adapters of the session's spawner and runtime; none runs agents on
//! its own.
//!
//! `Agent` is a delegation: the session's policy allows it (EXECUTE, or
//! CUSTOM with `Agent` set to Allow) or refuses it at once (ASK); it never
//! asks. A launched sub-agent asks for nothing either (unless its profile sets
//! `permissions: ask`); Deny rules still hold for it.

use super::runtime::{
    AgentRuntime, InstanceRecord, RuntimeHandle, WaitAgentStatus, WaitManyOutcome, WaitMode,
    WaitStatus, while_waiting,
};
use super::spawn::{AgentSpawnRequest, AgentSpawner, BatchOptions, Spawned, render_result};
use super::workspace::{ChangeSet, ChangeSetState, RebaseOutcome, WsError};
use async_trait::async_trait;
use bricks_tools::{PermissionLevel, Tool, ToolCategory, ToolContext, ToolResult};
use serde::Deserialize;
use serde_json::{Value, json};
use std::sync::Arc;
use std::time::Duration;

const AGENT_DESCRIPTION: &str = "Delegate one mission, or several with `missions`, to sub-agents \
working in the background. Returns their ids at once; each report reaches you as it ends. \
By default a sub-agent starts with a fresh context (pass `fork: true` to inherit the active \
conversation cleanly before this turn).";

fn item_schema() -> Value {
    json!({
        "prompt": {
            "type": "string",
            "minLength": 1,
            "description": "Self-contained mission instructions structured with: Objective, Scope (files/areas), Expected result, Rules/constraints, and Response format."
        },
        "description": {
            "type": "string",
            "description": "Short 3-5 word label for UI and `Managent list/status` (not injected into the child prompt)."
        },
        "profile": {
            "type": "string",
            "description": "Optional profile name (default \"general\"). Available profiles and their policies are listed in the tool description."
        },
        "model": {
            "type": "string",
            "description": "Optional `inherit` (default) or `provider_id/model_id`. Do NOT override unless explicitly requested by the user."
        },
        "effort": {
            "type": "string",
            "description": "Optional reasoning effort (`inherit` by default, or `low`, `medium`, `high`, or a model profile id). Do NOT override unless explicitly requested by the user."
        },
        "fork": {
            "type": "boolean",
            "description": "Optional boolean (default `false`). When `true`, clones the parent's active conversation history cleanly before the current assistant turn into the child."
        },
        "isolation": {
            "type": "string",
            "enum": ["shared", "worktree"],
            "description": "Workspace isolation: `shared` (default, falling back to the profile's isolation when omitted; one writer at a time) or `worktree` (isolated git worktree producing a ChangeSet; requires a git repository)."
        }
    })
}

fn render_spawned(s: Spawned) -> ToolResult {
    match s {
        Spawned::Results(rs) => {
            let n = rs.len();
            let all_ok = rs.iter().all(|r| r.status == "completed");
            let text = if n == 1 {
                render_result(&rs[0])
            } else {
                rs.iter()
                    .enumerate()
                    .map(|(i, r)| format!("### agents[{i}]\n{}", render_result(r)))
                    .collect::<Vec<_>>()
                    .join("\n\n")
            };
            let meta = serde_json::to_value(&rs).unwrap_or(Value::Null);
            if all_ok {
                ToolResult::success(text).with_metadata(meta)
            } else {
                ToolResult::error(text).with_metadata(meta)
            }
        }
        Spawned::Handles(hs) => {
            let lines: Vec<String> = hs
                .iter()
                .map(|h| {
                    let desc = h
                        .description
                        .as_deref()
                        .map(|d| format!(" \"{d}\""))
                        .unwrap_or_default();
                    format!(
                        "- {} ({}{}, {}{}): {}",
                        h.agent_id,
                        h.profile,
                        desc,
                        h.isolation,
                        h.branch
                            .as_deref()
                            .map(|b| format!(", branch {b}"))
                            .unwrap_or_default(),
                        h.task
                    )
                })
                .collect();
            ToolResult::success(format!(
                "{} sub-agent(s) started in the background. Each report reaches you between two turns as it ends; `Managent wait` waits for completion when you have nothing else to do. Messagent writes to them.\n{}",
                hs.len(),
                lines.join("\n")
            ))
            .with_metadata(serde_json::to_value(&hs).unwrap_or(Value::Null))
        }
    }
}

/// `Agent`: delegate one or more missions to sub-agents.
pub struct NativeAgentTool {
    spawner: Arc<AgentSpawner>,
}

impl NativeAgentTool {
    pub fn new(spawner: Arc<AgentSpawner>) -> Self {
        Self { spawner }
    }
}

#[async_trait]
impl Tool for NativeAgentTool {
    fn name(&self) -> &str {
        "Agent"
    }

    fn description(&self) -> &str {
        AGENT_DESCRIPTION
    }

    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::Execute
    }

    fn category(&self) -> ToolCategory {
        ToolCategory::Orchestration
    }

    fn input_schema(&self) -> Value {
        let mut properties = item_schema();
        properties["missions"] = json!({
            "type": "array",
            "minItems": 1,
            "maxItems": MAX_MISSIONS,
            "description": "Several missions at once (16 at most), instead of top-level `prompt`: each one starts its own sub-agent.",
            "items": { "type": "object", "properties": item_schema(), "required": ["prompt"] }
        });
        json!({ "type": "object", "properties": properties })
    }

    fn to_definition(&self) -> bricks_types::ToolDefinition {
        let profiles = self.spawner.profiles().format_for_tool();
        bricks_types::ToolDefinition {
            name: self.name().to_string(),
            description: format!("{AGENT_DESCRIPTION}\n\n{profiles}"),
            input_schema: self.input_schema(),
        }
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        let requests = match missions(input.clone()) {
            Ok(r) => r,
            Err(e) => {
                return bricks_tools::tool_feedback::invalid_input(
                    self,
                    &input,
                    format!(
                        "{e}. Nothing was started. (`system_prompt` is not accepted: choose a \
                         `profile` instead.)"
                    ),
                );
            }
        };
        let batch = requests.len() > 1;
        match self
            .spawner
            .spawn_batch(
                requests,
                BatchOptions {
                    background: true,
                    fail_fast: false,
                    batch,
                },
                ctx,
            )
            .await
        {
            Err(e) => ToolResult::error(e.to_string()),
            Ok(s) => render_spawned(s),
        }
    }
}

/// Missions of one `Agent` call, at most: every report then fits the
/// orchestrator's queue.
const MAX_MISSIONS: usize = 16;

/// The missions of an `Agent` call: one (`prompt`/`task` and its options) or a
/// list (`missions`), never both.
fn missions(input: Value) -> Result<Vec<AgentSpawnRequest>, String> {
    #[derive(Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Many {
        missions: Vec<AgentSpawnRequest>,
    }
    if input.get("missions").is_some() {
        let many: Many = serde_json::from_value(input).map_err(|e| e.to_string())?;
        if many.missions.is_empty() {
            return Err("`missions` is empty".into());
        }
        if many.missions.len() > MAX_MISSIONS {
            return Err(format!(
                "{} missions at once; {MAX_MISSIONS} at most",
                many.missions.len()
            ));
        }
        return Ok(many.missions);
    }
    let one: AgentSpawnRequest = serde_json::from_value(input).map_err(|e| e.to_string())?;
    Ok(vec![one])
}

/// `Managent`: manage sub-agents, wait on completions, read results, and review/rebase/apply ChangeSets.
pub struct ManagentTool {
    spawner: Arc<AgentSpawner>,
}

impl ManagentTool {
    pub fn new(spawner: Arc<AgentSpawner>) -> Self {
        Self { spawner }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ControlInput {
    action: String,
    #[serde(default)]
    agent_id: Option<String>,
    #[serde(default)]
    agent_ids: Option<Vec<String>>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    changeset_id: Option<String>,
    #[serde(default)]
    verify_cmd: Option<String>,
    #[serde(default)]
    timeout_ms: Option<u64>,
    /// `resume`: what the ended sub-agent should do now.
    #[serde(default)]
    prompt: Option<String>,
}

const MAX_WAIT_MS: u64 = 600_000;

/// Viewer: `None` for the session's agent (sees the session), else the
/// sub-agent (sees its descendants).
pub(super) fn viewer(ctx: &ToolContext) -> Option<String> {
    ctx.extensions
        .get::<super::spawn::AgentIdentity>()
        .filter(|i| i.parent_id.is_some())
        .map(|i| i.agent_id.clone())
}

fn changeset_state_str(state: ChangeSetState) -> &'static str {
    match state {
        ChangeSetState::Ready => "ready",
        ChangeSetState::Applied => "applied",
        ChangeSetState::Conflict => "conflict",
        ChangeSetState::Discarded => "discarded",
    }
}

fn changeset_for_record(r: &InstanceRecord, rt: &AgentRuntime) -> Option<ChangeSet> {
    rt.workspaces.changeset_of(&r.info.agent_id).or_else(|| {
        r.result
            .as_ref()
            .and_then(|res| res.changeset.as_deref())
            .and_then(|id| rt.workspaces.changeset(id))
    })
}

fn record_metadata(r: &InstanceRecord, cs: Option<&ChangeSet>) -> Value {
    let cs_id = cs
        .map(|c| c.id.as_str())
        .or_else(|| r.result.as_ref().and_then(|res| res.changeset.as_deref()));
    let cs_state = cs.map(|c| changeset_state_str(c.state));
    json!({
        "agent_id": r.info.agent_id,
        "description": r.description(),
        "profile": r.info.profile,
        "state": r.state.as_str(),
        "elapsed_ms": r.elapsed_ms(),
        "last_action": r.last_action,
        "changeset": cs_id,
        "changeset_state": cs_state,
    })
}

pub fn render_record(r: &InstanceRecord) -> String {
    render_record_with_changeset(r, None)
}

pub fn render_record_with_runtime(r: &InstanceRecord, rt: &AgentRuntime) -> String {
    let cs = changeset_for_record(r, rt);
    render_record_with_changeset(r, cs.as_ref())
}

pub fn render_record_with_changeset(r: &InstanceRecord, cs: Option<&ChangeSet>) -> String {
    let elapsed_ms = r.elapsed_ms();
    let desc = r
        .description()
        .map(|d| format!(" · \"{d}\""))
        .unwrap_or_default();
    let mut s = format!(
        "{}{} · {} · {}{} · elapsed {} ({}ms) · {} · depth {} · {}",
        r.info.agent_id,
        desc,
        r.info.profile,
        r.state.as_str(),
        r.reason
            .as_deref()
            .map(|x| format!(" ({x})"))
            .unwrap_or_default(),
        bricks_types::duration::display_ms_u64(elapsed_ms),
        elapsed_ms,
        if r.background {
            "background"
        } else {
            "foreground"
        },
        r.info.depth,
        r.info.isolation
    );
    if let Some(b) = &r.info.branch {
        s.push_str(&format!(" · branch {b}"));
    }
    if let Some(action) = &r.last_action {
        s.push_str(&format!(" · last_action: {action}"));
    }
    if let Some(cs) = cs {
        s.push_str(&format!(
            " · ChangeSet {} ({})",
            cs.id,
            changeset_state_str(cs.state)
        ));
    } else if let Some(cs_id) = r.result.as_ref().and_then(|res| res.changeset.as_deref()) {
        s.push_str(&format!(" · ChangeSet {cs_id}"));
    }
    if let Some(res) = &r.result {
        s.push_str(&format!(
            " · {} in {}",
            res.status,
            bricks_types::duration::display_ms_u64(res.duration_ms)
        ));
    }
    s.push_str(&format!("\n  task: {}", r.info.task));
    s
}

fn format_wait_agent(a: &WaitAgentStatus, finished: bool) -> String {
    let desc = a
        .description
        .as_deref()
        .map(|d| format!(" \"{d}\""))
        .unwrap_or_default();
    let mut line = format!(
        "- {} ({}{}) · {} · elapsed {} ({}ms)",
        a.agent_id,
        a.profile,
        desc,
        a.state.as_str(),
        bricks_types::duration::display_ms_u64(a.elapsed_ms),
        a.elapsed_ms,
    );
    if let Some(action) = &a.last_action {
        line.push_str(&format!(" · last_action: {action}"));
    }
    if let Some(cs) = &a.changeset {
        let state = a
            .changeset_state
            .map(changeset_state_str)
            .unwrap_or("unknown");
        line.push_str(&format!(" · ChangeSet {cs} ({state})"));
    }
    if finished {
        if let Some(err) = &a.error {
            line.push_str(&format!(" · error: {err}"));
        }
        line.push_str(&format!(
            " — {} has ended; Managent result {} gives its report.",
            a.agent_id, a.agent_id
        ));
    }
    line
}

fn render_wait_outcome(outcome: &WaitManyOutcome, timeout: Duration) -> ToolResult {
    let meta = serde_json::to_value(outcome).unwrap_or(Value::Null);
    if outcome.status == WaitStatus::Cancelled {
        return ToolResult::error("the wait was cancelled.").with_metadata(meta);
    }
    let mode_str = match outcome.mode {
        WaitMode::Any => "any",
        WaitMode::All => "all",
    };
    let mut lines = Vec::new();
    match outcome.status {
        WaitStatus::TimedOut => lines.push(format!(
            "Timed out after {} (mode: {mode_str}; nothing was stopped).",
            bricks_types::duration::display_ms(timeout)
        )),
        WaitStatus::Ready => lines.push(format!(
            "Wait ready (mode: {mode_str}, delivered: {}, finished: {}, pending: {}).",
            outcome.delivered,
            outcome.finished.len(),
            outcome.pending.len()
        )),
        WaitStatus::Cancelled => unreachable!(),
    }
    if outcome.delivered > 0 {
        lines.push(format!(
            "{} new delivery(ies) for you (reports or messages): you read them next turn.",
            outcome.delivered
        ));
    }
    if !outcome.finished.is_empty() {
        lines.push(format!("Finished ({}):", outcome.finished.len()));
        for a in &outcome.finished {
            lines.push(format_wait_agent(a, true));
        }
    }
    if !outcome.pending.is_empty() {
        lines.push(format!("Pending ({}):", outcome.pending.len()));
        for a in &outcome.pending {
            lines.push(format_wait_agent(a, false));
        }
    }
    ToolResult::success(lines.join("\n")).with_metadata(meta)
}

#[async_trait]
impl Tool for ManagentTool {
    fn name(&self) -> &str {
        "Managent"
    }

    fn description(&self) -> &str {
        "Manage and monitor your sub-agents: `list` & `status` (agent_id; shows description, \
         profile, state, elapsed_ms, last_action, ChangeSet), `result` (agent_id), `wait` \
         (mode: \"any\" default | \"all\"; agent_id or agent_ids; timeout_ms), `resume` \
         (agent_id, prompt), `cancel` (agent_id); and their ChangeSets (never auto-applied): \
         `inspect_changes`, `check_changes`, `rebase_changes` (optional `verify_cmd`), \
         `apply_changes`, `discard_changes` (by `changeset_id` or `agent_id`)."
    }

    fn permission_level(&self) -> PermissionLevel {
        PermissionLevel::Write
    }

    /// Reads are read-only; cancel/resume (and rebase with verify_cmd) are execute; apply/discard/rebase write.
    fn permission_level_for(&self, input: &Value) -> PermissionLevel {
        match input["action"].as_str().unwrap_or("") {
            "list" | "status" | "result" | "wait" | "inspect_changes" | "check_changes" => {
                PermissionLevel::ReadOnly
            }
            "cancel" | "resume" => PermissionLevel::Execute,
            "rebase_changes"
                if input["verify_cmd"]
                    .as_str()
                    .is_some_and(|s| !s.trim().is_empty()) =>
            {
                PermissionLevel::Execute
            }
            _ => PermissionLevel::Write,
        }
    }

    fn category(&self) -> ToolCategory {
        ToolCategory::Orchestration
    }

    fn input_schema(&self) -> Value {
        json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "list",
                        "status",
                        "result",
                        "wait",
                        "resume",
                        "cancel",
                        "inspect_changes",
                        "check_changes",
                        "rebase_changes",
                        "apply_changes",
                        "discard_changes"
                    ]
                },
                "agent_id": {
                    "type": "string",
                    "description": "Target sub-agent id (for status, result, wait, resume, cancel, or finding an agent's ChangeSet)."
                },
                "agent_ids": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "wait: list of sub-agent ids to wait on (optional; defaults to all active visible sub-agents)."
                },
                "mode": {
                    "type": "string",
                    "enum": ["any", "all"],
                    "description": "wait: \"any\" (default, returns on first delivery or completion) or \"all\" (waits until all targets finish)."
                },
                "prompt": {
                    "type": "string",
                    "description": "resume: what the ended sub-agent should do now."
                },
                "changeset_id": {
                    "type": "string",
                    "description": "For inspect_changes, check_changes, rebase_changes, apply_changes, discard_changes (or give agent_id)."
                },
                "verify_cmd": {
                    "type": "string",
                    "description": "rebase_changes: optional shell command (`sh -c`) run inside the temporary rebased worktree before accepting the rebased ChangeSet."
                },
                "timeout_ms": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": MAX_WAIT_MS,
                    "description": "wait: how long at most (default 60000 ms); a timeout stops nothing."
                }
            },
            "required": ["action"]
        })
    }

    async fn execute(&self, input: Value, ctx: &ToolContext) -> ToolResult {
        let i: ControlInput = match bricks_tools::tool_feedback::parse_input(self, &input) {
            Ok(i) => i,
            Err(e) => return e,
        };
        let rt = ctx
            .extensions
            .get::<RuntimeHandle>()
            .map(|h| Arc::clone(&h.0))
            .unwrap_or_else(|| Arc::clone(self.spawner.runtime()));
        let who = viewer(ctx);
        let need_agent = |id: &str| -> Result<String, ToolResult> {
            if rt.record(id).is_none() || !rt.visible_to(id, who.as_deref()) {
                return Err(ToolResult::error(format!(
                    "no sub-agent `{id}` in your scope (only your own sub-agents and their descendants are visible)"
                )));
            }
            Ok(id.to_string())
        };
        let need_opt_agent = |id: &Option<String>| -> Result<String, ToolResult> {
            let id = id
                .as_deref()
                .ok_or_else(|| ToolResult::error(format!("`{}` needs `agent_id`", i.action)))?;
            need_agent(id)
        };
        match i.action.as_str() {
            "list" => {
                let recs: Vec<_> = rt
                    .records()
                    .into_iter()
                    .filter(|r| rt.visible_to(&r.info.agent_id, who.as_deref()))
                    .collect();
                if recs.is_empty() {
                    return ToolResult::success("No sub-agent in your scope.");
                }
                let st = rt.scheduler.stats();
                let mut items = Vec::with_capacity(recs.len());
                let mut rendered = Vec::with_capacity(recs.len());
                for r in &recs {
                    let cs = changeset_for_record(r, &rt);
                    rendered.push(render_record_with_changeset(r, cs.as_ref()));
                    items.push(record_metadata(r, cs.as_ref()));
                }
                ToolResult::success(format!(
                    "{} sub-agent(s); slots {}/{} active, {} queued.\n{}",
                    recs.len(),
                    st.active,
                    st.max_concurrent,
                    st.queued,
                    rendered.join("\n")
                ))
                .with_metadata(json!({ "agents": items, "scheduler": st }))
            }
            "status" => match need_opt_agent(&i.agent_id) {
                Err(e) => e,
                Ok(id) => {
                    let r = rt.record(&id).expect("checked");
                    let cs = changeset_for_record(&r, &rt);
                    ToolResult::success(render_record_with_changeset(&r, cs.as_ref()))
                        .with_metadata(record_metadata(&r, cs.as_ref()))
                }
            },
            "result" => match need_opt_agent(&i.agent_id) {
                Err(e) => e,
                Ok(id) => {
                    let r = rt.record(&id).expect("checked");
                    match &r.result {
                        Some(res) => ToolResult::success(render_result(res))
                            .with_metadata(serde_json::to_value(res).unwrap_or(Value::Null)),
                        None => ToolResult::success(format!(
                            "{id} has no result yet ({}). Use wait.",
                            r.state.as_str()
                        )),
                    }
                }
            },
            "wait" => {
                let mode = match i.mode.as_deref().map(str::trim) {
                    None | Some("") => WaitMode::Any,
                    Some(m) if m.eq_ignore_ascii_case("any") => WaitMode::Any,
                    Some(m) if m.eq_ignore_ascii_case("all") => WaitMode::All,
                    Some(other) => {
                        return ToolResult::error(format!(
                            "unknown wait `mode` `{other}`: expected `any` or `all`"
                        ));
                    }
                };
                let mut ids = Vec::new();
                if let Some(id) = &i.agent_id {
                    match need_agent(id) {
                        Err(e) => return e,
                        Ok(valid) => ids.push(valid),
                    }
                }
                if let Some(many) = &i.agent_ids {
                    for id in many {
                        match need_agent(id) {
                            Err(e) => return e,
                            Ok(valid) => {
                                if !ids.contains(&valid) {
                                    ids.push(valid);
                                }
                            }
                        }
                    }
                }
                let t = Duration::from_millis(i.timeout_ms.unwrap_or(60_000).clamp(1, MAX_WAIT_MS));
                let cancel = crate::subagent::run_token(&ctx.extensions).unwrap_or_default();
                let me = who
                    .clone()
                    .unwrap_or_else(|| super::messagent::MAIN.to_string());
                let outcome =
                    while_waiting(&ctx.extensions, rt.wait_many(&me, &ids, mode, t, &cancel)).await;
                render_wait_outcome(&outcome, t)
            }
            "resume" => match need_opt_agent(&i.agent_id) {
                Err(e) => e,
                Ok(id) => {
                    let prompt = i.prompt.clone().unwrap_or_default();
                    match self.spawner.resume(&id, &prompt, ctx, who.as_deref()).await {
                        Ok(info) => ToolResult::success(format!(
                            "{id} resumed (execution {}): it continues its own conversation in \
                             parallel. Use wait for its result.",
                            rt.execution(&id).unwrap_or(1)
                        ))
                        .with_metadata(serde_json::to_value(&info).unwrap_or(Value::Null)),
                        Err(e) => ToolResult::error(e.to_string()),
                    }
                }
            },
            "cancel" => match need_opt_agent(&i.agent_id) {
                Err(e) => e,
                Ok(id) => {
                    rt.mark_stopped(&id);
                    let n = rt.cancel(&id);
                    ToolResult::success(format!(
                        "cancellation requested for {id} and its descendants ({n} running)."
                    ))
                }
            },
            "inspect_changes" | "check_changes" | "rebase_changes" | "apply_changes"
            | "discard_changes" => {
                let cs_id = match (&i.changeset_id, &i.agent_id) {
                    (Some(c), _) => c.clone(),
                    (None, Some(a)) => match need_agent(a) {
                        Err(e) => return e,
                        Ok(a) => match rt.workspaces.changeset_of(&a) {
                            Some(c) => c.id,
                            None => return ToolResult::error(format!("{a} has no ChangeSet")),
                        },
                    },
                    (None, None) => return ToolResult::error("give `changeset_id` or `agent_id`"),
                };
                let Some(cs) = rt.workspaces.changeset(&cs_id) else {
                    return ToolResult::error(format!("no ChangeSet `{cs_id}`"));
                };
                if !rt.visible_to(&cs.agent_id, who.as_deref()) {
                    return ToolResult::error(format!("no ChangeSet `{cs_id}` in your scope"));
                }
                match i.action.as_str() {
                    "inspect_changes" => {
                        let files: Vec<String> = cs
                            .files
                            .iter()
                            .map(|f| match (f.added, f.removed) {
                                (Some(a), Some(r)) => {
                                    format!("{} {} (+{a} −{r})", f.status, f.path)
                                }
                                _ => format!("{} {} (binary)", f.status, f.path),
                            })
                            .collect();
                        let (patch, cut) =
                            rt.workspaces.patch_text(&cs_id, 20_000).unwrap_or_default();
                        ToolResult::success(format!(
                            "ChangeSet {} of {} · {:?} · branch {} · base {}\nFiles:\n{}\n\n{}{}",
                            cs.id,
                            cs.agent_id,
                            cs.state,
                            cs.branch,
                            &cs.base_sha[..cs.base_sha.len().min(12)],
                            files.join("\n"),
                            patch,
                            if cut {
                                "\n[patch shortened; the full patch is in the ChangeSet file]"
                            } else {
                                ""
                            }
                        ))
                    }
                    "check_changes" => match rt.workspaces.check(&cs_id, &ctx.working_dir).await {
                        Ok(()) => ToolResult::success(format!(
                            "ChangeSet {cs_id} applies cleanly to your working tree now; nothing was written. Review its diff before applying it."
                        )),
                        Err(WsError::Conflict { files, detail }) => ToolResult::error(format!(
                            "ChangeSet {cs_id} would conflict in: {}. Nothing was written.\n{detail}",
                            files.join(", ")
                        )),
                        Err(e) => ToolResult::error(e.to_string()),
                    },
                    "rebase_changes" => {
                        match rt.rebase_changeset(&cs_id, i.verify_cmd.as_deref()).await {
                            Ok(outcome) => {
                                let meta = serde_json::to_value(&outcome).unwrap_or(Value::Null);
                                match outcome {
                                RebaseOutcome::Rebased(new_cs) => {
                                    let files: Vec<&str> =
                                        new_cs.files.iter().map(|f| f.path.as_str()).collect();
                                    ToolResult::success(format!(
                                        "ChangeSet {} rebased cleanly (rebased_from {}) onto HEAD {} ({} file(s)): {}. Review with `inspect_changes` or apply with `apply_changes`.",
                                        new_cs.id,
                                        new_cs.rebased_from.as_deref().unwrap_or(&cs_id),
                                        &new_cs.base_sha[..new_cs.base_sha.len().min(12)],
                                        files.len(),
                                        files.join(", "),
                                    ))
                                    .with_metadata(meta)
                                }
                                RebaseOutcome::Conflict { files, message } => {
                                    ToolResult::error(format!(
                                        "Rebase conflict for ChangeSet {cs_id} in: {}. Original ChangeSet kept as `conflict`.\n{message}",
                                        if files.is_empty() {
                                            "(unknown files)".to_string()
                                        } else {
                                            files.join(", ")
                                        }
                                    ))
                                    .with_metadata(meta)
                                }
                                RebaseOutcome::VerifyFailed { exit_code, output } => {
                                    ToolResult::error(format!(
                                        "Rebase verification failed for ChangeSet {cs_id} (exit code {exit_code}). Nothing was registered.\n{output}"
                                    ))
                                    .with_metadata(meta)
                                }
                            }
                            }
                            Err(e) => ToolResult::error(e.to_string()),
                        }
                    }
                    "apply_changes" => match rt.workspaces.apply(&cs_id, &ctx.working_dir).await {
                        Ok(done) => {
                            rt.changeset_applied(&done);
                            ToolResult::success(format!(
                                "ChangeSet {cs_id} applied to your working tree ({} file(s)): {}. Nothing was committed.",
                                done.files.len(),
                                done.files
                                    .iter()
                                    .map(|f| f.path.as_str())
                                    .collect::<Vec<_>>()
                                    .join(", ")
                            ))
                        }
                        Err(WsError::Conflict { files, detail }) => {
                            rt.emit(crate::events::AgentEvent::SubAgent(
                                super::spawn::SubAgentEvent::ChangesUpdated {
                                    changeset_id: cs_id.clone(),
                                    state: ChangeSetState::Conflict,
                                    files: files.clone(),
                                    detail: Some(detail.clone()),
                                },
                            ));
                            ToolResult::error(
                                WsError::Conflict { files, detail }.to_string()
                                    + " Both versions are kept: your working tree, and the ChangeSet.",
                            )
                        }
                        Err(e) => ToolResult::error(e.to_string()),
                    },
                    _ => match rt.workspaces.discard(&cs_id).await {
                        Ok(_) => {
                            rt.emit(crate::events::AgentEvent::SubAgent(
                                super::spawn::SubAgentEvent::ChangesUpdated {
                                    changeset_id: cs_id.clone(),
                                    state: ChangeSetState::Discarded,
                                    files: Vec::new(),
                                    detail: None,
                                },
                            ));
                            ToolResult::success(format!(
                                "ChangeSet {cs_id} discarded: its worktree is removed; its patch stays with the session as a record."
                            ))
                        }
                        Err(e) => ToolResult::error(e.to_string()),
                    },
                }
            }
            other => ToolResult::error(format!(
                "unknown action `{other}`: list, status, result, wait, resume, cancel, inspect_changes, check_changes, rebase_changes, apply_changes, discard_changes"
            )),
        }
    }
}

#[cfg(test)]
mod input_tests {
    use super::*;

    #[test]
    fn one_mission_or_a_list_never_both() {
        assert_eq!(
            missions(json!({"prompt": "Inspect the parser"}))
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            missions(json!({"task": "Inspect the parser"}))
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            missions(json!({"missions": [{"prompt": "a"}, {"task": "b"}]}))
                .unwrap()
                .len(),
            2
        );
        assert!(missions(json!({"missions": []})).is_err());
        assert!(missions(json!({"missions": [{"prompt": "a"}], "prompt": "b"})).is_err());
        assert!(missions(json!({"agents": [{"prompt": "a"}]})).is_err());
    }
}
