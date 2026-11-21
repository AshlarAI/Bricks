// One sub-agent in the thread, as a task: its state and description on the
// line, its steps folded under it (open while it works), and a last line that
// opens its tab. No model, reasoning, counts, cost or time here.
import { useState } from 'react'
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleSlashIcon,
  LoaderCircleIcon,
  SquareArrowOutUpRightIcon,
} from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import * as Trace from '$lib/components/ui/trace'
import { useConversation, type AgentItem, type Conversation } from '$lib/state/conversation'
import { ui } from '$lib/state/ui'
import { agentStateView, isLive } from '$lib/features/agents/agentView'
import { toolLineState, toolTitle } from './toolLine'

export interface AgentLineProps {
  item: AgentItem
  conversation: Conversation
}

/** Steps shown under the line; the tab has all of them. */
const MAX_STEPS = 8

export function AgentLine({ item, conversation }: AgentLineProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const subscribedAgent =
    useConversation(liveConversation, (c) => c.agents.get(item.agentId) ?? null) ?? null
  const subscribedAwaitingApproval =
    useConversation(liveConversation, (c) =>
      c.items.some(
        (i) => i.kind === 'approval' && !i.resolved && i.approval.agent_id === item.agentId,
      ),
    ) ?? false

  const agent = liveConversation
    ? subscribedAgent
    : (conversation?.agents?.get(item.agentId) ?? null)
  const awaitingApproval = liveConversation
    ? subscribedAwaitingApproval
    : (conversation?.items?.some(
        (i) => i.kind === 'approval' && !i.resolved && i.approval.agent_id === item.agentId,
      ) ?? false)

  // Follows the agent until the person folds or opens it.
  const [chosen, setChosen] = useState<boolean | null>(null)

  const live = agent ? isLive(agent.state) : false
  const view = agent ? agentStateView(agent.state) : null
  const description = agent ? agent.spawn.description || agent.spawn.task : ''
  /** A resumed agent shows its current execution once, where it was resumed. */
  const stale = agent !== null && item.execution !== agent.execution
  const ended = agent !== null && !live
  const interrupted = agent?.state === 'cancelled' || agent?.state === 'interrupted'
  const dot = stale ? 'idle' : awaitingApproval ? 'waiting' : (view?.dot ?? 'idle')
  const status = stale
    ? undefined
    : dot === 'running'
      ? 'running'
      : dot === 'error'
        ? 'error'
        : dot === 'waiting' && !ended
          ? 'pending'
          : undefined
  const stateLabel = stale
    ? t('conversation.previousRunResumedFurtherOn')
    : awaitingApproval
      ? t('common.waitingForApproval')
      : (view?.label ?? '')
  const steps =
    agent && !stale
      ? agent.tools.map((call) => {
          const callState = toolLineState(call, ended && interrupted)
          return {
            id: call.toolCallId,
            title: toolTitle(call.name, call.input, callState),
            status:
              callState === 'running'
                ? ('running' as const)
                : callState === 'failed'
                  ? ('error' as const)
                  : undefined,
          }
        })
      : []
  const earlier = Math.max(0, steps.length - MAX_STEPS)
  const shown = steps.slice(earlier)
  const open = chosen ?? (live && !stale)

  if (!agent || !view) return null

  const stateIcon =
    dot === 'running' ? (
      <LoaderCircleIcon className="animate-spin motion-reduce:animate-none" />
    ) : dot === 'error' ? (
      <CircleAlertIcon />
    ) : dot === 'success' ? (
      <CircleCheckIcon />
    ) : dot === 'cancelled' ? (
      <CircleSlashIcon />
    ) : (
      <CircleDashedIcon />
    )

  return (
    <Trace.Collapsible open={open} onOpenChange={setChosen}>
      <Trace.CollapsibleTrigger
        aria-label={t('conversation.subAgent', { profile: agent.spawn.profile, description })}
      >
        <Trace.Line status={status}>
          <Trace.Icon title={stateLabel}>{stateIcon}</Trace.Icon>
          <span className="shrink-0 font-mono text-foreground">{agent.spawn.profile}</span>
          <Trace.Title>{description}</Trace.Title>
          <span className="sr-only">{stateLabel}</span>
        </Trace.Line>
      </Trace.CollapsibleTrigger>
      <Trace.CollapsibleContent>
        <Trace.Root>
          {earlier > 0 && (
            <Trace.Line status="pending">
              <Trace.Title>{t('agents.earlierSteps', { count: earlier })}</Trace.Title>
            </Trace.Line>
          )}
          {shown.map((step) => (
            <Trace.Line key={step.id} status={step.status}>
              <Trace.Title>{step.title}</Trace.Title>
            </Trace.Line>
          ))}
          <button type="button" onClick={() => ui.openAgent(agent.id)}>
            <Trace.Line>
              <Trace.Icon>
                <SquareArrowOutUpRightIcon />
              </Trace.Icon>
              <Trace.Title>{t('agents.openTab')}</Trace.Title>
            </Trace.Line>
          </button>
        </Trace.Root>
      </Trace.CollapsibleContent>
    </Trace.Collapsible>
  )
}

export default AgentLine
