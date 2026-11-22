import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from 'lucide-react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Button } from '$lib/components/ui/button'
import { t, useLanguage } from '$lib/i18n/i18n'
import { cn } from '$lib/utils'
import { useConversation, type Conversation, type TimelineItem, type UserItem } from '$lib/state/conversation'
import { OUTCOME_LABEL, truncate } from './format'
import ApprovalCard from './timeline/ApprovalCard'
import QuestionCard from './timeline/QuestionCard'
import SkillsTrustBanner from './timeline/SkillsTrustBanner'
import TimelineEntry from './timeline/TimelineEntry'
import WorkBlock from './timeline/WorkBlock'
import MessageRail from './MessageRail'
import { timelineBlocks, turnWindow, turnsRequiredForKey } from './runBlocks'

export interface ConversationTimelineProps {
  conversation: Conversation
}

/** User turns rendered at once; earlier ones load on scroll or request. */
const TURN_WINDOW = 20
const NEAR_BOTTOM_PX = 80
/** Keep the tail and active work out of `content-visibility: auto` so initial paint stays immediate. */
const DEFERRED_TAIL_BLOCKS = 6

function firstVisibleBlock(list: HTMLElement | null): HTMLElement | null {
  if (!list) return null
  for (const el of list.querySelectorAll<HTMLElement>('[data-block-key]')) {
    if (el.getBoundingClientRect().height > 0 || el.childElementCount > 0) return el
  }
  return null
}

