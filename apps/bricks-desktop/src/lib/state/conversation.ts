// Per-session state, built from the stored history and the engine's
// envelopes. One instance per open session, kept while the user looks
// at other conversations so no event is lost. Owner: orchestrator.

import { useRef, useSyncExternalStore } from 'react'
import { t } from '$lib/i18n/i18n'
import type { HistoryMessage, OpenedSession, RunLabel, RunRecord, SessionItem } from '$lib/ipc/client'
import { sessionAttachmentPaths, sessionCommand, sessionRunUserIndex } from '$lib/ipc/client'
import type {
  ChangeKind,
  InstanceRecord,
  AgentProfilesEvent,
  SearchHit,
  SkillsListing,
  Usage,
  AgentResult,
  ApprovalRequest,
  AttachmentInfo,
  ChangeSet,
  ContextStatus,
  DecidedBy,
  Decision,
  Envelope,
  Event as EngineEvent,
  InstanceState,
  PlanState,
  PromptBlock,
  QuestionOutcome,
  QuestionRequest,
  RunOutcome,
  SkillSourceInfo,
  SessionPolicy,
  Snapshot,
  SpawnInfo,
  Termination,
  WrittenFile,
} from '$lib/ipc/engine'
import { TERMINAL_AGENT_STATES } from '$lib/ipc/engine'
import { commandKey, fileKey, isShellTool, operationKey } from '$lib/features/conversation/operations'
import { responseByAnchor, responseGroups, type ResponseGroup } from '$lib/features/conversation/responses'
import { ObservableStore } from './observable'

let nextLocalId = 0
const localId = (prefix: string) => `${prefix}-${++nextLocalId}`

export interface UserItem {
  kind: 'user'
  id: string
  runId?: string
  text: string
  attachments: AttachmentInfo[]
  at?: number
  /** The command as typed, for a message sent by a typed command (e.g. `/skill debug`). */
  commandLabel?: string
  /** Mid-run steering message injected while a run was active. */
  steered?: boolean
}

export interface AssistantItem {
  kind: 'assistant'
  id: string
  runId?: string
  text: string
  /** Reasoning the provider exposed (never reconstructed). */
  thinking: string
  streaming: boolean
  /** When the first reasoning arrived, while this view followed it live. */
  thinkingStartedAt?: number
  /** How long the reasoning lasted, when it was followed live (never for a reloaded history). */
  thinkingMs?: number
}

/** The reasoning of a message followed live ends with its first text, or with the message. */
function endThinking(a: AssistantItem) {
  if (a.thinkingStartedAt !== undefined && a.thinkingMs === undefined) {
    a.thinkingMs = Date.now() - a.thinkingStartedAt
  }
}

export type ToolStatus = 'running' | 'ok' | 'error'

export interface ToolItem {
  kind: 'tool'
  id: string
  toolCallId: string
  runId?: string
  name: string
  input: unknown
  status: ToolStatus
  output?: string
  durationMs?: number
  progress?: string
}

/** A question of `Ask` and, once closed, how it ended. */
export interface QuestionItem {
  kind: 'question'
  id: string
  runId?: string
  question: QuestionRequest
  outcome?: QuestionOutcome
}

export interface ApprovalItem {
  kind: 'approval'
  id: string
  runId?: string
  approval: ApprovalRequest
  resolved?: { decision: Decision; by: DecidedBy }
}

/** One file of an applied change, as the engine wrote it. */
export interface EditFile {
  /** The path as the change names it. */
  path: string
  kind: ChangeKind
  added: number
  removed: number
  binary?: boolean
  /** The file written, absolute (absent for a ChangeSet, or an older event). */
  absolute?: string
  /** The entry approved and written, as a unified diff; `null` for a binary file. */
  patch?: string | null
  patchTruncated?: boolean
}

export interface EditItem {
  kind: 'edit'
  id: string
  runId?: string
  toolCallId: string
  tool: string
  files: EditFile[]
  agentId?: string
  changesetId?: string
}

export interface NoticeItem {
  kind: 'notice'
  id: string
  runId?: string
  level: 'info' | 'warning' | 'error'
  message: string
  separator?: boolean
}

export interface RunEndItem {
  kind: 'run_end'
  id: string
  runId: string
}

/**
 * One sub-agent in the thread, where it was launched (after the parent's call),
 * and again in a later run that resumed it. The agent itself lives in
 * `Conversation.agents`; this item only places it.
 */
export interface AgentItem {
  kind: 'agent'
  id: string
  runId?: string
  agentId: string
  /** The parent's tool call that launched (or resumed) it. */
  toolCallId?: string
  execution: number
}

export type TimelineItem =
  | UserItem
  | AssistantItem
  | ToolItem
  | ApprovalItem
  | QuestionItem
  | EditItem
  | NoticeItem
  | RunEndItem
  | AgentItem

/**
 * Line sums of the applied edits of one file in one run (operations, not a net
 * diff). Keyed by `fileKey` (the full path when known): two files of one name
 * stay two files.
 */
export interface RunFileSummary {
  key: string
  path: string
  absolute: string | null
  /** The basename, exactly. */
  name: string
  added: number
  removed: number
  binary: boolean
  /** The last kind known: `create`, `modify` or `delete`. */
  kind: ChangeKind
  /** Number of edit operations summed. */
  operations: number
  /** The sub-agents that made an operation on it (none: the session agent only). */
  agentIds: string[]
}

export type FileTotals = RunFileSummary

export type CommandStatus = 'running' | 'success' | 'failure' | 'timed_out' | 'cancelled' | 'unknown'

/** One shell command a run executed, the session agent's or a sub-agent's. */
export interface CommandEvidence {
  /** `rootRunId|agentId|toolCallId`: one entry per key. */
  key: string
  rootRunId: string
  /** `null` for the session agent. */
  agentId: string | null
  toolCallId: string
  name: string
  command: string
  status: CommandStatus
  isError: boolean
  durationMs: number | null
  output: string | null
}

/** What a run's response cost: the engine's total of the run, live or from its record. */
export interface RunUsageView {
  input: number
  output: number
  cacheRead: number
  /** Estimated USD; `null` when no price was known (unknown, never zero). */
  costUsd: number | null
  /** The cost is a lower bound: some consumed category had no price. */
  partial: boolean
  /** `false` while sub-agents still run: the total is replaced when they end. */
  final: boolean
}

export interface RunInfo {
  runId: string
  prompt: string
  model: string
  reasoning?: string
  startedAt: number
  finishedAt?: number
  outcome?: RunOutcome
  error?: string
  termination?: Termination
  finalText?: string
  turns?: number
  approvalsUnsatisfied: ApprovalRequest[]
  /** Edit operations of this run, keyed by `fileKey`. */
  files: Map<string, RunFileSummary>
  /** The same files, in the order they were first edited. */
  fileSummaries: RunFileSummary[]
  /** Shell commands the run executed, with their real output. */
  commands: CommandEvidence[]
  /** `finishedAt - startedAt` when both are known and in order; `null` otherwise. */
  workedMs: number | null
  /** The response's cost; `null` when no total is known (an older record). */
  usage: RunUsageView | null
}

export interface AgentToolCall {
  toolCallId: string
  name: string
  input: unknown
  status: ToolStatus
  durationMs?: number
}

export interface AgentInfo {
  id: string
  spawn: SpawnInfo
  state: InstanceState
  reason?: string
  spawnedAt: number
  endedAt?: number
  tools: AgentToolCall[]
  result?: AgentResult
  /** The current execution: 1 at launch, one more for each resume. */
  execution: number
  /** Its work as the events of a conversation of its own: its read-only branch replays them. */
  log: AgentStep[]
}

/** One step of a sub-agent, as an event of its branch (`agentBranch`). */
export interface AgentStep {
  event: EngineEvent
  at: number
  execution: number
}

/** A sub-agent's end, as the end of a run of its branch. */
function agentRunFinished(result: AgentResult): EngineEvent {
  const outcome: RunOutcome =
    result.status === 'completed'
      ? 'succeeded'
      : result.status === 'failed'
        ? 'failed'
        : result.status === 'cancelled' || result.status === 'interrupted'
          ? 'cancelled'
          : 'incomplete'
  return {
    type: 'run_finished',
    outcome,
    error: result.error ?? undefined,
    text: result.summary,
    turns: result.turns,
  }
}

