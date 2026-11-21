// The steps of one run under a thin bar. While the run works, the bar reads
// « Travaille… » and the steps are shown; folded, the bar names the current
// step. Once the run has ended the bar says how it ended and folds by itself:
// the answer follows it. What asks the person something stays shown folded.
import { useState } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
import { Separator } from '$lib/components/ui/separator'
import {
  useConversation,
  type AssistantItem,
  type Conversation,
  type TimelineItem,
} from '$lib/state/conversation'
import type { RunOutcome } from '$lib/ipc/engine'
import { OUTCOME_LABEL } from '../format'
import { currentStep, needsAttention } from '../runBlocks'
import AssistantMessage from './AssistantMessage'
import TimelineEntry from './TimelineEntry'

export interface WorkBlockProps {
  conversation: Conversation
  runId: string
  items: TimelineItem[]
  answerReasoning?: AssistantItem | null
}

const TONE: Record<RunOutcome, string> = {
  succeeded: '',
  incomplete: 'text-warning',
  failed: 'text-destructive',
  cancelled: '',
}

export function WorkBlock({
  conversation,
  runId,
  items,
  answerReasoning = null,
}: WorkBlockProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const subscribedRunning = useConversation(liveConversation, (c) => c.runningRunId === runId)
  const subscribedOutcome = useConversation(
    liveConversation,
    (c) => c.runs.get(runId)?.outcome ?? null,
  )

  const running = liveConversation
    ? (subscribedRunning ?? false)
    : conversation?.runningRunId === runId
  const outcome: RunOutcome | null = liveConversation
    ? (subscribedOutcome ?? null)
    : (conversation?.runs?.get(runId)?.outcome ?? null)

  const hasSteps = items.length > 0 || answerReasoning !== null
  const step = running ? currentStep(items) : null
  const attention = items.filter(needsAttention)

  // Shown while the run works, folded once it ends; the person's own toggle holds until then.
  const [override, setOverride] = useState<{ forRunning: boolean; open: boolean } | null>(null)
  const open = override && override.forRunning === running ? override.open : running

  const bar = running ? (
    <span className="shimmer motion-reduce:shimmer-none">{t('conversation.working')}</span>
  ) : (
    <span className={outcome ? TONE[outcome] : ''}>{OUTCOME_LABEL[outcome ?? 'succeeded']}</span>
  )

  const StepIcon = step?.icon

  return (
    <Collapsible
      open={open}
      onOpenChange={(next) => setOverride({ forRunning: running, open: next })}
      className="flex flex-col gap-2"
    >
      <div className="flex min-w-0 items-center gap-3 text-ui text-muted-foreground">
        {hasSteps ? (
          <CollapsibleTrigger className="group inline-flex shrink-0 items-center gap-1.5 rounded-md hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            {bar}
            <ChevronRightIcon
              className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
              aria-hidden="true"
            />
          </CollapsibleTrigger>
        ) : (
          <p className="inline-flex shrink-0 items-center gap-1.5">{bar}</p>
        )}
        {step && !open && StepIcon && (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-xs">
            <StepIcon className="size-3.5 shrink-0" aria-hidden="true" />
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

export default WorkBlock
