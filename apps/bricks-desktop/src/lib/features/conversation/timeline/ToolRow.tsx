// One tool call as a trace line: what it does (« Exécute cargo test ») or did
// (« A exécuté cargo test »), its tool icon, and its output folded under it.
// The files it changed stay shown under the line.
import { useState } from 'react'
import * as CodeBlock from '$lib/components/ui/code-block'
import { Dotm3x3_20 } from '$lib/components/ui/dotm-3x3-20'
import * as Trace from '$lib/components/ui/trace'
import { useLanguage } from '$lib/i18n/i18n'
import {
  useConversation,
  type Conversation,
  type EditItem,
  type QuestionItem,
  type ToolItem,
} from '$lib/state/conversation'
import { formatToolName, summarizeInput } from '../format'
import EditRow from './EditRow'
import ToolImage from './ToolImage'
import { TOOL_LINE_LABEL, toolLineState, toolTitle } from './toolLine'
import { toolIcon } from './toolIcons'

export interface ToolRowProps {
  item: ToolItem
  conversation: Conversation
}

/** Lines of output shown at most; the rest stays in the reader and the context. */
const MAX_LINES = 400
// An image the call showed the model: `Read` of an image (its result names it, after the
// report header a reopened history keeps), `ViewImage` in former conversations, or an MCP
// tool result whose rendered text includes `[image image/<type>, <bytes> bytes]`.
const READ_IMAGE = /^(?:[^\n]*\[Read\][^\n]*\n)?Image .+: image\/(?:png|jpeg|gif|webp)/
const MCP_IMAGE = /\[image image\/(?:png|jpeg|gif|webp), \d+ bytes\]/

const EMPTY_EDITS: readonly EditItem[] = []
const EMPTY_QUESTIONS: readonly QuestionItem[] = []

function sameArray<T>(a: readonly T[], b: readonly T[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (!Object.is(a[i], b[i])) return false
  }
  return true
}

