//! The context of a request: tool-result budgets, compaction and the request's
//! preparation (tools offered, measurement, pre-flight).

use super::history::save_session;
use super::{record_run_usage, send};
use crate::Agent;
use crate::context::{BudgetDecision, ContextPolicy, ContextStatus, ModelView, RequestView};
use crate::events::{AgentEvent, CompactReason};
use bricks_provider::CompletionRequest;
use bricks_types::*;
use std::collections::HashSet;
use tokio::sync::mpsc;

/// Equivalent char weights for non-text media inside the active context,
/// derived from [`ContextPolicy`] token estimates (~4 chars per token).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct MediaWeights {
    pub image_chars: usize,
    pub video_chars: usize,
    pub document_chars: usize,
}

impl Default for MediaWeights {
    fn default() -> Self {
        Self::from_policy(&ContextPolicy::default())
    }
}

impl MediaWeights {
    pub(crate) fn from_policy(policy: &ContextPolicy) -> Self {
        let chars = |tokens: u64| usize::try_from(tokens.saturating_mul(4)).unwrap_or(usize::MAX);
        Self {
            image_chars: chars(policy.image_tokens),
            video_chars: chars(policy.document_tokens),
            document_chars: chars(policy.document_tokens),
        }
    }
}

fn content_block_len(block: &ContentBlock, weights: MediaWeights) -> usize {
    match block {
        ContentBlock::Text { text } => text.len(),
        ContentBlock::Image { .. } | ContentBlock::Audio { .. } => weights.image_chars,
        ContentBlock::Video { .. } => weights.video_chars,
        ContentBlock::Document { .. } => weights.document_chars,
        _ => 0,
    }
}

fn tool_result_len(content: &ToolResultContent, weights: MediaWeights) -> usize {
    match content {
        ToolResultContent::Text(t) => t.len(),
        ToolResultContent::Blocks(b) => b.iter().map(|bb| content_block_len(bb, weights)).sum(),
    }
}

/// Remove the oldest tool results from the active history when their total
/// size exceeds `budget_chars`, replacing each with a placeholder.
/// Returns whether anything was removed. See
/// [`apply_tool_result_budget_with`] to say where the removed text can be
/// read back.
pub fn apply_tool_result_budget(messages: &mut [Message], budget_chars: usize) -> bool {
    apply_tool_result_budget_with(messages, budget_chars, |_, len| {
        format!(
            "[tool result removed from the active context to save space ({len} chars); it was \
             not saved — run the tool again if you need it]"
        )
    })
}

/// The smallest budget of tool results kept in the active history.
pub(super) const MIN_TOOL_RESULT_BUDGET: usize = 50_000;

/// Chars of tool results kept in the active history: the configured budget,
/// or else a quarter of the model's declared input (about four chars a
/// token), never under [`MIN_TOOL_RESULT_BUDGET`]. Beyond, compaction
/// takes over.
pub(crate) fn tool_result_budget(configured: Option<usize>, model: &ModelView) -> usize {
    configured.unwrap_or_else(|| {
        usize::try_from(model.limits.max_input_tokens)
            .unwrap_or(usize::MAX)
            .max(MIN_TOOL_RESULT_BUDGET)
    })
}

/// Like [`apply_tool_result_budget`]; `placeholder(tool_use_id, len)` writes
/// the replacement text (normally naming the saved original). The six most
/// recent messages are never touched.
pub fn apply_tool_result_budget_with(
    messages: &mut [Message],
    budget_chars: usize,
    placeholder: impl FnMut(&str, usize) -> String,
) -> bool {
    apply_tool_result_budget_protected(
        messages,
        budget_chars,
        MediaWeights::default(),
        &[],
        placeholder,
    )
}