export function ConversationTimeline({ conversation }: ConversationTimelineProps) {
  const language = useLanguage()
  useConversation(conversation)

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const topSentinelRef = useRef<HTMLDivElement | null>(null)
  const [nearBottom, setNearBottom] = useState(true)
  const nearBottomRef = useRef(true)
  /** Items that arrived while the user was scrolled up. */
  const [unseen, setUnseen] = useState(0)
  const [turnLimit, setTurnLimit] = useState(TURN_WINDOW)
  const [trackedConv, setTrackedConv] = useState(conversation)
  /** Text of the polite live region: completed messages and attention needs only. */
  const [announcement, setAnnouncement] = useState('')

  const pendingScrollAdjustRef = useRef<{
    key: string | null
    top: number
    scrollHeight: number
  } | null>(null)
  const pendingJumpKeyRef = useRef<string | null>(null)
  const autoLoadInFlightRef = useRef(false)

  if (trackedConv !== conversation) {
    setTrackedConv(conversation)
    setTurnLimit(TURN_WINDOW)
    setUnseen(0)
    setNearBottom(true)
    nearBottomRef.current = true
    pendingScrollAdjustRef.current = null
    pendingJumpKeyRef.current = null
    autoLoadInFlightRef.current = false
  }

  const handleViewportRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    setScrollEl(el)
  }, [])

  const items = conversation.items
  const convVersion = typeof conversation.getSnapshot === 'function' ? conversation.getSnapshot() : 0
  const running = conversation.running
  const runningRef = useRef(running)
  runningRef.current = running

  const { visible, hiddenTurns } = useMemo(
    () => turnWindow(items, turnLimit),
    [items, turnLimit, convVersion],
  )
  const blocks = useMemo(
    () => timelineBlocks(visible, items, conversation.runs, conversation.runningRunId),
    [visible, items, conversation, convVersion],
  )

  /** One grain per message sent across the full conversation: the message, its answer, its time. */
  const marks = useMemo(() => {
    const users: UserItem[] = []
    for (const item of items) {
      if (item.kind === 'user') users.push(item)
    }
    const lastAnswers = new Map<string, string>()
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'assistant' && item.runId && !lastAnswers.has(item.runId) && item.text.trim()) {
        lastAnswers.set(item.runId, item.text)
      }
    }
    return users.map((item, idx) => {
      const run = item.runId ? conversation.runs.get(item.runId) : undefined
      const ended = item.runId !== undefined && item.runId !== conversation.runningRunId
      const answer = ended ? (run?.finalText ?? lastAnswers.get(item.runId!) ?? '') : ''
      return {
        key: item.id,
        label: truncate(item.text.trim() || t('conversation.message'), 80),
        answer: truncate(answer.trim(), 400),
        at: item.at ?? run?.startedAt ?? null,
        place: idx + 1,
        total: users.length,
      }
    })
  }, [items, conversation, convVersion, language])

  /** The run at work has no block when none of its items is in the view (it started elsewhere). */
  const runningWithoutBlock =
    conversation.runningRunId !== null &&
    !blocks.some((block) => block.kind === 'work' && block.runId === conversation.runningRunId)

  /** Waiting approvals with no card in the timeline (e.g. after a reload). */
  const orphanApprovals = useMemo(
    () =>
      conversation.pendingApprovals.filter(
        (approval) => !items.some((item) => item.kind === 'approval' && item.approval.approval_id === approval.approval_id),
      ),
    [conversation, items, convVersion],
  )

  /** Waiting questions with no card in the timeline (e.g. after a reload). */
  const orphanQuestions = useMemo(
    () =>
      conversation.pendingQuestions.filter(
        (question) => !items.some((item) => item.kind === 'question' && item.question.question_id === question.question_id),
      ),
    [conversation, items, convVersion],
  )

  /** Length of the growing text of the last item: changes on every streamed delta. */
  const lastItem = items.at(-1)
  const tail = !lastItem
    ? 0
    : lastItem.kind === 'assistant'
      ? lastItem.text.length + lastItem.thinking.length
      : lastItem.kind === 'tool'
        ? (lastItem.output?.length ?? 0) + (lastItem.progress?.length ?? 0)
        : 0

  const updateNearBottom = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const next = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX
    nearBottomRef.current = next
    setNearBottom(next)
    if (next) setUnseen(0)
  }, [])

  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
    nearBottomRef.current = true
    setNearBottom(true)
    setUnseen(0)
  }, [])

  const loadEarlier = useCallback(() => {
    const el = scrollRef.current
    const anchor = firstVisibleBlock(listRef.current)
    pendingScrollAdjustRef.current = el
      ? {
          key: anchor?.dataset.blockKey ?? null,
          top: anchor ? anchor.getBoundingClientRect().top : 0,
          scrollHeight: el.scrollHeight,
        }
      : null
    setTurnLimit((prev) => prev + TURN_WINDOW)
  }, [])

  const jumpToTurn = useCallback(
    (key: string) => {
      const needed = turnsRequiredForKey(items, key)
      if (needed === null) return
      nearBottomRef.current = false
      setNearBottom(false)
      pendingScrollAdjustRef.current = null
      pendingJumpKeyRef.current = key
      setTurnLimit((prev) => (prev >= needed ? prev : needed))
    },
    [items],
  )

  useLayoutEffect(() => {
    autoLoadInFlightRef.current = false
    const el = scrollRef.current
    const jumpKey = pendingJumpKeyRef.current
    if (jumpKey && el) {
      const turn = el.querySelector<HTMLElement>(`[data-turn="${CSS.escape(jumpKey)}"]`)
      if (turn) {
        pendingJumpKeyRef.current = null
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        const margin = parseFloat(getComputedStyle(turn).scrollMarginTop) || 0
        const top =
          turn.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - margin
        el.scrollTo({ top, behavior: reduced ? 'auto' : 'smooth' })
        updateNearBottom()
        return
      }
    }
    const adj = pendingScrollAdjustRef.current
    if (!adj) return
    pendingScrollAdjustRef.current = null
    if (!el) return
    const anchor = adj.key
      ? listRef.current?.querySelector<HTMLElement>(`[data-block-key="${CSS.escape(adj.key)}"]`)
      : null
    if (anchor && anchor.getBoundingClientRect().height > 0) {
      el.scrollTop += anchor.getBoundingClientRect().top - adj.top
    } else {
      el.scrollTop += el.scrollHeight - adj.scrollHeight
    }
  }, [turnLimit, updateNearBottom])

  const prevConversationRef = useRef(conversation)
  const prevCountRef = useRef(-1)
  const initialisedRef = useRef(false)
  const announcedCountRef = useRef(-1)

  if (prevConversationRef.current !== conversation) {
    prevConversationRef.current = conversation
    prevCountRef.current = -1
    initialisedRef.current = false
    announcedCountRef.current = -1
  }

  // Follow the output while the run streams, only if the user is at the bottom.
  // Opening a conversation starts at the bottom; a new item sent by the user too.
  useEffect(() => {
    const el = scrollEl
    if (!el) return
    const count = items.length
    const grew = prevCountRef.current < 0 ? 0 : count - prevCountRef.current
    prevCountRef.current = count
    if (!initialisedRef.current) {
      initialisedRef.current = true
      scrollToBottom()
      return
    }
    if (nearBottomRef.current) {
      if (running || grew > 0) scrollToBottom()
    } else if (grew > 0) {
      setUnseen((prev) => prev + grew)
    }
  }, [
    conversation,
    scrollEl,
    items.length,
    tail,
    running,
    conversation.skillsTrust,
    orphanApprovals.length,
    scrollToBottom,
  ])

  // Auto-load the next turn slice as the reader scrolls near the top.
  useEffect(() => {
    if (!scrollEl || hiddenTurns <= 0 || typeof IntersectionObserver === 'undefined') return
    const sentinel = topSentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        if (!initialisedRef.current || nearBottomRef.current || autoLoadInFlightRef.current) return
        autoLoadInFlightRef.current = true
        loadEarlier()
      },
      { root: scrollEl, rootMargin: '200px 0px 0px 0px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [scrollEl, hiddenTurns, loadEarlier])

  // Panel resizes: stay at the bottom if we were there. While a run streams,
  // the rendered answer grows after the text changed (throttled rendering):
  // a reader following the bottom stays there; only their own scroll stops
  // it. Content that grows without a run (e.g. a diagram rendered, a tool row
  // expanded) only updates the state.
  useEffect(() => {
    const scroller = scrollEl
    const list = listRef.current
    if (!scroller || !list) return
    const containerObserver = new ResizeObserver(() => {
      if (nearBottomRef.current) scrollToBottom()
    })
    const listObserver = new ResizeObserver(() => {
      if (nearBottomRef.current && runningRef.current) scrollToBottom()
      else updateNearBottom()
    })
    containerObserver.observe(scroller)
    listObserver.observe(list)
    return () => {
      containerObserver.disconnect()
      listObserver.disconnect()
    }
  }, [scrollEl, scrollToBottom, updateNearBottom])

  function announcementFor(item: TimelineItem): string | null {
    switch (item.kind) {
      case 'approval':
        return item.resolved ? null : t('conversation.approvalRequested', { tool: item.approval.tool })
      case 'question':
        return item.outcome ? null : t('conversation.question', { question: item.question.question })
      case 'run_end': {
        const run = conversation.runs.get(item.runId)
        const label = run?.outcome ? OUTCOME_LABEL[run.outcome] : t('conversation.endOfTheRun')
        const text = run?.finalText?.trim()
        return text
          ? t('conversation.answerFinished', { label, value: truncate(text, 300) })
          : t('conversation.runFinished', { label })
      }
      case 'notice':
        return item.level === 'error' ? item.message : null
      default:
        return null
    }
  }

  // Items appended after the view opened (not the stored history).
  useEffect(() => {
    const from = announcedCountRef.current
    announcedCountRef.current = items.length
    if (from < 0 || items.length <= from) return
    let latest: string | null = null
    for (const item of items.slice(from)) {
      const text = announcementFor(item)
      if (text) latest = text
    }
    if (latest !== null) setAnnouncement(latest)
  }, [conversation, items.length])

  return (
    <div className="@container relative flex h-full min-h-0 flex-1 flex-col overflow-clip">
      {/* The timeline scrolls: keyboard users must be able to focus it (WCAG 2.1.1). */}
      <ScrollArea
        className="min-h-0 flex-1"
        viewportClass="scroll-fade scroll-fade-t-6 scroll-fade-b-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring focus-visible:outline-none"
        viewportRef={handleViewportRef}
        viewportProps={{
          'data-conversation-scroll': '',
          onScroll: updateNearBottom,
          role: 'region',
          'aria-label': t('common.conversation'),
          tabIndex: 0,
        }}
      >
        <div
          ref={listRef}
          role="log"
          aria-live="off"
          aria-label={t('conversation.conversationMessages')}
          className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pt-6 pb-10"
        >
          {hiddenTurns > 0 && (
            <div ref={topSentinelRef} className="flex justify-center">
              <Button
                variant="outline"
                size="icon"
                className="rounded-full bg-background shadow-md"
                aria-label={t('conversation.loadEarlierMessages', { hiddenCount: hiddenTurns })}
                title={t('conversation.loadEarlierMessages', { hiddenCount: hiddenTurns })}
                onClick={loadEarlier}
              >
                <ArrowUpIcon />
              </Button>
            </div>
          )}

          {blocks.map((block, index) => {
            const isUser = block.kind === 'item' && block.item.kind === 'user'
            const isRunningBlock =
              conversation.runningRunId !== null &&
              (block.kind === 'work'
                ? block.runId === conversation.runningRunId
                : block.item.runId === conversation.runningRunId)
            const deferred = index < blocks.length - DEFERRED_TAIL_BLOCKS && !isRunningBlock
            return (
              <div
                key={block.key}
                data-block-key={block.key}
                data-turn={isUser ? block.key : undefined}
                className={cn(
                  'flex flex-col gap-6 empty:hidden',
                  isUser && 'scroll-mt-8',
                  deferred && 'timeline-block-deferred',
                )}
              >
                {block.kind === 'work' ? (
                  <WorkBlock
                    conversation={conversation}
                    runId={block.runId}
                    items={block.items}
                    answerReasoning={block.answerReasoning}
                  />
                ) : (
                  <TimelineEntry item={block.item} conversation={conversation} answer={block.answer} />
                )}
              </div>
            )
          })}

          {orphanApprovals.map((approval) => (
            <ApprovalCard key={approval.approval_id} approval={approval} conversation={conversation} />
          ))}

          {orphanQuestions.map((question) => (
            <QuestionCard key={question.question_id} question={question} conversation={conversation} />
          ))}

          {/* A running run with nothing in the view (it started elsewhere): its bar goes last. */}
          {runningWithoutBlock && conversation.runningRunId && (
            <WorkBlock conversation={conversation} runId={conversation.runningRunId} items={[]} />
          )}

          {conversation.skillsTrust && (
            <SkillsTrustBanner conversation={conversation} trust={conversation.skillsTrust} />
          )}
        </div>
      </ScrollArea>

      <MessageRail marks={marks} scroller={scrollEl} onJumpToTurn={jumpToTurn} />

      {!nearBottom && (
        <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
          <Button
            variant="outline"
            size="icon"
            className="pointer-events-auto relative rounded-full bg-background shadow-md"
            aria-label={
              unseen > 0
                ? `${t('conversation.goToBottom')}, ${t('conversation.newMessages', { count: unseen })}`
                : t('conversation.goToBottom')
            }
            title={t('conversation.goToBottom')}
            onClick={() => scrollToBottom(true)}
          >
            <ArrowDownIcon />
            {unseen > 0 && (
              <span
                className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-brand ring-2 ring-background"
                aria-hidden="true"
              />
            )}
          </Button>
        </div>
      )}

      <p className="sr-only" role="status">
        {announcement}
      </p>
    </div>
  )
}

export default ConversationTimeline
