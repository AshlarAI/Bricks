import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDownIcon } from 'lucide-react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Button } from '$lib/components/ui/button'
import { t, useLanguage } from '$lib/i18n/i18n'
import { useConversation, type Conversation, type TimelineItem } from '$lib/state/conversation'
import { OUTCOME_LABEL, truncate } from './format'
import ApprovalCard from './timeline/ApprovalCard'
import QuestionCard from './timeline/QuestionCard'
import SkillsTrustBanner from './timeline/SkillsTrustBanner'
import TimelineEntry from './timeline/TimelineEntry'
import WorkBlock from './timeline/WorkBlock'
import MessageRail from './MessageRail'
import { timelineBlocks } from './runBlocks'

export interface ConversationTimelineProps {
  conversation: Conversation
}

/** Items rendered at once; earlier ones load on request (keeps long conversations light). */
const WINDOW = 120
const NEAR_BOTTOM_PX = 80

export function ConversationTimeline({ conversation }: ConversationTimelineProps) {
  useLanguage()
  useConversation(conversation)

  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const [nearBottom, setNearBottom] = useState(true)
  const nearBottomRef = useRef(true)
  /** Items that arrived while the user was scrolled up. */
  const [unseen, setUnseen] = useState(0)
  const [limit, setLimit] = useState(WINDOW)
  /** Text of the polite live region: completed messages and attention needs only. */
  const [announcement, setAnnouncement] = useState('')

  const handleViewportRef = useCallback((el: HTMLDivElement | null) => {
    scrollRef.current = el
    setScrollEl(el)
  }, [])

  const items = conversation.items
  const running = conversation.running
  const runningRef = useRef(running)
  runningRef.current = running

  const hiddenCount = Math.max(0, items.length - limit)
  const visible = hiddenCount > 0 ? items.slice(hiddenCount) : items
  const blocks = timelineBlocks(visible, items, conversation.runs, conversation.runningRunId)

  /** The place of each message sent in the whole conversation, and how many there are. */
  const userOrder = new Map<string, number>()
  for (const item of items) {
    if (item.kind === 'user') userOrder.set(item.id, userOrder.size + 1)
  }

  /** The answer of each ended run: its last message with text, found in one pass from the end. */
  const lastAnswers = new Map<string, string>()
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]
    if (item.kind === 'assistant' && item.runId && !lastAnswers.has(item.runId) && item.text.trim()) {
      lastAnswers.set(item.runId, item.text)
    }
  }

  /** One grain per message sent, among the rendered ones: the message, its answer, its time. */
  const marks = blocks.flatMap((block) => {
    if (block.kind !== 'item' || block.item.kind !== 'user') return []
    const item = block.item
    const run = item.runId ? conversation.runs.get(item.runId) : undefined
    const ended = item.runId !== undefined && item.runId !== conversation.runningRunId
    const answer = ended ? (run?.finalText ?? lastAnswers.get(item.runId!) ?? '') : ''
    return [
      {
        key: block.key,
        label: truncate(item.text.trim() || t('conversation.message'), 80),
        answer: truncate(answer.trim(), 400),
        at: item.at ?? run?.startedAt ?? null,
        place: userOrder.get(item.id) ?? 0,
        total: userOrder.size,
      },
    ]
  })

  /** The run at work has no block when none of its items is in the view (it started elsewhere). */
  const runningWithoutBlock =
    conversation.runningRunId !== null &&
    !blocks.some((block) => block.kind === 'work' && block.runId === conversation.runningRunId)

  /** Waiting approvals with no card in the timeline (e.g. after a reload). */
  const orphanApprovals = conversation.pendingApprovals.filter(
    (approval) => !items.some((item) => item.kind === 'approval' && item.approval.approval_id === approval.approval_id),
  )

  /** Waiting questions with no card in the timeline (e.g. after a reload). */
  const orphanQuestions = conversation.pendingQuestions.filter(
    (question) => !items.some((item) => item.kind === 'question' && item.question.question_id === question.question_id),
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

  const pendingScrollAdjustRef = useRef<number | null>(null)
  function loadEarlier() {
    const el = scrollRef.current
    pendingScrollAdjustRef.current = el ? el.scrollHeight : null
    setLimit((prev) => prev + WINDOW)
  }

  useLayoutEffect(() => {
    const before = pendingScrollAdjustRef.current
    if (before === null) return
    pendingScrollAdjustRef.current = null
    // Keep the reader on the same message when older ones are added above.
    const el = scrollRef.current
    if (el) el.scrollTop += el.scrollHeight - before
  }, [limit])

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
    <div className="@container relative flex h-full min-h-0 flex-1 flex-col">
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
          {hiddenCount > 0 && (
            <div className="flex justify-center">
              <Button variant="ghost" size="sm" onClick={loadEarlier}>
                {t('conversation.loadEarlierMessages', { hiddenCount })}
              </Button>
            </div>
          )}

          {blocks.map((block) => {
            if (block.kind === 'work') {
              return (
                <WorkBlock
                  key={block.key}
                  conversation={conversation}
                  runId={block.runId}
                  items={block.items}
                  answerReasoning={block.answerReasoning}
                />
              )
            }
            if (block.item.kind === 'user') {
              return (
                <div key={block.key} data-turn={block.key} className="scroll-mt-8">
                  <TimelineEntry item={block.item} conversation={conversation} answer={block.answer} />
                </div>
              )
            }
            return (
              <TimelineEntry key={block.key} item={block.item} conversation={conversation} answer={block.answer} />
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

      <MessageRail marks={marks} scroller={scrollEl} />

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
