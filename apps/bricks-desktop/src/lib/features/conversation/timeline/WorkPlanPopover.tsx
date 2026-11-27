// Compact plan trigger placed beside the WorkBlock duration bar, opening the
// full plan checklist in a shadcn/ui Popover using Trace primitives.
import { CircleCheckIcon, CircleDotIcon, CircleIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Popover, PopoverContent, PopoverTrigger } from '$lib/components/ui/popover'
import { Trace, TraceIcon, TraceLine, TraceTitle } from '$lib/components/ui/trace'
import type { PlanState, PlanStatus } from '$lib/ipc/engine'
import { cn } from '$lib/utils'

const RING_RADIUS = 6.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

const STATUS_LABEL: Record<PlanStatus, string> = {
  get pending() {
    return t('conversation.toDo')
  },
  get in_progress() {
    return t('conversation.planInProgress')
  },
  get completed() {
    return t('conversation.planCompleted')
  },
}

function StepIcon({ status }: { status: PlanStatus }) {
  if (status === 'completed') return <CircleCheckIcon aria-hidden="true" />
  if (status === 'in_progress') return <CircleDotIcon aria-hidden="true" />
  return <CircleIcon aria-hidden="true" />
}

function PlanRing({ done, total }: { done: number; total: number }) {
  const ratio = total > 0 ? Math.min(1, Math.max(0, done / total)) : 0
  const dash = ratio * RING_CIRCUMFERENCE

  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0 -rotate-90" aria-hidden="true">
      <circle
        cx="8"
        cy="8"
        r={RING_RADIUS}
        fill="none"
        strokeWidth="2.2"
        style={{ stroke: 'color-mix(in oklab, var(--muted-foreground) 32%, transparent)' }}
      />
      {dash > 0 ? (
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${RING_CIRCUMFERENCE}`}
          style={{ stroke: 'var(--muted-foreground)' }}
        />
      ) : (
        <circle cx="14.5" cy="8" r="1.1" fill="var(--muted-foreground)" />
      )}
    </svg>
  )
}

export interface WorkPlanPopoverProps {
  plan: PlanState
  running?: boolean
}

export function WorkPlanPopover({ plan, running = false }: WorkPlanPopoverProps) {
  useLanguage()
  const total = plan.todos.length
  if (total === 0) return null

  const done = plan.todos.filter((step) => step.status === 'completed').length
  const working = running && done < total

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="work-plan-trigger"
          aria-label={`${t('conversation.plan')}: ${t('conversation.ofStepsDone', { done, todos: total })}`}
          className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlanRing done={done} total={total} />
          <span
            className={cn(
              'truncate tabular-nums',
              working && 'shimmer motion-reduce:shimmer-none',
            )}
          >
            {t('conversation.planSteps', { done, todos: total })}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={6}
        data-slot="work-plan-popover"
        className="w-80 max-w-[calc(100vw-2rem)] rounded-xl border bg-popover p-3 text-popover-foreground shadow-float"
      >
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium text-foreground">{t('conversation.plan')}</span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {t('conversation.stepsDone', { done, todos: total })}
          </span>
        </div>
        <Trace>
          {plan.todos.map((step, index) => (
            <TraceLine
              key={index}
              status={
                step.status === 'pending'
                  ? 'pending'
                  : working && step.status === 'in_progress'
                    ? 'running'
                    : undefined
              }
            >
              <TraceIcon>
                <StepIcon status={step.status} />
              </TraceIcon>
              <TraceTitle className="whitespace-normal break-words">
                <span className="sr-only">{`${STATUS_LABEL[step.status]}: `}</span>
                {step.status === 'in_progress' ? (step.activeForm || step.content) : step.content}
              </TraceTitle>
            </TraceLine>
          ))}
        </Trace>
        {plan.explanation && (
          <p className="mt-2 border-t border-border pt-2 text-xs break-words text-muted-foreground">
            {plan.explanation}
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default WorkPlanPopover
