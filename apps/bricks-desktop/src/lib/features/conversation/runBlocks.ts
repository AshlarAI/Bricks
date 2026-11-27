// The timeline as the person reads it: each run's steps (reasoning, tools,
// sub-agents, intermediate messages) are gathered in one work block under the
// message that started the run; once the run has ended, its last message with
// text is the answer and follows the block, then the run's end summary. Items
// without a run (an older history) stay as they are. Pure: unit-tested
// (tests/unit/run-blocks.test.ts).
import { t } from '$lib/i18n/i18n'
import type { AssistantItem, RunInfo, TimelineItem } from '$lib/state/conversation'
import type { IconComponent } from '$lib/layout/types'
import { formatToolName } from './format'
import { MESSAGE_ICON, THINKING_ICON, toolIcon } from './timeline/toolIcons'

export interface WorkBlock {
  kind: 'work'
  key: string
  runId: string
  /** The steps of the run, in order; never the answer, the user message or the end. */
  items: TimelineItem[]
  /** The answer's own reasoning, shown with the steps while the answer is apart. */
  answerReasoning: AssistantItem | null
}

export type TimelineBlock =
  | { kind: 'item'; key: string; item: TimelineItem; /** The run's answer: its text only. */ answer?: boolean }
  | WorkBlock

export interface TurnWindow {
  visible: readonly TimelineItem[]
  hiddenTurns: number
  totalTurns: number
  startIndex: number
}

/**
 * Slice `items` to the last `maxTurns` user turns, always starting at a turn/run
 * boundary so a run's `WorkBlock` is never split in half.
 */
export function turnWindow(items: readonly TimelineItem[], maxTurns: number): TurnWindow {
  const userIndices: number[] = []
  for (let i = 0; i < items.length; i++) {
    if (items[i].kind === 'user') userIndices.push(i)
  }
  const totalTurns = userIndices.length
  if (totalTurns === 0 || maxTurns >= totalTurns) {
    return { visible: items, hiddenTurns: 0, totalTurns, startIndex: 0 }
  }
  const keep = Math.max(1, maxTurns)
  let startIndex = userIndices[totalTurns - keep]
  const startRunId = items[startIndex]?.runId
  if (startRunId) {
    while (startIndex > 0 && items[startIndex - 1]?.runId === startRunId) {
      startIndex--
    }
  }
  let hiddenTurns = 0
  for (const idx of userIndices) {
    if (idx < startIndex) hiddenTurns++
    else break
  }
  return {
    visible: startIndex > 0 ? items.slice(startIndex) : items,
    hiddenTurns,
    totalTurns,
    startIndex,
  }
}

/**
 * Number of trailing turns needed to bring the user message with `id === itemId`
 * into the visible window, or `null` when no matching user item exists.
 */
export function turnsRequiredForKey(items: readonly TimelineItem[], itemId: string): number | null {
  const userIds: string[] = []
  for (const item of items) {
    if (item.kind === 'user') userIds.push(item.id)
  }
  const pos = userIds.indexOf(itemId)
  return pos === -1 ? null : userIds.length - pos
}

/** The last message with text of an ended run: its answer. `null` while it runs. */
export function answerOf(
  items: readonly TimelineItem[],
  runId: string,
  running: boolean,
): AssistantItem | null {
  if (running) return null
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'assistant' && item.runId === runId && item.text.trim()) return item
  }
  return null
}

/**
 * The blocks of `visible` (a window of `all`). The answer is found in `all`, so a
 * window that starts inside a run still knows it. `runningRunId` is the run at work.
 */
