import { type Conversation } from '$lib/state/conversation'
import ConversationTimeline from './ConversationTimeline'

export interface ConversationViewProps {
  conversation: Conversation
}

export function ConversationView({ conversation }: ConversationViewProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-clip">
      <ConversationTimeline conversation={conversation} />
    </div>
  )
}

export default ConversationView
