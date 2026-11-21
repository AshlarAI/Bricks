// A sub-agent's branch, in the centre: its work read like the main conversation
// (same timeline), live while it runs, and nothing to write to it. The title bar
// leads back to the conversation.
import { useEffect, useRef } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import ConversationTimeline from '$lib/features/conversation/ConversationTimeline'
import { useConversation, type AgentInfo, type Conversation } from '$lib/state/conversation'
import { agentBranch, applyAgentSteps } from './branch'

export interface AgentBranchProps {
  conversation: Conversation
  agent: AgentInfo
}

export function AgentBranch({ conversation, agent }: AgentBranchProps) {
  useLanguage()
  const liveAgent = useConversation(conversation, (c) => c.agents.get(agent.id)) ?? agent

  // Built once (the view is keyed by the agent), then fed the steps as they
  // arrive: the timeline keeps its items, its scroll and what was unfolded.
  const branchRef = useRef<{ agentId: string; branch: Conversation; applied: number } | null>(null)
  if (!branchRef.current || branchRef.current.agentId !== liveAgent.id) {
    branchRef.current = {
      agentId: liveAgent.id,
      branch: agentBranch(conversation, liveAgent),
      applied: liveAgent.log.length,
    }
  }
  const branch = branchRef.current.branch

  useEffect(() => {
    const state = branchRef.current
    if (!state || state.agentId !== liveAgent.id) return
    if (liveAgent.log.length <= state.applied) return
    applyAgentSteps(state.branch, liveAgent, state.applied)
    state.applied = liveAgent.log.length
  }, [liveAgent, liveAgent.log.length])

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
        <ConversationTimeline conversation={branch} />
      </div>
      <section aria-label={t('common.messageInput')} className="shrink-0 px-4 pt-1 pb-3">
        <p className="mx-auto mt-1 max-w-3xl rounded-2xl border bg-card px-4 py-3.5 text-ui text-muted-foreground shadow-float">
          {t('agents.youCantWriteToASub')}
        </p>
      </section>
    </>
  )
}

export default AgentBranch
