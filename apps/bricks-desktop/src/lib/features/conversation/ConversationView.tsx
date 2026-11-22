import { useConversation, type Conversation } from '$lib/state/conversation'
import ConversationTimeline from './ConversationTimeline'
import PlanPanel from './PlanPanel'

export interface ConversationViewProps {
  conversation: Conversation
}

export function ConversationView({ conversation }: ConversationViewProps) {
  const plan = useConversation(conversation, (c) => c.plan) ?? null
  const running = useConversation(conversation, (c) => c.running) ?? false

  return (
    <div className="flex h-full min-h-0 flex-col overflow-clip">
      <ConversationTimeline conversation={conversation} />
      {plan && plan.todos.length > 0 && (
        <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-2">
          <PlanPanel plan={plan} running={running} />
        </div>
      )}
    </div>
  )
}

export default ConversationView