export function timelineBlocks(
  visible: readonly TimelineItem[],
  all: readonly TimelineItem[],
  runs: ReadonlyMap<string, RunInfo>,
  runningRunId: string | null,
): TimelineBlock[] {
  // Runs of the window that have ended: their answers, found in one pass from the end.
  const wanted = new Set<string>()
  for (const item of visible) {
    if (item.runId && item.runId !== runningRunId && runs.has(item.runId)) wanted.add(item.runId)
  }
  const answers = new Map<string, AssistantItem>()
  for (let i = all.length - 1; i >= 0 && answers.size < wanted.size; i--) {
    const item = all[i]
    if (item.kind !== 'assistant' || !item.runId || !wanted.has(item.runId) || answers.has(item.runId)) continue
    if (item.text.trim()) answers.set(item.runId, item)
  }

  const isStandalone = (item: TimelineItem) =>
    item.kind === 'run_end' || (item.kind === 'notice' && item.separator === true)

  // The steps of each run in the window, segmented around user items (initial or steered)
  // so steps performed after mid-run steering stay below the steered bubble.
  const segmentsByRun = new Map<string, { items: TimelineItem[]; hasAnswer: boolean }[]>()
  const currentSegmentIndex = new Map<string, number>()

  for (const item of visible) {
    const runId = item.runId
    if (!runId || !runs.has(runId)) continue
    let list = segmentsByRun.get(runId)
    if (!list) {
      list = [{ items: [], hasAnswer: false }]
      segmentsByRun.set(runId, list)
      currentSegmentIndex.set(runId, 0)
    } else if (item.kind === 'user') {
      list.push({ items: [], hasAnswer: false })
      currentSegmentIndex.set(runId, list.length - 1)
    }
    if (item.kind === 'user' || isStandalone(item)) continue
    const seg = list[currentSegmentIndex.get(runId)!]
    if (item === answers.get(runId)) {
      seg.hasAnswer = true
      continue
    }
    seg.items.push(item)
  }

  const blocks: TimelineBlock[] = []
  const segmentCursor = new Map<string, number>()
  const pushWork = (runId: string, forceInitial: boolean) => {
    const segIdx = segmentCursor.get(runId) ?? 0
    const list = segmentsByRun.get(runId) ?? []
    if (segIdx >= list.length) return
    segmentCursor.set(runId, segIdx + 1)
    const seg = list[segIdx]
    const final = answers.get(runId)
    const reasoning =
      seg.hasAnswer && final && final.thinking.trim() && visible.includes(final) ? final : null
    const isLatestActive = runId === runningRunId && segIdx === list.length - 1
    if (!forceInitial && seg.items.length === 0 && reasoning === null && !isLatestActive) {
      return
    }
    const key = segIdx === 0 ? `work-${runId}` : `work-${runId}-${segIdx}`
    blocks.push({ kind: 'work', key, runId, items: seg.items, answerReasoning: reasoning })
  }

  for (const item of visible) {
    const runId = item.runId
    // A run the timeline knows nothing about keeps its items as they are.
    if (!runId || !runs.has(runId)) {
      blocks.push({ kind: 'item', key: item.id, item })
      continue
    }
    if (item.kind === 'user') {
      blocks.push({ kind: 'item', key: item.id, item })
      const segIdx = segmentCursor.get(runId) ?? 0
      pushWork(runId, segIdx === 0)
      continue
    }
    if (!segmentCursor.has(runId)) {
      pushWork(runId, true)
    }
    if (isStandalone(item)) blocks.push({ kind: 'item', key: item.id, item })
    else if (item === answers.get(runId)) blocks.push({ kind: 'item', key: item.id, item, answer: true })
  }
  return blocks
}

/** Items that ask the person something: shown even when the steps are folded. */
export function needsAttention(item: TimelineItem): boolean {
  return (item.kind === 'approval' && !item.resolved) || (item.kind === 'question' && !item.outcome)
}

export interface CurrentStep {
  icon: IconComponent
  label: string
}

/** What the run is doing now: its last step that is a tool, a sub-agent or a message. */
export function currentStep(items: readonly TimelineItem[]): CurrentStep | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'tool') return { icon: toolIcon(item.name), label: formatToolName(item.name) }
    if (item.kind === 'agent') return { icon: toolIcon('Agent'), label: t('common.agent2') }
    if (item.kind === 'assistant') {
      if (item.text.trim()) return { icon: MESSAGE_ICON, label: t('conversation.writing') }
      if (item.thinking.trim() || item.streaming) return { icon: THINKING_ICON, label: t('conversation.thinking') }
    }
  }
  return null
}