export function ToolRow({ item, conversation }: ToolRowProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null

  const subscribedItem = useConversation(liveConversation, (c) =>
    c.items.find((entry): entry is ToolItem => entry.kind === 'tool' && entry.id === item.id),
  )
  const currentItem = subscribedItem ?? item

  /** The run that made the call was cancelled: its unfinished calls are interruptions. */
  const subscribedInterrupted = useConversation(
    liveConversation,
    (c) => c.run(currentItem.runId)?.outcome === 'cancelled',
  )
  const interrupted = liveConversation
    ? (subscribedInterrupted ?? false)
    : (conversation?.run?.(currentItem.runId)?.outcome === 'cancelled')

  const subscribedEdits = useConversation(
    liveConversation,
    (c) =>
      c.items.filter(
        (entry): entry is EditItem =>
          entry.kind === 'edit' &&
          entry.toolCallId === currentItem.toolCallId &&
          entry.runId === currentItem.runId &&
          (entry.agentId ?? null) === c.ownAgentId,
      ),
    sameArray,
  )
  const edits = liveConversation
    ? (subscribedEdits ?? EMPTY_EDITS)
    : (conversation?.items?.filter(
        (entry): entry is EditItem =>
          entry.kind === 'edit' &&
          entry.toolCallId === currentItem.toolCallId &&
          entry.runId === currentItem.runId &&
          (entry.agentId ?? null) === conversation.ownAgentId,
      ) ?? EMPTY_EDITS)

  /** The questions of an `Ask` call: once all are closed, the line counts the answers. */
  const subscribedQuestions = useConversation(
    liveConversation,
    (c) =>
      currentItem.name === 'Ask'
        ? c.items.filter(
            (entry): entry is QuestionItem =>
              entry.kind === 'question' && entry.question.tool_call_id === currentItem.toolCallId,
          )
        : EMPTY_QUESTIONS,
    sameArray,
  )
  const questions = liveConversation
    ? (subscribedQuestions ?? EMPTY_QUESTIONS)
    : currentItem.name === 'Ask'
      ? (conversation?.items?.filter(
          (entry): entry is QuestionItem =>
            entry.kind === 'question' && entry.question.tool_call_id === currentItem.toolCallId,
        ) ?? EMPTY_QUESTIONS)
      : EMPTY_QUESTIONS

  // Folded until the person opens it.
  const [open, setOpen] = useState(false)

  const closed = questions.length > 0 && questions.every((q) => q.outcome)
  const answered = questions.filter(
    (q) => q.outcome?.state === 'chosen' || q.outcome?.state === 'other',
  ).length
  /** A question closed by a cancelled run: the call failed. */
  const cancelled = questions.some(
    (q) => q.outcome?.state === 'skipped' && q.outcome.reason === 'cancelled',
  )
  const lineState = cancelled ? 'failed' : toolLineState(currentItem, interrupted)
  const status =
    lineState === 'running' ? 'running' : lineState === 'failed' ? 'error' : undefined
  const Icon = toolIcon(currentItem.name)
  const title = toolTitle(currentItem.name, currentItem.input, lineState)
  const showsImage =
    currentItem.status === 'ok' &&
    (currentItem.name === 'ViewImage' ||
      (currentItem.name === 'Read' && READ_IMAGE.test(currentItem.output ?? '')) ||
      (currentItem.name.startsWith('mcp__') && MCP_IMAGE.test(currentItem.output ?? '')))
  const computerUseHint = currentItem.name.startsWith('mcp__computer-use__')
    ? summarizeInput(currentItem.name, currentItem.input)
    : ''
  const rawOutput = (currentItem.output ?? '').replace(/\n+$/, '')
  const output = (() => {
    if (currentItem.name === 'Agent' || !rawOutput.trim() || showsImage) return ''
    const lines = rawOutput.split('\n')
    return lines.length > MAX_LINES ? `${lines.slice(0, MAX_LINES).join('\n')}\n…` : rawOutput
  })()

  const line = (
    <Trace.Line status={status}>
      <Trace.Icon>
        <Icon />
      </Trace.Icon>
      <Trace.Title
        title={formatToolName(currentItem.name) !== currentItem.name ? currentItem.name : undefined}
      >
        {title}
      </Trace.Title>
      {computerUseHint && <span className="min-w-0 truncate">{computerUseHint}</span>}
      {lineState === 'running' && (
        <Dotm3x3_20 dotSize={2.5} cellPadding={1} ariaLabel="" className="shrink-0 text-info" />
      )}
      {closed && (
        <Trace.Description>
          {answered}/{questions.length}
        </Trace.Description>
      )}
      {lineState === 'failed' || lineState === 'interrupted' ? (
        <Trace.Description>{TOOL_LINE_LABEL[lineState]}</Trace.Description>
      ) : (
        <span className="sr-only">{TOOL_LINE_LABEL[lineState]}</span>
      )}
    </Trace.Line>
  )

  return (
    <>
      <div className="flex min-w-0 flex-col gap-1">
        {output ? (
          <Trace.Collapsible open={open} onOpenChange={setOpen}>
            <Trace.CollapsibleTrigger>{line}</Trace.CollapsibleTrigger>
            <Trace.CollapsibleContent>
              <CodeBlock.Root
                size="sm"
                variant={lineState === 'failed' ? 'destructive' : 'default'}
              >
                <CodeBlock.Content wrap className="max-h-64" code={output} />
              </CodeBlock.Root>
            </Trace.CollapsibleContent>
          </Trace.Collapsible>
        ) : (
          <div className="flex min-w-0">{line}</div>
        )}
        {edits.length > 0 && (
          <div className="flex min-w-0 flex-col gap-0.5 pl-6">
            {edits.map((edit) => (
              <EditRow key={edit.id} item={edit} conversation={conversation} />
            ))}
          </div>
        )}
      </div>
      {showsImage && <ToolImage item={currentItem} conversation={conversation} />}
    </>
  )
}

export default ToolRow
