// One sub-agent in the thread, on a single line: BotIcon, « Agent », profile,
// description and the chevron that opens its branch tab. No sub-agent steps
// or output are shown in the main conversation.
import { ChevronRightIcon } from 'lucide-react'
import { BotIcon, useIconHover, type BotIconHandle } from '$lib/components/icons'
import { t, useLanguage } from '$lib/i18n/i18n'
import * as Trace from '$lib/components/ui/trace'
import { useConversation, type AgentItem, type Conversation } from '$lib/state/conversation'
import { ui } from '$lib/state/ui'
import { agentStateView, isLive } from '$lib/features/agents/agentView'

export interface AgentLineProps {
  item: AgentItem
  conversation: Conversation
}

export function AgentLine({ item, conversation }: AgentLineProps) {
  useLanguage()
  const botHover = useIconHover<BotIconHandle>()
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

  const live = agent ? isLive(agent.state) : false
  const view = agent ? agentStateView(agent.state) : null
  const description = agent ? agent.spawn.description || agent.spawn.task : ''
  /** A resumed agent shows its current execution once, where it was resumed. */
  const stale = agent !== null && item.execution !== agent.execution
  const ended = agent !== null && !live
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

  if (!agent || !view) return null

  return (
    <button
      type="button"
      className="group/agent flex w-fit max-w-full min-w-0 cursor-pointer items-center rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      aria-label={t('conversation.subAgent', { profile: agent.spawn.profile, description })}
      onMouseEnter={botHover.onMouseEnter}
      onMouseLeave={botHover.onMouseLeave}
      onClick={() => ui.openAgent(agent.id)}
    >
      <Trace.Line status={status}>
        <Trace.Icon title={stateLabel}>
          <BotIcon ref={botHover.ref} animating={live && !stale} aria-hidden="true" />
        </Trace.Icon>
        <span className="shrink-0">{t('common.agent2')}</span>
        <span className="shrink-0 font-mono text-foreground">{agent.spawn.profile}</span>
        <Trace.Title>{description}</Trace.Title>
        <Trace.Icon className="-ml-1">
          <ChevronRightIcon />
        </Trace.Icon>
        <span className="sr-only">{stateLabel}</span>
      </Trace.Line>
    </button>
  )
}

export default AgentLine