/** The mission as the opening message of a branch run. */
function agentRunStarted(spawn: SpawnInfo, resumed: boolean): EngineEvent {
  return {
    type: 'run_started',
    prompt: resumed ? t('app.resumingTheMission') : spawn.task,
    attachments: [],
    model: spawn.model.applied,
  }
}

/** The end of a branch run: the report as its answer when no text came before it. */
function closeAgentLog(agent: AgentInfo, result: AgentResult, at: number) {
  const lastStart = agent.log.findLastIndex((s) => s.event.type === 'run_started')
  // The run it ends: the one opened last, whatever the result says.
  const execution = agent.log[lastStart]?.execution ?? result.execution ?? agent.execution
  const wrote = agent.log.slice(lastStart + 1).some((s) => s.event.type === 'text_delta')
  if (!wrote && result.summary.trim()) {
    agent.log.push({ event: { type: 'text_delta', text: result.summary }, at, execution })
  }
  agent.log.push({ event: agentRunFinished(result), at, execution })
}

export interface DraftAttachment {
  id: string
  /** `file` | `folder` | `image`. */
  kind: 'file' | 'folder' | 'image'
  path: string
  name: string
  /** Object URL / data URL for an image preview. */
  previewUrl?: string
  error?: string
  /** The copy's id: the attachment is a copy owned by the draft, then the conversation. */
  attachmentId?: string
  /** Being copied: the message cannot be sent yet. */
  importing?: boolean
  /** The conversation the copy was moved to (once a send promoted it). */
  sessionId?: string
}

export interface Draft {
  text: string
  attachments: DraftAttachment[]
  /** The draft's copies folder in the app (set by the first import). */
  draftId?: string
  /** Skills to activate with the next message (`Prompt.skills`). */
  skills: string[]
}

export interface TurnUsage {
  at: number
  runId?: string
  usage: Usage
}

export interface JobInfo {
  jobId: string
  agentId: string
  rootRunId: string
  command: string
  cwd: string
  pid: number
  startedAt: number
  stdoutBytes: number
  stderrBytes: number
  /** `running` until `job_finished`: then `completed` | `failed` | `stopped`. */
  state: string
  code?: number
  signal?: number
  durationMs?: number
  logs: string[]
  logsError?: string
}

export interface SearchResult {
  at: number
  query: string
  status: string
  hits: SearchHit[]
  omitted: number
  notes: string[]
  elapsedMs: number
}

export interface MemoryState {
  lastRecall?: { at: number; items: number; tokens: number; omitted: number; budget: number }
  maintenanceRunning: boolean
  lastMaintenance?: { at: number; outcome: string; report?: unknown; error?: string }
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

/** Time worked by a run, from the engine's timestamps (`null` when missing or out of order). */
function workedOf(startedAt: number, finishedAt: number | undefined): number | null {
  return finishedAt !== undefined && finishedAt >= startedAt ? finishedAt - startedAt : null
}

function editFile(f: WrittenFile): EditFile {
  return {
    path: f.path,
    kind: f.kind,
    added: f.added,
    removed: f.removed,
    binary: f.binary ?? false,
    absolute: f.absolute,
    patch: f.patch ?? null,
    patchTruncated: f.patch_truncated ?? false,
  }
}

/** A command's status as the engine reports it (`unknown` when it says nothing). */
function statusOf(status: string | undefined): CommandStatus {
  switch (status) {
    case 'running':
    case 'success':
    case 'failure':
    case 'timed_out':
    case 'cancelled':
      return status
    default:
      return 'unknown'
  }
}

/** The status a background job's end gives its command. */
function jobStatus(state: string): CommandStatus {
  switch (state) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'failure'
    case 'stopped':
      return 'cancelled'
    default:
      return 'unknown'
  }
}

/** The command text of a shell call's input (`''` when there is none). */
function commandText(input: unknown): string {
  const command = (input as { command?: unknown } | null | undefined)?.command
  return typeof command === 'string' ? command : ''
}

/**
 * Whether a user text is an engine skill activation: the instructions of a
 * skill chosen for a request, stored as a user message (`render_activation`,
 * crates/bricks-skills). The person did not type it, and the skill shows as the
 * command label of the request instead.
 */
function isEngineSkillActivation(text: string): boolean {
  const t = text.trim()
  return t.startsWith('<skill_activation id="') && t.endsWith('</skill_activation>')
}

/**
 * A delivery of the team to the orchestrator, kept as a user-role message
 * (crates/bricks-agent `agents/messagent.rs`, `runtime.rs` notify_parent): a
 * Messagent message or a sub-agent's report. The person did not type it.
 */
