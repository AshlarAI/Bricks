import { memo } from 'react'
import { useConversation, type Conversation, type TimelineItem } from '$lib/state/conversation'
import UserMessage from './UserMessage'
import AssistantMessage from './AssistantMessage'
import ToolRow from './ToolRow'
import ApprovalCard from './ApprovalCard'
import QuestionCard from './QuestionCard'
import EditRow from './EditRow'
import NoticeLine from './NoticeLine'
import RunEndCard from './RunEndCard'
import ResponseActions from './ResponseActions'
import AgentLine from './AgentLine'

export interface TimelineEntryProps {
  item: TimelineItem
  conversation: Conversation
  answer?: boolean
}

function TimelineEntryComponent({ item, conversation, answer = false }: TimelineEntryProps) {
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null

  /** The response this item ends, when it is complete and has text: its copy action follows the item. */
  const subscribedCopyText = useConversation(liveConversation, (c) => {
    const r = c.responseByAnchor(item.id)
    return r && r.complete && r.copyText.trim() ? r.copyText : null
  })
  const fallbackResponse = !liveConversation ? conversation?.responseByAnchor?.(item.id) : undefined
  const copyText = liveConversation
    ? (subscribedCopyText ?? null)
    : fallbackResponse && fallbackResponse.complete && fallbackResponse.copyText.trim()
      ? fallbackResponse.copyText
      : null

  const subscribedShowEdit = useConversation(liveConversation, (c) =>
    item.kind === 'edit'
      ? (item.agentId ?? null) !== c.ownAgentId ||
        !c.items.some(
          (entry) =>
            entry.kind === 'tool' &&
            entry.toolCallId === item.toolCallId &&
            entry.runId === item.runId,
        )
      : false,
  )
  const showEdit =
    item.kind === 'edit'
      ? liveConversation
        ? (subscribedShowEdit ?? false)
        : (item.agentId ?? null) !== conversation.ownAgentId ||
          !conversation.items.some(
            (entry) =>
              entry.kind === 'tool' &&
              entry.toolCallId === item.toolCallId &&
              entry.runId === item.runId,
          )
      : false

  return (
    <>
      {item.kind === 'user' ? (
        <UserMessage item={item} conversation={conversation} />
      ) : item.kind === 'assistant' ? (
        <AssistantMessage item={item} conversation={conversation} part={answer ? 'answer' : 'all'} />
      ) : item.kind === 'tool' ? (
        <ToolRow item={item} conversation={conversation} />
      ) : item.kind === 'question' ? (
        !item.outcome ? <QuestionCard question={item.question} conversation={conversation} /> : null
      ) : item.kind === 'approval' ? (
        <ApprovalCard
          approval={item.approval}
          resolved={item.resolved}
          conversation={conversation}
        />
      ) : item.kind === 'edit' ? (
        showEdit ? <EditRow item={item} conversation={conversation} /> : null
      ) : item.kind === 'notice' ? (
        <NoticeLine item={item} />
      ) : item.kind === 'run_end' ? (
        <RunEndCard item={item} conversation={conversation} />
      ) : item.kind === 'agent' ? (
        <AgentLine item={item} conversation={conversation} />
      ) : null}

      {copyText && <ResponseActions text={copyText} sessionId={conversation.sessionId} />}
    </>
  )
}

export const TimelineEntry = memo(TimelineEntryComponent)

export default TimelineEntry
