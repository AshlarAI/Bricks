// The session's plan above the composer, as a trace: one line for the plan
// (its progress), and under it one line per step. While the conversation works,
// the plan and its current step shimmer; steps still to do are dimmed.
import { useState } from 'react'
import { CircleCheckIcon, CircleDotIcon, CircleIcon, ListCheckIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import * as Trace from '$lib/components/ui/trace'
import type { PlanState, PlanStatus } from '$lib/ipc/engine'

export interface PlanPanelProps {
  plan: PlanState
  running?: boolean
}

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

export function PlanPanel({ plan, running = false }: PlanPanelProps) {
  useLanguage()
  const [open, setOpen] = useState(true)

  const done = plan.todos.filter((step) => step.status === 'completed').length
  const working = running && done < plan.todos.length

  return (
    <section
      aria-label={t('conversation.plan')}
      className="rounded-lg border border-border bg-card px-3 py-2 text-card-foreground"
    >
      <Trace.Root>
        <Trace.Collapsible open={open} onOpenChange={setOpen}>
          <Trace.CollapsibleTrigger>
            <Trace.Line status={working ? 'running' : undefined}>
              <Trace.Icon>
                <ListCheckIcon />
              </Trace.Icon>
              <Trace.Title>{t('conversation.plan')}</Trace.Title>
              <Trace.Description aria-label={t('conversation.ofStepsDone', { done, todos: plan.todos.length })}>
                {t('conversation.stepsDone', { done, todos: plan.todos.length })}
              </Trace.Description>
            </Trace.Line>
          </Trace.CollapsibleTrigger>
          <Trace.CollapsibleContent>
            <Trace.Root>
              {plan.todos.map((step, i) => (
                <Trace.Line
                  key={i}
                  status={
                    step.status === 'pending'
                      ? 'pending'
                      : working && step.status === 'in_progress'
                        ? 'running'
                        : undefined
                  }
                >
                  <Trace.Icon>
                    {step.status === 'completed' ? (
                      <CircleCheckIcon />
                    ) : step.status === 'in_progress' ? (
                      <CircleDotIcon />
                    ) : (
                      <CircleIcon />
                    )}
                  </Trace.Icon>
                  <Trace.Title className="whitespace-normal break-words">
                    {step.status === 'in_progress' ? step.activeForm : step.content}
                    <span className="sr-only">({STATUS_LABEL[step.status]})</span>
                  </Trace.Title>
                </Trace.Line>
              ))}
            </Trace.Root>
            {plan.explanation && <p className="mt-2 text-xs break-words">{plan.explanation}</p>}
          </Trace.CollapsibleContent>
        </Trace.Collapsible>
      </Trace.Root>
    </section>
  )
}

export default PlanPanel