export function isTeamDelivery(text: string): boolean {
  const t = text.trimStart()
  return /^\[Messagent m\d{4} from /.test(t) || /^\[sub_\d{4} · .+ ended: /.test(t) || t.startsWith('[Messagent] ')
}

/** The cost of a stored run, from its record; `null` for a record written before usage was kept. */
function usageOfRecord(usage: NonNullable<RunRecord['usage']> | null): RunUsageView | null {
  if (!usage) return null
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cacheRead: usage.cache_read_input_tokens,
    costUsd: usage.cost_usd ?? null,
    partial: usage.partial,
    final: usage.final_total,
  }
}

/** The summary of a stored run, from its record. */
function storedRun(record: RunRecord, prompt: string): RunInfo {
  const fileSummaries: RunFileSummary[] = record.files.map((f) => ({
    key: f.key,
    path: f.path,
    absolute: f.absolute ?? null,
    name: basename(f.path),
    added: f.added,
    removed: f.removed,
    binary: f.binary,
    kind: f.kind as ChangeKind,
    operations: f.operations,
    agentIds: [...f.agent_ids],
  }))
  const files = new Map<string, RunFileSummary>()
  for (const f of fileSummaries) files.set(f.key, f)
  const finishedAt = record.finished_at ?? undefined
  return {
    runId: record.run_id,
    prompt,
    model: '',
    startedAt: record.started_at,
    finishedAt,
    outcome: (record.outcome ?? undefined) as RunOutcome | undefined,
    approvalsUnsatisfied: [],
    files,
    fileSummaries,
    commands: record.commands.map((c) => ({
      key: commandKey(c.root_run_id, c.agent_id, c.tool_call_id),
      rootRunId: c.root_run_id,
      agentId: c.agent_id ?? null,
      toolCallId: c.tool_call_id,
      name: c.name,
      command: c.command,
      status: statusOf(c.status),
      isError: c.is_error,
      durationMs: c.duration_ms ?? null,
      output: c.output ?? null,
    })),
    workedMs: workedOf(record.started_at, finishedAt),
    usage: usageOfRecord(record.usage),
  }
}

export class Conversation extends ObservableStore {
  readonly sessionId: string
  projectId: string | null
  /** A sub-agent's branch: shown, never written to (no revision, no answer). */
  readOnly = false
  /** The sub-agent whose branch this is: its own edits read as the conversation's. */
  ownAgentId: string | null = null

  session: SessionItem
  title = ''
  workingDir = ''
  model = ''
  reasoning: string | null = null
  effectiveReasoning: string | null = null

  items: TimelineItem[] = []
  runs = new Map<string, RunInfo>()
  agents = new Map<string, AgentInfo>()
  changesets = new Map<string, ChangeSet>()
  approvals = new Map<string, ApprovalRequest>()
  /** Questions of `Ask` waiting for the person. */
  questions = new Map<string, QuestionRequest>()
  skillsTrust: { project: string; sources: SkillSourceInfo[] } | null = null

  /** Active run id (`null` when idle). */
  runningRunId: string | null = null
  busy: string | null = null

  /** The session's plan (TodoWrite): the latest revision seen, `null` before any. */
  plan: PlanState | null = null

  /** The session's permission policy, at the latest revision seen. */
  permissions: { policy: SessionPolicy; revision: number } | null = null

  context: ContextStatus | null = null
  /** The last measure no longer applies (model change, compaction...). */
  contextStale = false
  usageTotal: { input: number; output: number; costUsd?: number } | null = null

  draft: Draft = { text: '', attachments: [], skills: [] }
  /** Keep the computer awake while this conversation runs (until the app quits). */
  keepAwake = false
  /** Last refusal of a command (e.g. submit during a run). */
  lastRejection: { command: string; reason: string; at: number } | null = null
  /** Last answer to an `agent_control` command (apply/discard/cancel). */
  lastAgentControl: { action: string; ok: boolean; text: string; at: number } | null = null

  //.1: answers of the migrated commands, kept per session.
  /** Per-response usage, in order (`usage.turn`); session total is `usageTotalFull`. */
  turnUsages: TurnUsage[] = []
  usageTotalFull: Usage | null = null
  /** Last `run_usage` of a root run (own + descendants, each response once). */
  runUsages = new Map<string, Extract<Envelope, { type: 'run_usage' }>>()
  jobs = new Map<string, JobInfo>()
  searchResult: SearchResult | null = null
  agentProfiles: AgentProfilesEvent | null = null
  skillsListing: { at: number; listing: SkillsListing } | null = null
  memory: MemoryState = { maintenanceRunning: false }
  /** Last compaction answer (`compaction` event). */
  /** Last `context_cleared` answer (`/clear`). */
  lastClear: { at: number; messagesRemoved: number } | null = null
  lastCompaction: { at: number; reason: string; outcome: string; compacted: boolean } | null = null
  /** Last skill activation outcome (`/skill`). */
  lastSkill: { at: number; name: string; ok: boolean; reason?: string } | null = null

  lastSeq = -1
  /** Command labels by run id, kept whether or not the run's message exists yet. */
  private runLabels = new Map<string, string>()
  /** Label of the submit sent last, until the next live run starts (see `setPendingSubmitLabel`). */
  private pendingSubmitLabel: string | null = null
  /** Run records of the stored runs (`opened.run_records`), for the responses. */
  private storedRuns: RunRecord[] = []
  /**
   * The index, among the user-role messages of the active history, of the user
   * items of the stored history (what a `revise` names). A message sent in this
   * view is found through its run's record instead.
   */
  private userIndexes = new Map<string, number>()
  /** The user item a `revise` sent from this view replaces, until its `history_revised`. */
  revisingItemId: string | null = null
  /** Runs whose summary (files, commands, time) comes from their record: events never add to it. */
  private recordedRuns = new Set<string>()
  /** Operation keys already counted, per run (see `operationKey`). */
  private operationKeys = new Map<string, Set<string>>()
  /** Background job id -> the command (run id, command key) it was matched to. */
  private jobCommands = new Map<string, { runId: string; key: string }>()
  /** Jobs already matched to a command. */
  private claimedJobs = new Set<string>()

  private responseCache: { version: number; groups: ResponseGroup[] } | null = null
  private pendingQuestionsCache: { version: number; list: QuestionRequest[] } | null = null
  private pendingApprovalsCache: { version: number; list: ApprovalRequest[] } | null = null

  constructor(opened: OpenedSession, projectId: string | null) {
    super()
    this.sessionId = opened.session.id
    this.projectId = projectId
    this.session = opened.session
    this.title = opened.session.title
    this.applySnapshot(opened.snapshot)
    this.storedRuns = opened.run_records ?? []
    const userItemIds = this.loadHistory(opened.history)
    for (const [index, id] of userItemIds) this.userIndexes.set(id, index)
    this.attachRecords(this.storedRuns, userItemIds)
    this.replay(opened.recent_events)
    // Envelopes up to the snapshot are already in this view: a later delivery of one is ignored.
    this.lastSeq = Math.max(this.lastSeq, opened.last_seq)
    // Absent for sessions stored before labels existed.
    this.applyStoredLabels(opened.run_labels ?? [], userItemIds)
  }

  /**
   * The responses of the conversation, in order, built from every item (not the
   * visible ones). Each copyable one has its « Copier » button after its last item.
   */
  get responses(): ResponseGroup[] {
    const version = this.getSnapshot()
    if (this.responseCache && this.responseCache.version === version) {
      return this.responseCache.groups
    }
    const groups = responseGroups(this.items, this.runs, this.storedRuns)
    this.responseCache = { version, groups }
    return groups
  }

  /** The copyable response that ends at this item (its « Copier » button), if any. */
  responseByAnchor(itemId: string): ResponseGroup | undefined {
    return responseByAnchor(this.responses, itemId)
  }

  get running(): boolean {
    return this.runningRunId !== null
  }

  get pendingQuestions(): QuestionRequest[] {
    const version = this.getSnapshot()
    if (this.pendingQuestionsCache && this.pendingQuestionsCache.version === version) {
      return this.pendingQuestionsCache.list
    }
    const list = [...this.questions.values()]
    this.pendingQuestionsCache = { version, list }
    return list
  }

  get pendingApprovals(): ApprovalRequest[] {
    const version = this.getSnapshot()
    if (this.pendingApprovalsCache && this.pendingApprovalsCache.version === version) {
      return this.pendingApprovalsCache.list
    }
    const list = [...this.approvals.values()]
    this.pendingApprovalsCache = { version, list }
    return list
  }

  setKeepAwake(value: boolean): void {
    if (this.keepAwake === value) return
    this.keepAwake = value
    this.emit()
  }

  setDraft(patch: Partial<Draft>): void {
    this.draft = { ...this.draft, ...patch }
    this.emit()
  }

  /** Queues a mid-run user steering message into the active run. */
  async inject(text: string): Promise<void> {
    const trimmed = text.trim()
    if (!trimmed) return
    await sessionCommand(this.sessionId, { type: 'inject', text: trimmed })
  }

  /** Where a user message is in the active history, for a `revise`; `null` when unknown. */
  async userIndexOf(item: UserItem): Promise<number | null> {
    const known = this.userIndexes.get(item.id)
    if (known !== undefined) return known
    if (item.steered || !item.runId) return null
    return sessionRunUserIndex(this.sessionId, item.runId)
  }

  /**
   * The prompt that replaces a user message: the new text, then the message's own
   * attachments (the conversation's copies, else the paths the engine reported).
   */
  async revisedBlocks(item: UserItem, text: string): Promise<PromptBlock[]> {
    const blocks: PromptBlock[] = []
    if (text.trim()) blocks.push({ kind: 'text', text: text.trim() })
    const ids = item.attachments.flatMap((a) => (a.attachment_id ? [a.attachment_id] : []))
    const paths = new Map<string, string>()
    if (ids.length > 0) {
      for (const r of await sessionAttachmentPaths(this.sessionId, ids)) paths.set(r.id, r.path)
    }
    for (const a of item.attachments) {
      const path = a.attachment_id ? paths.get(a.attachment_id) : a.path
      if (!path) throw new Error(t('app.theCopyOfCantBeFound', { path: a.path }))
      blocks.push({ kind: a.kind === 'image' ? 'image' : a.kind === 'folder' ? 'folder' : 'file', path })
    }
    return blocks
  }

  /**
   * After a `revise`: the revised message and everything after it leave the
   * timeline (the run that replaces it adds its own message).
   */
  private applyRevision(userIndex: number) {
    const id =
      this.revisingItemId ?? [...this.userIndexes].find(([, index]) => index === userIndex)?.[0] ?? null
    this.revisingItemId = null
    for (const [itemId, index] of this.userIndexes) if (index >= userIndex) this.userIndexes.delete(itemId)
    const at = id ? this.items.findIndex((i) => i.id === id) : -1
    if (at < 0) return
    const removed = new Set(this.items.slice(at).flatMap((i) => ('runId' in i && i.runId ? [i.runId] : [])))
    this.items = this.items.slice(0, at)
    for (const runId of removed) {
      this.runs.delete(runId)
      this.recordedRuns.delete(runId)
    }
    this.storedRuns = this.storedRuns.filter((r) => !removed.has(r.run_id))
  }

  /** Run of a timeline item. */
  run(runId: string | undefined): RunInfo | undefined {
    return runId ? this.runs.get(runId) : undefined
  }

  /**
   * Restores sub-agents and ChangeSets kept by the engine runtime (after a
   * reopen the events of earlier runs are gone). Live entries win.
   */
  hydrateAgents(records: InstanceRecord[], changesets: ChangeSet[]) {
    let changed = false
    for (const r of records) {
      if (this.agents.has(r.info.agent_id)) continue
      changed = true
      const agent: AgentInfo = {
        id: r.info.agent_id,
        spawn: r.info,
        state: r.state,
        reason: r.reason,
        spawnedAt: Date.parse(r.info.created_at) || r.updated_at_ms,
        endedAt: TERMINAL_AGENT_STATES.includes(r.state) ? r.updated_at_ms : undefined,
        tools: [],
        result: r.result,
        execution: r.execution ?? 1,
        log: [],
      }
      const at = Date.parse(r.info.created_at) || r.updated_at_ms
      agent.log.push({ event: agentRunStarted(r.info, false), at, execution: agent.execution })
      if (r.result) closeAgentLog(agent, r.result, r.updated_at_ms)
      this.agents.set(r.info.agent_id, agent)
      this.placeAgent(r.info.agent_id, r.info.root_run_id, r.info.tool_call_id ?? undefined, r.execution ?? 1)
    }
    for (const cs of changesets) {
      if (!this.changesets.has(cs.id)) {
        this.changesets.set(cs.id, cs)
        changed = true
      }
    }
    if (changed) {
      this.items = [...this.items]
      this.emit()
    }
  }

  applySnapshot(s: Snapshot) {
    this.usageTotalFull = s.usage
    this.title = s.title || this.title
    this.workingDir = s.working_dir
    this.model = s.model
    this.reasoning = s.reasoning
    this.effectiveReasoning = s.effective_reasoning
    this.context = s.context
    this.contextStale = false
    this.runningRunId = s.activity.state === 'running' ? s.activity.run_id : null
    this.busy = s.activity.state === 'busy' ? s.activity.what : null
    this.approvals.clear()
    for (const a of s.pending_approvals) this.approvals.set(a.approval_id, a)
    this.questions.clear()
    for (const q of s.pending_questions ?? []) this.questions.set(q.question_id, q)
    if (s.plan) this.applyPlanInternal(s.plan)
    if (s.permission_policy) this.applyPermissionsInternal(s.permission_policy, s.permission_revision)
    this.emit()
  }

  private applyPermissionsInternal(policy: SessionPolicy, revision: number): boolean {
    if (this.permissions && revision <= this.permissions.revision) return false
    this.permissions = { policy, revision }
    return true
  }

  /** Adopts a policy unless an equal or newer revision is already held. */
  applyPermissions(policy: SessionPolicy, revision: number) {
    if (this.applyPermissionsInternal(policy, revision)) {
      this.emit()
    }
  }

  private applyPlanInternal(plan: PlanState): boolean {
    if (plan.revision <= 0) return false
    if (this.plan && plan.revision <= this.plan.revision) return false
    this.plan = plan
    return true
  }

  /**
   * Adopts a plan state only when its revision is newer than the one held:
   * the snapshot and the replayed events may have been taken at different
   * moments, so an older state (cleared ones included) never wins.
   */
  applyPlan(plan: PlanState) {
    if (this.applyPlanInternal(plan)) {
      this.emit()
    }
  }

  updateSession(item: SessionItem) {
    this.session = item
    this.title = item.title
    this.emit()
  }

  /**
   * The label of the submit being sent (`null`: a plain submit, or none). It
   * goes on the user message of the next live run, keyed by that run's id, so
   * the label shows as the run starts; the engine's `run_labeled` comes at the
   * end of the run and changes nothing then.
   */
  setPendingSubmitLabel(label: string | null) {
    this.pendingSubmitLabel = label
  }

  /**
   * Places the command label of a run on its user message. A label already
   * set for the run is ignored; a label that arrives before the message is
   * applied when the message is created (see `startRun`).
   */
  applyRunLabel(label: RunLabel) {
    if (this.runLabels.get(label.run_id) === label.label) return
    this.runLabels.set(label.run_id, label.label)
    const idx = this.items.findIndex((i) => i.kind === 'user' && i.runId === label.run_id && !i.steered)
    if (idx >= 0) {
      const item = this.items[idx]
      if (item.kind === 'user') {
        const next = [...this.items]
        next[idx] = { ...item, commandLabel: label.label }
        this.items = next
      }
    }
    this.emit()
  }

  /**
   * Labels of a reopened session, oldest first. A run still in the timeline is
   * labelled by its run id. A label with `user_index` goes to the user message at
   * that index among all user-role messages of the history (`loadHistory`). A
   * label without an index (stored before it existed) goes to the first
   * unlabelled stored message with the same text, at most once. A label that
   * matches no message is dropped: nothing is invented.
   */
  private applyStoredLabels(labels: RunLabel[], userItemIds: Map<number, string>) {
    const byText: RunLabel[] = []
    for (const label of labels) {
      if (this.items.some((i) => i.kind === 'user' && i.runId === label.run_id)) {
        this.applyRunLabel(label)
        continue
      }
      if (label.user_index == null) {
        byText.push(label)
        continue
      }
      this.runLabels.set(label.run_id, label.label)
      const id = userItemIds.get(label.user_index)
      const item = this.items.find((i) => i.kind === 'user' && i.id === id)
      if (item?.kind === 'user' && !item.commandLabel) item.commandLabel = label.label
    }
    // Old labels: unlabelled stored messages, oldest first, each takes at most one.
    const free = this.items.filter(
      (i): i is UserItem => i.kind === 'user' && !i.runId && !i.commandLabel && !i.steered,
    )
    for (const label of byText) {
      this.runLabels.set(label.run_id, label.label)
      const at = free.findIndex((i) => i.text === label.prompt)
      if (at < 0) continue
      const [item] = free.splice(at, 1)
      item.commandLabel = label.label
    }
  }

  /**
   * Builds the timeline of the stored history. Returns the id of the user item
   * of each user-role message, keyed by the message's index among ALL user-role
   * messages (`RunLabel.user_index`). A message that makes no user item has none.
   */
  private loadHistory(history: HistoryMessage[]): Map<number, string> {
    const items: TimelineItem[] = []
    const tools = new Map<string, ToolItem>()
    const userItemIds = new Map<number, string>()
    let userIndex = -1
    for (const msg of history) {
      if (msg.role === 'system') continue
      // Every user-role message counts, the engine's skill activations included.
      if (msg.role === 'user') userIndex += 1
      // The user item of this message: the first one its text or its images make.
      let own: UserItem | undefined
      // A turn of tool results is the engine's: its text and images (an image a
      // tool showed, a note) belong to the calls, never to a user message.
      const engineTurn = msg.role === 'user' && msg.blocks.some((b) => b.type === 'tool_result')
      for (const block of msg.blocks) {
        if (engineTurn && (block.type === 'text' || block.type === 'image')) continue
        switch (block.type) {
          case 'text':
            if (!block.text.trim()) break
            // Only user text: an assistant text is never hidden, whatever it contains.
            if (msg.role === 'user' && (isEngineSkillActivation(block.text) || isTeamDelivery(block.text))) break
            if (msg.role === 'user') {
              const item: UserItem = { kind: 'user', id: localId('u'), text: block.text, attachments: [] }
              items.push(item)
              if (!own) {
                own = item
                userItemIds.set(userIndex, item.id)
              }
            } else {
              const last = items.at(-1)
              if (last?.kind === 'assistant') last.text += block.text
              else
                items.push({
                  kind: 'assistant',
                  id: localId('a'),
                  text: block.text,
                  thinking: '',
                  streaming: false,
                })
            }
            break
          case 'thinking': {
            const last = items.at(-1)
            if (last?.kind === 'assistant') last.thinking += block.text
            else
              items.push({
                kind: 'assistant',
                id: localId('a'),
                text: '',
                thinking: block.text,
                streaming: false,
              })
            break
          }
          case 'tool_use': {
            const t: ToolItem = {
              kind: 'tool',
              id: localId('t'),
              toolCallId: block.id,
              name: block.name,
              input: block.input,
              status: 'ok',
            }
            tools.set(block.id, t)
            items.push(t)
            break
          }
          case 'tool_result': {
            const t = tools.get(block.tool_use_id)
            if (t) {
              t.output = block.content
              t.status = block.is_error ? 'error' : 'ok'
            }
            break
          }
          case 'image': {
            if (msg.role === 'user' && block.path) {
              const info: AttachmentInfo = { kind: 'image', path: block.path, bytes: 0 }
              // The images of a message join its own user item, never a neighbouring one.
              if (own) own.attachments.push(info)
              else {
                own = { kind: 'user', id: localId('u'), text: '', attachments: [info] }
                items.push(own)
                userItemIds.set(userIndex, own.id)
              }
            }
            break
          }
        }
      }
      // The copies the message was sent with, kept by the desktop: shown again on
      // its own item (an image by its preview, read from the copy).
      if (msg.role === 'user' && msg.attachments?.length) {
        const infos: AttachmentInfo[] = msg.attachments.map((a) => ({
          kind: a.kind,
          path: a.name,
          bytes: a.size,
          attachment_id: a.id,
        }))
        if (own) {
          own.attachments = own.attachments.filter((x) => x.kind !== 'image' || !infos.some((i) => i.kind === 'image'))
          own.attachments.push(...infos)
        } else {
          own = { kind: 'user', id: localId('u'), text: '', attachments: infos }
          items.push(own)
          userItemIds.set(userIndex, own.id)
        }
      }
    }
    this.items = items
    return userItemIds
  }

  /**
   * Places the stored runs on their messages. A record whose `user_index` is
   * proven gives its run to that user message and to the items after it, up to
   * the next user message; its summary (files, commands, time) is the record's;
   * its end is a « bilan » item after the response. A record without a proven
   * index stays unplaced: nothing is matched by text.
   */
  private attachRecords(records: RunRecord[], userItemIds: Map<number, string>) {
    for (const record of records) {
      if (record.user_index == null || this.runs.has(record.run_id)) continue
      const id = userItemIds.get(record.user_index)
      const at = this.items.findIndex((i) => i.kind === 'user' && i.id === id)
      const item = this.items[at]
      if (item?.kind !== 'user' || item.runId) continue
      item.runId = record.run_id
      this.runs.set(record.run_id, storedRun(record, item.text))
      this.recordedRuns.add(record.run_id)
      let end = at + 1
      for (; end < this.items.length && this.items[end].kind !== 'user'; end++) {
        const own = this.items[end]
        if (own.kind !== 'run_end' && !own.runId) own.runId = record.run_id
      }
      if (record.finished_at != null) {
        this.items.splice(end, 0, { kind: 'run_end', id: localId('r'), runId: record.run_id })
      }
    }
  }

  /**
   * Re-applies the bridge's recent envelopes after the stored history: a
   * running run's events are replayed (its partial messages are dropped
   * from the history first, they come back from the events); for a
   * finished run only the run summary data is rebuilt (no text twice).
   */
  private replay(recent: Envelope[]) {
    if (recent.length === 0) return
    const lastRun = [...recent].reverse().find((e) => e.type === 'run_started')
    const running = this.runningRunId
    if (running && lastRun && lastRun.run_id === running) {
      const prompt = lastRun.type === 'run_started' ? lastRun.prompt : ''
      const idx = this.items.findLastIndex((i) => i.kind === 'user' && i.text === prompt)
      if (idx >= 0) this.items = this.items.slice(0, idx)
      for (const env of recent) {
        if (env.run_id === running || !env.run_id) this.applyEnvelope(env)
        else this.lastSeq = Math.max(this.lastSeq, env.seq)
      }
      return
    }
    // Idle: rebuild run/agent bookkeeping and the end card, not the text.
    for (const env of recent) {
      switch (env.type) {
        case 'text_delta':
        case 'thinking_delta':
        case 'tool_started':
        case 'tool_progress':
        case 'tool_finished':
        case 'message_injected':
        case 'notice':
          this.lastSeq = Math.max(this.lastSeq, env.seq)
          if (env.type === 'tool_finished') this.recordCommand(env)
          break
        case 'run_started':
          this.startRun(env, false)
          break
        default:
          this.applyEnvelope(env)
      }
    }
  }

  /** Applies one envelope; duplicates (seq already seen) are ignored. */
  apply(env: Envelope) {
    if (this.applyEnvelope(env)) {
      this.emit()
    }
  }

  private applyEnvelope(env: Envelope): boolean {
    // Another session's envelope never touches this one (nor its seq).
    if (env.session_id !== this.sessionId) return false
    if (env.seq <= this.lastSeq) return false
    this.lastSeq = env.seq
    const runId = env.run_id
    let itemsMutated = false
    switch (env.type) {
      case 'plan_updated':
        this.applyPlanInternal(env.plan)
        break
      case 'session_opened':
        this.workingDir = env.working_dir
        this.model = env.model
        this.reasoning = env.reasoning ?? null
        this.effectiveReasoning = env.effective_reasoning ?? null
        for (const w of env.warnings) this.notice('warning', w, runId)
        if (env.warnings.length > 0) itemsMutated = true
        break
      case 'run_started':
        this.startRun(env, true)
        itemsMutated = true
        break
      case 'text_delta': {
        const a = this.currentAssistant(runId)
        endThinking(a)
        a.text += env.text
        this.replaceLastItem(a)
        itemsMutated = true
        break
      }
      case 'thinking_delta': {
        const a = this.currentAssistant(runId)
        a.thinkingStartedAt ??= Date.now()
        a.thinking += env.text
        this.replaceLastItem(a)
        itemsMutated = true
        break
      }
      case 'tool_started':
        this.closeAssistant()
        this.items.push({
          kind: 'tool',
          id: localId('t'),
          toolCallId: env.tool_call_id,
          runId,
          name: env.name,
          input: env.input,
          status: 'running',
        })
        itemsMutated = true
        break
      case 'tool_progress': {
        const idx = this.findToolIndex(env.tool_call_id, env.name)
        if (idx >= 0) {
          const current = this.items[idx] as ToolItem
          this.items[idx] = { ...current, progress: env.message }
          itemsMutated = true
        }
        break
      }
      case 'tool_finished': {
        const idx = this.findToolIndex(env.tool_call_id, env.name)
        if (idx >= 0) {
          const current = this.items[idx] as ToolItem
          this.items[idx] = {
            ...current,
            status: env.is_error ? 'error' : 'ok',
            output: env.output,
            durationMs: env.duration_ms,
            progress: undefined,
          }
          itemsMutated = true
        }
        this.recordCommand(env)
        break
      }
      case 'approval_requested':
        this.closeAssistant()
        this.approvals.set(env.approval.approval_id, env.approval)
        this.items.push({ kind: 'approval', id: localId('ap'), runId, approval: env.approval })
        itemsMutated = true
        break
      case 'approval_resolved': {
        this.approvals.delete(env.approval_id)
        const idx = this.items.findLastIndex(
          (i): i is ApprovalItem =>
            i.kind === 'approval' && i.approval.approval_id === env.approval_id,
        )
        if (idx >= 0) {
          const item = this.items[idx] as ApprovalItem
          this.items[idx] = { ...item, resolved: { decision: env.decision, by: env.by } }
          itemsMutated = true
        }
        break
      }
      case 'question_asked':
        this.closeAssistant()
        this.questions.set(env.question.question_id, env.question)
        this.items.push({ kind: 'question', id: localId('q'), runId, question: env.question })
        itemsMutated = true
        break
      case 'question_resolved': {
        this.questions.delete(env.question_id)
        const idx = this.items.findLastIndex(
          (i): i is QuestionItem => i.kind === 'question' && i.question.question_id === env.question_id,
        )
        if (idx >= 0) {
          const item = this.items[idx] as QuestionItem
          this.items[idx] = { ...item, outcome: env.outcome }
          itemsMutated = true
        }
        break
      }
      case 'permission_policy_changed':
        this.applyPermissionsInternal(env.policy, env.revision)
        break
      case 'edit_applied': {
        // A sub-agent's edit belongs to its branch; the run still counts it.
        const agent = env.agent_id ? this.agents.get(env.agent_id) : undefined
        if (agent) {
          const nextAgent: AgentInfo = {
            ...agent,
            log: [
              ...agent.log,
              {
                event: {
                  type: 'edit_applied',
                  tool_call_id: env.tool_call_id,
                  tool: env.tool,
                  files: env.files,
                  agent_id: env.agent_id,
                  changeset_id: env.changeset_id,
                },
                at: env.at,
                execution: agent.execution,
              },
            ],
          }
          this.agents.set(agent.id, nextAgent)
          this.recordEdit(env, runId)
          break
        }
        this.closeAssistant()
        this.items.push({
          kind: 'edit',
          id: localId('e'),
          runId,
          toolCallId: env.tool_call_id,
          tool: env.tool,
          files: env.files.map(editFile),
          agentId: env.agent_id,
          changesetId: env.changeset_id,
        })
        this.recordEdit(env, runId)
        itemsMutated = true
        break
      }
      case 'context':
        this.context = env.status
        this.contextStale = false
        break
      case 'usage':
        this.turnUsages = [
          ...this.turnUsages.slice(-1999),
          { at: env.at, runId, usage: env.turn },
        ]
        this.usageTotalFull = env.total
        this.usageTotal = {
          input: env.total.input_tokens,
          output: env.total.output_tokens,
          costUsd: env.total.cost_usd,
        }
        break
      case 'compaction':
        this.lastCompaction = { at: env.at, reason: env.reason, outcome: env.outcome, compacted: env.compacted }
        this.contextStale = env.compacted || this.contextStale
        this.notice(
          'info',
          t('app.compaction', { reason: env.reason, outcome: env.outcome }),
          runId,
          true,
        )
        itemsMutated = true
        break
      case 'history_revised':
        this.applyRevision(env.user_index)
        this.contextStale = true
        itemsMutated = true
        break
      case 'context_cleared':
        this.lastClear = { at: env.at, messagesRemoved: env.messages_removed }
        this.contextStale = true
        this.notice('info', t('app.contextClearedCount', { count: env.messages_removed }), runId, true)
        itemsMutated = true
        break
      case 'model_changed':
        this.model = env.model
        this.reasoning = env.reasoning ?? null
        this.effectiveReasoning = env.effective_reasoning ?? null
        this.contextStale = true
        break
      case 'reasoning_changed':
        this.reasoning = env.requested ?? null
        this.effectiveReasoning = env.effective ?? null
        break
      case 'message_injected':
        this.closeAssistant()
        if (this.lastRejection?.command === 'inject') this.lastRejection = null
        this.items.push({
          kind: 'user',
          id: localId('u'),
          runId: runId ?? this.runningRunId ?? undefined,
          text: env.text,
          attachments: [],
          at: env.at,
          steered: true,
        })
        itemsMutated = true
        break
      case 'notice':
        this.notice('info', env.message, runId)
        itemsMutated = true
        break
      case 'run_finished': {
        this.closeAssistant()
        const id = runId ?? this.runningRunId
        // Nothing waits once the run is over: a question still open is closed.
        for (let idx = 0; idx < this.items.length; idx += 1) {
          const item = this.items[idx]
          if (item.kind === 'question' && !item.outcome) {
            this.items[idx] = { ...item, outcome: { state: 'skipped', reason: 'cancelled' } }
          }
        }
        this.questions.clear()
        const run = this.run(id ?? undefined)
        if (run) {
          this.runs.set(run.runId, {
            ...run,
            finishedAt: env.at,
            workedMs: workedOf(run.startedAt, env.at),
            outcome: env.outcome,
            error: env.error,
            termination: env.termination,
            finalText: env.text,
            turns: env.turns,
            approvalsUnsatisfied: env.approvals_unsatisfied ?? [],
          })
        }
        // One « bilan » per run: a replay of a stored run already placed it.
        if (id && !this.items.some((i) => i.kind === 'run_end' && i.runId === id)) {
          this.items.push({ kind: 'run_end', id: localId('r'), runId: id })
        }
        if (this.runningRunId === id) this.runningRunId = null
        for (let idx = 0; idx < this.items.length; idx += 1) {
          const item = this.items[idx]
          if (item.kind !== 'tool' || item.status !== 'running' || item.runId !== id) continue
          // A shell call that never reported an end is a command of unknown outcome.
          const live = this.liveRun(id)
          if (live && isShellTool(item.name)) {
            this.putCommand(live, {
              key: commandKey(live.runId, null, item.toolCallId),
              rootRunId: live.runId,
              agentId: null,
              toolCallId: item.toolCallId,
              name: item.name,
              command: commandText(item.input),
              status: 'unknown',
              isError: false,
              durationMs: null,
              output: null,
            })
          }
          this.items[idx] = { ...item, status: 'error' }
        }
        itemsMutated = true
        break
      }
      case 'agent_spawned': {
        const agent: AgentInfo = {
          id: env.agent.agent_id,
          spawn: env.agent,
          state: 'created',
          spawnedAt: env.at,
          tools: [],
          execution: 1,
          log: [{ event: agentRunStarted(env.agent, false), at: env.at, execution: 1 }],
        }
        this.agents.set(env.agent.agent_id, agent)
        this.placeAgent(env.agent.agent_id, env.agent.root_run_id, env.agent.tool_call_id ?? undefined, 1)
        itemsMutated = true
        break
      }
      case 'agent_state': {
        const existing = this.agents.get(env.agent_id)
        const execution = env.execution ?? 1
        if (existing) {
          let nextAgent = existing
          if (execution > existing.execution) {
            // A resume: the same identity starts a new execution, timed from now.
            nextAgent = {
              ...existing,
              execution,
              spawnedAt: env.at,
              endedAt: undefined,
              result: undefined,
              tools: [],
              log: [...existing.log, { event: agentRunStarted(existing.spawn, true), at: env.at, execution }],
            }
            this.placeAgent(existing.id, env.run_id ?? existing.spawn.root_run_id, undefined, execution)
            itemsMutated = true
          }
          // A state of an older execution is stale: it changes nothing.
          if (execution === nextAgent.execution) {
            nextAgent = {
              ...nextAgent,
              state: env.state,
              reason: env.reason,
              endedAt: TERMINAL_AGENT_STATES.includes(env.state) ? env.at : nextAgent.endedAt,
            }
          }
          this.agents.set(env.agent_id, nextAgent)
        }
        break
      }
      case 'agent_text': {
        const a = this.agents.get(env.agent_id)
        if (a) {
          this.agents.set(a.id, {
            ...a,
            log: [...a.log, { event: { type: 'text_delta', text: env.text }, at: env.at, execution: a.execution }],
          })
        }
        break
      }
      case 'agent_tool_started': {
        const a = this.agents.get(env.agent_id)
        if (a) {
          this.agents.set(a.id, {
            ...a,
            tools: [
              ...a.tools,
              {
                toolCallId: env.tool_call_id,
                name: env.name,
                input: env.input,
                status: 'running',
              },
            ],
            log: [
              ...a.log,
              {
                event: { type: 'tool_started', tool_call_id: env.tool_call_id, name: env.name, input: env.input },
                at: env.at,
                execution: a.execution,
              },
            ],
          })
        }
        break
      }
      case 'agent_tool_finished': {
        const agent = this.agents.get(env.agent_id)
        if (agent) {
          const tools = [...agent.tools]
          const tIdx = tools.findLastIndex((t) => t.toolCallId === env.tool_call_id)
          const matchedTool = tIdx >= 0 ? tools[tIdx] : undefined
          if (tIdx >= 0) {
            tools[tIdx] = {
              ...tools[tIdx],
              status: env.is_error ? 'error' : 'ok',
              durationMs: env.duration_ms,
            }
          }
          this.recordAgentCommand(env, agent, matchedTool?.input)
          this.agents.set(agent.id, {
            ...agent,
            tools,
            log: [
              ...agent.log,
              {
                event: {
                  type: 'tool_finished',
                  tool_call_id: env.tool_call_id,
                  name: env.name,
                  is_error: env.is_error,
                  duration_ms: env.duration_ms,
                  output: env.output ?? '',
                  executed: env.executed,
                  status: env.status,
                },
                at: env.at,
                execution: agent.execution,
              },
            ],
          })
        }
        break
      }
      case 'agent_finished': {
        const a = this.agents.get(env.result.agent_id)
        if (a && (env.result.execution ?? 1) === a.execution) {
          const nextAgent: AgentInfo = {
            ...a,
            result: env.result,
            endedAt: a.endedAt ?? env.at,
            log: [...a.log],
          }
          closeAgentLog(nextAgent, env.result, env.at)
          this.agents.set(a.id, nextAgent)
        }
        break
      }
      case 'changes_ready':
        this.changesets.set(env.changeset.id, env.changeset)
        break
      case 'changes_updated': {
        const cs = this.changesets.get(env.changeset_id)
        if (cs) {
          this.changesets.set(env.changeset_id, { ...cs, state: env.state })
        }
        break
      }
      case 'skills_trust_requested':
        this.skillsTrust = { project: env.project, sources: env.sources }
        break
      case 'skills_trust_resolved':
        this.skillsTrust = null
        break
      case 'run_usage': {
        this.runUsages.set(env.root_run_id, env)
        const run = this.runs.get(env.root_run_id)
        // Each total replaces the run's cost; a provisional one never replaces a final one.
        if (run && !(run.usage?.final && !env.final_total)) {
          this.runs.set(run.runId, {
            ...run,
            usage: {
              input: env.total.input_tokens,
              output: env.total.output_tokens,
              cacheRead: env.total.cache_read_input_tokens,
              costUsd: env.total.cost_usd ?? null,
              partial: env.total.cost_estimate?.partial ?? false,
              final: env.final_total,
            },
          })
        }
        break
      }
      case 'memory_recalled':
        this.memory = {
          ...this.memory,
          lastRecall: {
            at: env.at,
            items: env.items,
            tokens: env.tokens,
            omitted: env.omitted,
            budget: env.budget,
          },
        }
        break
      case 'memory_maintenance_started':
        this.memory = {
          ...this.memory,
          maintenanceRunning: true,
        }
        break
      case 'memory_maintenance_finished':
        this.memory = {
          ...this.memory,
          maintenanceRunning: false,
          lastMaintenance: {
            at: env.at,
            outcome: env.outcome,
            report: env.report,
            error: env.error,
          },
        }
        break
      case 'search_results':
        this.searchResult = {
          at: env.at,
          query: env.query,
          status: env.status,
          hits: env.hits,
          omitted: env.omitted,
          notes: env.notes ?? [],
          elapsedMs: env.elapsed_ms,
        }
        break
      case 'agent_profiles':
        this.agentProfiles = env
        break
      case 'skills':
        this.skillsListing = { at: env.at, listing: env.listing as SkillsListing }
        break
      case 'skill_activated':
        if (!env.agent_id) this.lastSkill = { at: env.at, name: env.name, ok: true }
        break
      case 'skill_activation_failed': {
        // A sub-agent's failure is told in its branch.
        const agent = env.agent_id ? this.agents.get(env.agent_id) : undefined
        if (agent) {
          this.agents.set(agent.id, {
            ...agent,
            log: [
              ...agent.log,
              {
                event: { type: 'skill_activation_failed', name: env.name, reason: env.reason },
                at: env.at,
                execution: agent.execution,
              },
            ],
          })
          break
        }
        if (!env.agent_id) this.lastSkill = { at: env.at, name: env.name, ok: false, reason: env.reason }
        this.notice('error', t('app.skillNotActivated', { name: env.name, reason: env.reason }), runId)
        itemsMutated = true
        break
      }
      case 'job_started':
        this.jobs.set(env.job_id, {
          jobId: env.job_id,
          agentId: env.agent_id,
          rootRunId: env.root_run_id,
          command: env.command,
          cwd: env.cwd,
          pid: env.pid,
          startedAt: env.at,
          stdoutBytes: 0,
          stderrBytes: 0,
          state: 'running',
          logs: [],
        })
        break
      case 'job_output': {
        const j = this.jobs.get(env.job_id)
        if (j) {
          this.jobs.set(env.job_id, {
            ...j,
            stdoutBytes: env.stdout_bytes,
            stderrBytes: env.stderr_bytes,
          })
        }
        break
      }
      case 'job_finished': {
        const j = this.jobs.get(env.job_id)
        if (j) {
          this.jobs.set(env.job_id, {
            ...j,
            state: env.state,
            code: env.code,
            signal: env.signal,
            durationMs: env.duration_ms,
            logs: env.logs ?? [],
            logsError: env.logs_error,
          })
        }
        const link = this.jobCommands.get(env.job_id)
        if (link) this.updateCommand(link.runId, link.key, env.state, env.duration_ms, env.logs ?? [])
        break
      }
      case 'agent_control_result':
        this.lastAgentControl = { action: env.action, ok: env.ok, text: env.text, at: env.at }
        break
      case 'command_rejected':
        this.lastRejection = { command: env.command, reason: env.reason, at: env.at }
        // A refused submit starts no run: its label is not waiting for one.
        if (env.command === 'submit') this.pendingSubmitLabel = null
        // A refused revision changed nothing: the message stays in the timeline.
        if (env.command === 'revise') this.revisingItemId = null
        break
      default:
        break
    }
    if (itemsMutated) {
      this.items = [...this.items]
    }
    return true
  }

  private replaceLastItem(item: TimelineItem) {
    if (this.items.length === 0) return
    this.items[this.items.length - 1] = { ...item }
  }

  private startRun(env: Extract<Envelope, { type: 'run_started' }>, live: boolean) {
    const runId = env.run_id ?? localId('run')
    this.lastSeq = Math.max(this.lastSeq, env.seq)
    // A stored run keeps its record's summary when its events are replayed.
    if (!live && this.recordedRuns.has(runId)) return
    this.runs.set(runId, {
      runId,
      prompt: env.prompt,
      model: env.model,
      reasoning: env.reasoning,
      startedAt: env.at,
      approvalsUnsatisfied: [],
      files: new Map(),
      fileSummaries: [],
      commands: [],
      workedMs: null,
      usage: null,
    })
    if (!live) return
    this.runningRunId = runId
    this.lastRejection = null
    // The submit sent last is the one that starts this run: its label is kept by run id.
    if (this.pendingSubmitLabel !== null) {
      this.runLabels.set(runId, this.pendingSubmitLabel)
      this.pendingSubmitLabel = null
    }
    const commandLabel = this.runLabels.get(runId)
    this.closeAssistant()
    this.items.push({
      kind: 'user',
      id: localId('u'),
      runId,
      text: env.prompt,
      attachments: env.attachments,
      at: env.at,
      ...(commandLabel === undefined ? {} : { commandLabel }),
    })
  }

  /** The run whose summary the events add to: none for a stored run (its record is the summary). */
  private liveRun(runId: string | undefined): RunInfo | undefined {
    if (!runId || this.recordedRuns.has(runId)) return undefined
    return this.run(runId)
  }

  /** Counts each edit operation of an applied change once (`operationKey`). */
  private recordEdit(env: Extract<Envelope, { type: 'edit_applied' }>, runId: string | undefined) {
    const owner = env.agent_id ? this.agents.get(env.agent_id)?.spawn.root_run_id : undefined
    const run = this.liveRun(owner ?? runId)
    if (!run) return
    const counted = this.operationsOf(run.runId)
    const files = new Map(run.files)
    for (const f of env.files) {
      const opKey = operationKey(env.agent_id, env.tool_call_id, f.path)
      if (counted.has(opKey)) continue
      counted.add(opKey)
      const key = fileKey(run.runId, f.absolute, f.path)
      const prev = files.get(key)
      const agentIds = prev ? [...prev.agentIds] : []
      if (env.agent_id && !agentIds.includes(env.agent_id)) agentIds.push(env.agent_id)
      files.set(key, {
        key,
        path: f.path,
        absolute: f.absolute ?? prev?.absolute ?? null,
        name: basename(f.path),
        added: (prev?.added ?? 0) + f.added,
        removed: (prev?.removed ?? 0) + f.removed,
        binary: (prev?.binary ?? false) || !!f.binary,
        kind: f.kind,
        operations: (prev?.operations ?? 0) + 1,
        agentIds,
      })
    }
    this.runs.set(run.runId, {
      ...run,
      files,
      fileSummaries: [...files.values()],
    })
  }

  private operationsOf(runId: string): Set<string> {
    let counted = this.operationKeys.get(runId)
    if (!counted) {
      counted = new Set()
      this.operationKeys.set(runId, counted)
    }
    return counted
  }

  /**
   * A shell call of the session agent ended. A refusal (`executed: false`) never
   * ran and is not a command. A running one stays `running` until its job ends.
   */
  private recordCommand(env: Extract<Envelope, { type: 'tool_finished' }>) {
    if (!isShellTool(env.name) || env.executed === false) return
    const run = this.liveRun(env.run_id)
    if (!run) return
    const command = commandText(this.findTool(env.tool_call_id, env.name)?.input)
    this.putCommand(run, {
      key: commandKey(run.runId, null, env.tool_call_id),
      rootRunId: run.runId,
      agentId: null,
      toolCallId: env.tool_call_id,
      name: env.name,
      command,
      status: statusOf(env.status),
      isError: env.is_error,
      durationMs: env.duration_ms,
      output: env.output,
    })
  }

  /** A sub-agent's shell call ended (its own entry, under its root run). */
  private recordAgentCommand(
    env: Extract<Envelope, { type: 'agent_tool_finished' }>,
    agent: AgentInfo,
    input: unknown,
  ) {
    if (!isShellTool(env.name) || env.executed === false) return
    const rootRunId = agent.spawn.root_run_id
    const run = this.liveRun(rootRunId)
    if (!run) return
    this.putCommand(run, {
      key: commandKey(rootRunId, env.agent_id, env.tool_call_id),
      rootRunId,
      agentId: env.agent_id,
      toolCallId: env.tool_call_id,
      name: env.name,
      command: commandText(input),
      status: statusOf(env.status),
      isError: env.is_error,
      durationMs: env.duration_ms,
      output: env.output ?? null,
    })
  }

  /** Adds a command, or replaces the entry of its key. A running one takes a job that already ended. */
  private putCommand(run: RunInfo, command: CommandEvidence) {
    const commands = [...run.commands]
    const at = commands.findIndex((c) => c.key === command.key)
    if (at >= 0) commands[at] = command
    else commands.push(command)
    this.runs.set(run.runId, { ...run, commands })
    if (command.status !== 'running') return
    const job = [...this.jobs.values()].find(
      (j) =>
        !this.claimedJobs.has(j.jobId) &&
        j.command === command.command &&
        j.rootRunId === run.runId &&
        (this.agents.has(j.agentId) ? j.agentId : null) === command.agentId,
    )
    if (!job) return
    this.claimedJobs.add(job.jobId)
    this.jobCommands.set(job.jobId, { runId: run.runId, key: command.key })
    if (job.state !== 'running') {
      this.updateCommand(run.runId, command.key, job.state, job.durationMs ?? null, job.logs)
    }
  }

  /** The end of a background job, on the command it was matched to. */
  private updateCommand(runId: string, key: string, state: string, durationMs: number | null | undefined, logs: string[]) {
    const run = this.run(runId)
    const at = run?.commands.findIndex((c) => c.key === key) ?? -1
    if (!run || at < 0) return
    const current = run.commands[at]
    const status = jobStatus(state)
    const commands = [...run.commands]
    commands[at] = {
      ...current,
      status,
      isError: status !== 'success',
      durationMs: durationMs ?? current.durationMs,
      output: logs.length > 0 ? logs.join('\n') : current.output,
    }
    this.runs.set(run.runId, { ...run, commands })
  }

  private currentAssistant(runId: string | undefined): AssistantItem {
    const last = this.items.at(-1)
    if (last?.kind === 'assistant' && last.streaming && last.runId === runId) {
      return { ...last }
    }
    // Every other item closes the answer before it (see `closeAssistant`).
    this.closeAssistant()
    const item: AssistantItem = {
      kind: 'assistant',
      id: localId('a'),
      runId,
      text: '',
      thinking: '',
      streaming: true,
    }
    this.items.push(item)
    return { ...item }
  }

  /**
   * Places a sub-agent in the thread once per execution: right after the parent's
   * call that launched it (after its siblings of the same call), or, for a resume,
   * where the thread is now. A reopened agent without its call goes before the end
   * of its run.
   */
  private placeAgent(agentId: string, runId: string | undefined, toolCallId: string | undefined, execution: number) {
    const id = execution === 1 ? `agent-${agentId}` : `agent-${agentId}-e${execution}`
    if (this.items.some((i) => i.id === id)) return
    const item: AgentItem = { kind: 'agent', id, runId, agentId, toolCallId, execution }
    const call = toolCallId ? this.items.findIndex((i) => i.kind === 'tool' && i.toolCallId === toolCallId) : -1
    if (call >= 0) {
      let at = call + 1
      while (at < this.items.length) {
        const next = this.items[at]
        if (next.kind !== 'agent' || next.toolCallId !== toolCallId) break
        at += 1
      }
      this.items.splice(at, 0, item)
      return
    }
    if (execution === 1 && runId) {
      const end = this.items.findIndex((i) => i.kind === 'run_end' && i.runId === runId)
      if (end >= 0) {
        this.items.splice(end, 0, item)
        return
      }
    }
    this.closeAssistant()
    this.items.push(item)
  }

  /**
   * Closes the streaming answer. Every item pushed after it closes it first, so
   * at most one answer is streaming, and it is the last item.
   */
  private closeAssistant() {
    if (this.items.length === 0) return
    const last = this.items[this.items.length - 1]
    if (last?.kind === 'assistant') {
      const next: AssistantItem = { ...last, streaming: false }
      endThinking(next)
      this.items[this.items.length - 1] = next
    }
  }

  private findToolIndex(toolCallId: string | undefined, name: string): number {
    return this.items.findLastIndex(
      (i): i is ToolItem =>
        i.kind === 'tool' &&
        (toolCallId ? i.toolCallId === toolCallId : i.name === name && i.status === 'running'),
    )
  }

  private findTool(toolCallId: string | undefined, name: string): ToolItem | undefined {
    const idx = this.findToolIndex(toolCallId, name)
    return idx >= 0 ? (this.items[idx] as ToolItem) : undefined
  }

  private notice(level: NoticeItem['level'], message: string, runId?: string, separator = false) {
    this.closeAssistant()
    this.items.push({
      kind: 'notice',
      id: localId('n'),
      runId,
      level,
      message,
      ...(separator ? { separator: true } : {}),
    })
  }
}

const noopSubscribe = () => () => {}
const noopSnapshot = () => 0

export function useConversation(conv: Conversation | null | undefined): Conversation | null
export function useConversation<T>(
  conv: Conversation | null | undefined,
  selector: (conv: Conversation) => T,
  isEqual?: (a: T, b: T) => boolean,
): T | undefined
export function useConversation<T>(
  conv: Conversation | null | undefined,
  selector?: (conv: Conversation) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): Conversation | T | null | undefined {
  const cacheRef = useRef<{
    hasValue: boolean
    value: T | undefined
    version: number
    conv: Conversation | null | undefined
    selector?: (conv: Conversation) => T
  }>({ hasValue: false, value: undefined, version: -1, conv, selector })

  const subscribe = conv ? conv.subscribe : noopSubscribe
  const getSnapshot = (): T | number | undefined => {
    if (!selector) return conv ? conv.getSnapshot() : 0
    const cache = cacheRef.current
    const version = conv ? conv.getSnapshot() : -1
    if (
      cache.hasValue &&
      cache.conv === conv &&
      cache.version === version &&
      cache.selector === selector
    ) {
      return cache.value
    }
    const next = conv ? selector(conv) : undefined
    if (cache.hasValue && cache.conv === conv && isEqual(cache.value as T, next as T)) {
      cache.version = version
      cache.selector = selector
      return cache.value
    }
    cache.hasValue = true
    cache.value = next
    cache.version = version
    cache.conv = conv
    cache.selector = selector
    return next
  }

  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  return selector ? (snap as T | undefined) : (conv ?? null)
}