/// A tool result carrying one of `protected` (the markers of active skill
/// activations) is neither counted nor removed: those instructions stay.
fn is_protected(content: &ToolResultContent, protected: &[String]) -> bool {
    !protected.is_empty()
        && match content {
            ToolResultContent::Text(t) => protected.iter().any(|p| t.contains(p.as_str())),
            ToolResultContent::Blocks(b) => b.iter().any(|bb| {
                matches!(bb, ContentBlock::Text { text } if protected.iter().any(|p| text.contains(p.as_str())))
            }),
        }
}

fn collect_protected_tool_use_ids(messages: &[Message]) -> HashSet<String> {
    let mut ids = HashSet::new();
    for msg in messages {
        if let MessageContent::Blocks(blocks) = &msg.content {
            for b in blocks {
                if let ContentBlock::ToolUse { id, name, .. } = b
                    && name == crate::deferred::LOAD_TOOLS
                {
                    ids.insert(id.clone());
                }
            }
        }
    }
    ids
}

fn is_media_marker(text: &str) -> bool {
    text.starts_with(bricks_tools::TOOL_IMAGE_MARK)
        || text.starts_with(bricks_tools::TOOL_VIDEO_MARK)
}

fn extract_media_path(text: &str) -> Option<String> {
    for mark in [
        bricks_tools::TOOL_IMAGE_MARK,
        bricks_tools::TOOL_VIDEO_MARK,
    ] {
        if let Some(rest) = text.strip_prefix(mark)
            && let Some((_, after_id)) = rest.split_once("] ")
            && let Some((path, _)) = after_id.split_once(", ")
        {
            let trimmed = path.trim();
            if !trimmed.is_empty() && trimmed != "(no path)" {
                return Some(trimmed.to_string());
            }
        }
    }
    for line in text.lines() {
        for prefix in ["Image ", "Video "] {
            if let Some(rest) = line.strip_prefix(prefix)
                && let Some((path, _)) = rest.split_once(": ")
            {
                let trimmed = path.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

fn media_eviction_placeholder(path: Option<&str>, size: usize) -> String {
    match path {
        Some(p) => format!(
            "[media removed from active context to save space ({size} chars); re-read {p} if needed]"
        ),
        None => format!(
            "[media removed from active context to save space ({size} chars); re-read the file if needed]"
        ),
    }
}

fn content_has_media(content: &ToolResultContent) -> bool {
    match content {
        ToolResultContent::Text(_) => false,
        ToolResultContent::Blocks(blocks) => blocks.iter().any(|b| {
            matches!(
                b,
                ContentBlock::Image { .. }
                    | ContentBlock::Video { .. }
                    | ContentBlock::Audio { .. }
                    | ContentBlock::Document { .. }
            )
        }),
    }
}

fn path_from_tool_result(content: &ToolResultContent) -> Option<String> {
    let ToolResultContent::Blocks(blocks) = content else {
        return None;
    };
    for b in blocks {
        if let ContentBlock::Text { text } = b
            && let Some(p) = extract_media_path(text)
        {
            return Some(p);
        }
    }
    None
}

/// [`apply_tool_result_budget_with`], keeping the results that carry an
/// active skill activation or `LoadTools` activation, and counting + evicting
/// tool-produced media blocks (`Image`, `Video`, etc.) by weight.
pub(crate) fn apply_tool_result_budget_protected(
    messages: &mut [Message],
    budget_chars: usize,
    weights: MediaWeights,
    protected: &[String],
    mut placeholder: impl FnMut(&str, usize) -> String,
) -> bool {
    let protected_ids = collect_protected_tool_use_ids(messages);

    let total: usize = messages
        .iter()
        .flat_map(|m| match &m.content {
            MessageContent::Blocks(blocks) => blocks
                .iter()
                .filter_map(|b| match b {
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                        ..
                    } if !protected_ids.contains(tool_use_id)
                        && !is_protected(content, protected) =>
                    {
                        Some(tool_result_len(content, weights))
                    }
                    ContentBlock::Image { .. }
                    | ContentBlock::Video { .. }
                    | ContentBlock::Audio { .. }
                    | ContentBlock::Document { .. } => Some(content_block_len(b, weights)),
                    _ => None,
                })
                .collect::<Vec<_>>(),
            _ => vec![],
        })
        .sum();
    if total <= budget_chars {
        return false;
    }

    let keep_recent = 6;
    let truncatable_end = messages.len().saturating_sub(keep_recent);
    let mut freed = 0usize;
    let target_free = total - budget_chars;
    let mut changed = false;

    for msg in messages[..truncatable_end].iter_mut() {
        if freed >= target_free {
            break;
        }
        if let MessageContent::Blocks(blocks) = &mut msg.content {
            let mut i = 0usize;
            while i < blocks.len() && freed < target_free {
                let media_pair_info = match (blocks.get(i), blocks.get(i + 1)) {
                    (Some(ContentBlock::Text { text }), Some(next))
                        if is_media_marker(text)
                            && matches!(
                                next,
                                ContentBlock::Image { .. }
                                    | ContentBlock::Video { .. }
                                    | ContentBlock::Audio { .. }
                                    | ContentBlock::Document { .. }
                            ) =>
                    {
                        Some((content_block_len(next, weights), extract_media_path(text)))
                    }
                    _ => None,
                };
                if let Some((size, path)) = media_pair_info {
                    blocks[i] = ContentBlock::Text {
                        text: media_eviction_placeholder(path.as_deref(), size),
                    };
                    blocks.remove(i + 1);
                    freed += size;
                    changed = true;
                    i += 1;
                    continue;
                }
                match &mut blocks[i] {
                    ContentBlock::ToolResult {
                        tool_use_id,
                        content,
                        ..
                    } => {
                        let size = tool_result_len(content, weights);
                        let already = matches!(
                            content,
                            ToolResultContent::Text(t)
                                if t.starts_with("[tool result removed")
                                    || t.starts_with("[media removed")
                        );
                        if size > 200
                            && !already
                            && !protected_ids.contains(tool_use_id)
                            && !is_protected(content, protected)
                        {
                            let replacement = if content_has_media(content) {
                                media_eviction_placeholder(
                                    path_from_tool_result(content).as_deref(),
                                    size,
                                )
                            } else {
                                placeholder(tool_use_id, size)
                            };
                            freed += size;
                            *content = ToolResultContent::Text(replacement);
                            changed = true;
                        }
                        i += 1;
                    }
                    ContentBlock::Image { .. }
                    | ContentBlock::Video { .. }
                    | ContentBlock::Audio { .. }
                    | ContentBlock::Document { .. } => {
                        let size = content_block_len(&blocks[i], weights);
                        blocks[i] = ContentBlock::Text {
                            text: media_eviction_placeholder(None, size),
                        };
                        freed += size;
                        changed = true;
                        i += 1;
                    }
                    _ => {
                        i += 1;
                    }
                }
            }
        }
    }
    changed
}

/// The unreduced text of a tool result in the raw history.
pub(super) fn raw_tool_result(raw: &[Message], id: &str) -> Option<String> {
    raw.iter().rev().find_map(|m| match &m.content {
        MessageContent::Blocks(bs) => bs.iter().find_map(|b| match b {
            ContentBlock::ToolResult {
                tool_use_id,
                content: ToolResultContent::Text(t),
                ..
            } if tool_use_id == id => Some(t.clone()),
            _ => None,
        }),
        _ => None,
    })
}

/// The definitions of the tools offered to the model now.
pub(super) fn tool_definitions(agent: &Agent) -> Vec<ToolDefinition> {
    agent
        .tool_list()
        .iter()
        .filter(|t| offered(agent, t.name(), t.permission_level(), t.category()))
        .map(|t| t.to_definition())
        .collect()
}

/// Whether a tool is offered to the model now. The memory tools only when
/// the run started with a memory; `memory_write` (like any memory tool) not
/// when the session's policy denies it: its guidance follows.
fn offered(
    agent: &Agent,
    name: &str,
    level: bricks_tools::PermissionLevel,
    category: bricks_tools::ToolCategory,
) -> bool {
    if !bricks_tools::memory_tools::MEMORY_TOOLS.contains(&name) {
        return true;
    }
    let on = agent
        .extensions
        .get::<bricks_tools::memory_tools::RunMemory>()
        .is_some_and(|m| m.0.is_some());
    if !on {
        return false;
    }
    agent.policy_cell().is_none_or(|cell| {
        cell.verdict(name, level, category).effect != crate::permission::PermissionEffect::Deny
    })
}

pub(super) fn model_view(agent: &Agent) -> ModelView {
    let sel = agent.selection();
    ModelView::of(sel.provider.as_ref(), &sel.model_label())
}

/// Status of the next request as it would be built now.
pub(crate) fn context_status(agent: &Agent) -> ContextStatus {
    let messages = agent.messages.lock().clone();
    let tools = tool_definitions(agent);
    let system = agent.effective_system();
    let view = RequestView {
        system: system.as_deref(),
        tools: &tools,
        messages: &messages,
        max_output: agent.output_limit(),
    };
    agent.context.lock().status(&model_view(agent), &view)
}

pub(crate) async fn compact_now(
    agent: &Agent,
    cancel: &tokio_util::sync::CancellationToken,
) -> crate::compact::CompactionOutcome {
    run_compaction(agent, CompactReason::ManualTrigger, true, None, cancel).await
}

/// Run one compaction attempt and apply it if it succeeds. `force` skips the
/// no-progress guard (manual request, or a request that cannot be sent).
pub(super) async fn run_compaction(
    agent: &Agent,
    reason: CompactReason,
    force: bool,
    tx: Option<&mpsc::Sender<AgentEvent>>,
    cancel: &tokio_util::sync::CancellationToken,
) -> crate::compact::CompactionOutcome {
    use crate::compact::{
        COMPACTION_ATTEMPT_TIMEOUT, CompactionOutcome, CompactionPlan, compact_history_with,
    };

    let messages = agent.messages.lock().clone();
    let version = agent.context.lock().version();
    let skip = {
        let state = agent.compaction_state.lock();
        if state.disabled && reason != CompactReason::ManualTrigger {
            Some(format!(
                "automatic compaction is off for this session after {} unsuccessful attempts",
                state.failures
            ))
        } else if !force && state.last_unsuccessful == Some((version, messages.len())) {
            Some("the history has not changed since the last unsuccessful attempt".to_string())
        } else {
            None
        }
    };
    if let Some(reason_text) = skip {
        let outcome = CompactionOutcome::Skipped {
            reason: reason_text,
        };
        send(
            agent,
            tx,
            AgentEvent::CompactionResult {
                reason,
                outcome: outcome.clone(),
            },
        )
        .await;
        return outcome;
    }

    send(
        agent,
        tx,
        AgentEvent::CompactStart {
            reason,
            messages_before: messages.len(),
        },
    )
    .await;

    let model = model_view(agent);
    let (est, policy) = {
        let ctx = agent.context.lock();
        (ctx.estimator(&model), ctx.policy().clone())
    };
    let tools = tool_definitions(agent);
    let frame_tokens = agent
        .effective_system()
        .as_deref()
        .map(|s| est.text(s).tokens)
        .unwrap_or(0)
        + est.tools(&tools).tokens;
    let input_limit = model.limits.max_input_tokens.max(1);
    let plan = CompactionPlan {
        keep_recent_messages: policy.keep_recent_messages,
        max_recent_tokens: (input_limit as f64 * policy.max_recent_ratio) as u64,
        input_limit,
        summary_max_tokens: policy.summary_max_tokens,
        min_gain: policy.min_compaction_gain,
        frame_tokens,
        instructions: None,
        session_id: super::conversation_id(agent),
    };
    let run = compact_history_with(
        agent.provider().as_ref(),
        &messages,
        &est,
        &plan,
        cancel,
        tokio::time::Instant::now() + COMPACTION_ATTEMPT_TIMEOUT,
    )
    .await;

    // The summary call counts once in the session totals, whatever its fate.
    if let Some(u) = &run.usage {
        agent.context.lock().record_compaction_usage(u);
        agent.cumulative_usage.lock().merge(u);
        agent.cost_tracker.add(u);
        record_run_usage(agent, u);
    }

    match (&run.outcome, run.messages) {
        (
            CompactionOutcome::Compacted {
                messages_after,
                tokens_before,
                tokens_after,
                ..
            },
            Some(mut new),
        ) => {
            // Active skills whose text was summarised away come back whole,
            // after the summary (never twice: only the missing ones).
            let readd = agent.skills_to_readd(&new);
            if !readd.is_empty()
                && let Some(first) = new.first_mut()
            {
                let mut blocks = first.content_blocks();
                let at = blocks
                    .iter()
                    .position(|b| !matches!(b, ContentBlock::Text { .. }))
                    .unwrap_or(blocks.len())
                    .min(1);
                for (i, text) in readd.into_iter().enumerate() {
                    blocks.insert(at + i, ContentBlock::Text { text });
                }
                first.content = MessageContent::Blocks(blocks);
            }
            let number = {
                let mut st = agent.compaction_state.lock();
                st.failures = 0;
                st.last_unsuccessful = None;
                st.applied += 1;
                st.applied
            };
            let memory_key = match (&agent.memory, &agent.session_id) {
                (Some(memory), Some(sid)) => {
                    let key = bricks_memory::session_keys::snapshot(sid, number);
                    match memory.store(&key, &messages).await {
                        Ok(()) => Some(key),
                        Err(e) => {
                            tracing::warn!("could not store the pre-compaction snapshot: {e}");
                            None
                        }
                    }
                }
                _ => None,
            };
            agent.snapshots.lock().push(crate::CompactionSnapshot {
                number,
                messages,
                memory_key,
            });
            *agent.messages.lock() = new;
            agent.read_file_state.clear();
            agent.instruction_files.lock().mark_compacted();
            agent.request_env.mark_full_git();
            agent
                .context
                .lock()
                .invalidate(format!("compaction #{number} rewrote the history"));
            // Persist now, so the session, its raw history and the snapshot
            // stay consistent even if the run stops before its end.
            if let Err(e) = save_session(agent).await {
                tracing::warn!("could not store the compacted session: {e}");
            }
            send(
                agent,
                tx,
                AgentEvent::CompactEnd {
                    messages_after: *messages_after,
                    tokens_freed: tokens_before.saturating_sub(*tokens_after),
                },
            )
            .await;
            super::refresh_memory_after_compaction(agent, tx).await;
        }
        // A cancellation is not an attempt on this history: the next
        // compaction may try it again, and it never counts as a failure.
        (CompactionOutcome::Cancelled, _) => {}
        (outcome, _) => {
            let mut st = agent.compaction_state.lock();
            st.last_unsuccessful = Some((version, messages.len()));
            if matches!(
                outcome,
                CompactionOutcome::Failed { .. } | CompactionOutcome::InsufficientGain { .. }
            ) {
                st.failures += 1;
                if st.failures >= policy.max_compaction_failures {
                    st.disabled = true;
                }
            }
        }
    }
    tracing::info!(?reason, outcome = %run.outcome, "compaction");
    send(
        agent,
        tx,
        AgentEvent::CompactionResult {
            reason,
            outcome: run.outcome.clone(),
        },
    )
    .await;
    run.outcome
}

/// Check the budget of `request` before it is sent, compacting once if it
/// manifestly does not fit. A request that still does not fit is not sent.
pub(super) async fn ensure_budget(
    agent: &Agent,
    request: &mut CompletionRequest,
    tx: &mpsc::Sender<AgentEvent>,
    cancel: &tokio_util::sync::CancellationToken,
) -> Result<ContextStatus> {
    for attempt in 0..2 {
        let model = model_view(agent);
        let (status, decision) = {
            let ctx = agent.context.lock();
            let status = ctx.status(&model, &RequestView::of(request));
            let decision = ctx.decide(&status);
            (status, decision)
        };
        let fits = match decision {
            BudgetDecision::Fits => return Ok(status),
            BudgetDecision::Preflight(why) => {
                match preflight(agent, &model, request, &status, &why, cancel).await? {
                    Some(st) => return Ok(st),
                    None => false,
                }
            }
            BudgetDecision::Exceeded => false,
        };
        debug_assert!(!fits);
        if attempt == 0 && agent.auto_compact {
            let outcome =
                run_compaction(agent, CompactReason::BudgetExceeded, true, Some(tx), cancel).await;
            if outcome == crate::compact::CompactionOutcome::Cancelled {
                return Err(BricksError::Cancelled);
            }
            if outcome.is_compacted() {
                request.messages = agent.messages.lock().clone();
                continue;
            }
        }
        let used = status.context_used.tokens;
        let limit = status.input_limit.saturating_sub(status.margin);
        send(
            agent,
            Some(tx),
            AgentEvent::Status(format!(
                "Request not sent: the context (~{used} tokens, {:?}) exceeds the budget of {limit} \
                 tokens ({} input limit − {} margin, {} reserved for output) and compaction could \
                 not reduce it.",
                status.context_used.provenance, status.input_limit, status.margin, status.reserved_output
            )),
        )
        .await;
        return Err(BricksError::ContextOverflow { used, limit });
    }
    unreachable!("the second attempt always returns")
}

/// Absolute limit of one call to a configured token-counting endpoint.
/// Past it the local estimate is used, as for any counting failure.
pub(crate) const TOKEN_COUNT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

/// A precise check of the complete request: the configured counting endpoint
/// when there is one, else a full local estimate. `Some(status)` when the
/// request fits. A cancellation during the count stops here, without the
/// fallback.
async fn preflight(
    agent: &Agent,
    model: &ModelView,
    request: &CompletionRequest,
    status: &ContextStatus,
    why: &str,
    cancel: &tokio_util::sync::CancellationToken,
) -> Result<Option<ContextStatus>> {
    let limit = status.input_limit.saturating_sub(status.margin);
    let mut note = None;
    if model.token_counting {
        let provider = agent.provider();
        let counted = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(BricksError::Cancelled),
            r = tokio::time::timeout(TOKEN_COUNT_TIMEOUT, provider.count_request_tokens(request)) => r,
        };
        let counted = counted.unwrap_or_else(|_| {
            Err(BricksError::Provider(format!(
                "no answer within {} s",
                TOKEN_COUNT_TIMEOUT.as_secs()
            )))
        });
        match counted {
            Ok(Some(n)) => {
                let st = {
                    let mut ctx = agent.context.lock();
                    ctx.record_count(model, &RequestView::of(request), n);
                    ctx.status(model, &RequestView::of(request))
                };
                tracing::debug!("Pre-flight ({why}): counted {n} input tokens, budget {limit}.");
                return Ok((n <= limit).then_some(st));
            }
            Ok(None) => {}
            Err(e) => {
                note = Some(format!(
                    "counting endpoint unavailable ({e}); local estimate used"
                ))
            }
        }
    }
    // Local fallback: a full, conservative estimate of the request.
    let est = agent.context.lock().estimator(model);
    let full = est.request(request.system.as_deref(), &request.tools, &request.messages);
    let central = full.tokens.max(status.context_used.tokens);
    tracing::debug!(
        "Pre-flight ({why}): estimated ~{central} input tokens (up to ~{}), budget {limit}{}.",
        full.upper.max(status.context_used.upper_bound),
        note.map(|n| format!("; {n}")).unwrap_or_default()
    );
    Ok((central <= limit).then(|| status.clone()))
}
