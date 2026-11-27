// The steps of one run under a thin bar. While the run works, the bar reads
// « Travaille depuis 1m 32s » and the steps are shown; folded, the bar names the
// current step. Once the run has ended the bar says how long it worked (or how it
// ended, when it did not succeed) and folds by itself: the answer follows it.
// What asks the person something stays shown folded.
import { memo, useEffect, useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
import { BrainIcon } from '$lib/components/icons'
import { Separator } from '$lib/components/ui/separator'
import { cn } from '$lib/utils'
import {
  useConversation,
  type AssistantItem,
  type Conversation,
  type TimelineItem,
} from '$lib/state/conversation'
import type { RunOutcome } from '$lib/ipc/engine'
import { OUTCOME_LABEL, formatElapsed } from '../format'
import { currentStep, needsAttention } from '../runBlocks'
import { THINKING_ICON } from './toolIcons'
import AssistantMessage from './AssistantMessage'
import TimelineEntry from './TimelineEntry'
import WorkPlanPopover from './WorkPlanPopover'

export interface WorkBlockProps {
  conversation: Conversation
  runId: string
  items: TimelineItem[]
  answerReasoning?: AssistantItem | null
  showPlan?: boolean
}

const TONE: Record<RunOutcome, string> = {
  succeeded: '',
  incomplete: 'text-warning',
  failed: 'text-destructive',
  cancelled: '',
}

function WorkBlockComponent({
  conversation,
  runId,
  items,
  answerReasoning = null,
  showPlan = false,
}: WorkBlockProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const subscribedRunning = useConversation(liveConversation, (c) => c.runningRunId === runId)
  const subscribedOutcome = useConversation(
    liveConversation,
    (c) => c.runs.get(runId)?.outcome ?? null,
  )
  const subscribedWorked = useConversation(
    liveConversation,
    (c) => c.runs.get(runId)?.workedMs ?? null,
  )
  const subscribedPlan = useConversation(liveConversation, (c) => (showPlan ? (c.plan ?? null) : null))

  const running = liveConversation
    ? (subscribedRunning ?? false)
    : conversation?.runningRunId === runId
  const outcome: RunOutcome | null = liveConversation
    ? (subscribedOutcome ?? null)
    : (conversation?.runs?.get(runId)?.outcome ?? null)
  const plan = showPlan
    ? liveConversation
      ? (subscribedPlan ?? null)
      : (conversation?.plan ?? null)
    : null

  const startedAt = conversation?.runs?.get(runId)?.startedAt ?? null
  const workedMs = liveConversation
    ? (subscribedWorked ?? null)
    : (conversation?.runs?.get(runId)?.workedMs ?? null)

  // The clock of the bar: ticks every second while the run works.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [running])

  const hasSteps = items.length > 0 || answerReasoning !== null
  const step = running ? currentStep(items) : null
  const attention = items.filter(needsAttention)

  // Shown while the run works, folded once it ends; the person's own toggle holds until then.
  const [override, setOverride] = useState<{ forRunning: boolean; open: boolean } | null>(null)
  const open = override && override.forRunning === running ? override.open : running

  const ended = outcome ?? 'succeeded'
  const endLabel =
    workedMs === null
      ? OUTCOME_LABEL[ended]
      : ended === 'succeeded'
        ? t('conversation.workedFor', { duration: formatElapsed(workedMs) })
        : t('conversation.endedAfter', { outcome: OUTCOME_LABEL[ended], duration: formatElapsed(workedMs) })

  const bar = running ? (
    <span className="shimmer motion-reduce:shimmer-none">
      {t('conversation.workingFor', {
        duration: formatElapsed(startedAt === null ? 0 : now - startedAt),
      })}
    </span>
  ) : (
    <span className={cn(outcome && TONE[outcome])}>{endLabel}</span>
  )

  const StepIcon = step?.icon

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setOverride({ forRunning: running, open: next })}
      className="flex flex-col gap-2"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {hasSteps ? (
          <CollapsibleTrigger className="group inline-flex shrink-0 items-center gap-1.5 rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {bar}
            <ChevronRightIcon
              className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
        ) : (
          <div className="inline-flex shrink-0 items-center gap-1.5">{bar}</div>
        )}
        {plan && plan.todos.length > 0 && <WorkPlanPopover plan={plan} running={running} />}
        {step && !open && StepIcon && (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
            {StepIcon === THINKING_ICON ? (
              <BrainIcon animating className="size-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <StepIcon className="size-3.5 shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate shimmer motion-reduce:shimmer-none">{step.label}</span>
          </span>
        )}
      </div>
      <Separator decorative />

      {!open &&
        attention.map((item) => (
          <TimelineEntry key={item.id} item={item} conversation={conversation} />
        ))}

      <CollapsibleContent className="flex flex-col gap-2">
        {items.map((item) => (
          <TimelineEntry key={item.id} item={item} conversation={conversation} />
        ))}
        {answerReasoning && (
          <AssistantMessage item={answerReasoning} conversation={conversation} part="reasoning" />
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

function sameItems(a: readonly TimelineItem[], b: readonly TimelineItem[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

function areWorkBlockPropsEqual(prev: WorkBlockProps, next: WorkBlockProps): boolean {
  return (
    prev.conversation === next.conversation &&
    prev.runId === next.runId &&
    prev.answerReasoning === next.answerReasoning &&
    Boolean(prev.showPlan) === Boolean(next.showPlan) &&
    sameItems(prev.items, next.items)
  )
}

export const WorkBlock = memo(WorkBlockComponent, areWorkBlockPropsEqual)

export default WorkBlock
