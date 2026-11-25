import { useMemo, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { BrainIcon } from '$lib/components/icons'
import * as Trace from '$lib/components/ui/trace'
import { formatWorked } from '../runend'
import { useConversation, type AssistantItem, type Conversation } from '$lib/state/conversation'
import { webSearchSources } from '../markdown/citations'
import { ui } from '$lib/state/ui'
import { useThrottledValue } from '../throttled'
import { isAbsoluteFilePath } from '../markdown/fileref-parse'
import type { FileReference } from '../markdown/types'
import MarkdownView from '../markdown/MarkdownView'

/**
 * `reasoning`: only the reasoning, among the steps of the run; `answer`: only
 * the text, when it is the run's answer (its reasoning stays with the steps).
 */
export type Part = 'all' | 'reasoning' | 'answer'

export interface AssistantMessageProps {
  item: AssistantItem
  conversation?: Conversation
  part?: Part
}

const EMPTY_OUTPUTS: readonly string[] = []

function sameStrings(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

export function AssistantMessage({ item, conversation, part = 'all' }: AssistantMessageProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const subscribedItem = useConversation(liveConversation, (c) =>
    c.items.find((e): e is AssistantItem => e.kind === 'assistant' && e.id === item.id),
  )
  const currentItem = subscribedItem ?? item

  const subscribedOutputs = useConversation(
    liveConversation,
    (c) =>
      c.items.flatMap((i) =>
        i.kind === 'tool' && i.name === 'WebSearch' && i.output ? [i.output] : [],
      ),
    sameStrings,
  )
  const fallbackOutputs =
    !liveConversation && conversation?.items
      ? conversation.items.flatMap((i) =>
          i.kind === 'tool' && i.name === 'WebSearch' && i.output ? [i.output] : [],
        )
      : EMPTY_OUTPUTS
  const outputs = liveConversation ? (subscribedOutputs ?? EMPTY_OUTPUTS) : fallbackOutputs

  /** What the conversation's web searches returned: the cards of the reply's links show it. */
  const sources = useMemo(() => webSearchSources(outputs), [outputs])

  /** The person's own choice; until then the reasoning is open while it streams. */
  const [reasoningOpen, setReasoningOpen] = useState<boolean | undefined>(undefined)
  /** Error of the last link or file reference that could not be opened; cleared by the next successful open. */
  const [linkError, setLinkError] = useState<string | null>(null)
  // The source is followed at most every 80 ms while the answer streams; the
  // final text is reconciled as soon as the message completes.
  const throttled = useThrottledValue(currentItem.text, currentItem.streaming, 80)

  // The length in front makes the prefixes of two messages never prefixes of
  // each other, so their heading and note ids cannot collide.
  const safeId = currentItem.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const idPrefix = `m${safeId.length}-${safeId}`

  const hasReasoning = part !== 'answer' && currentItem.thinking.trim().length > 0
  const hasText = part !== 'reasoning'
  /** The model is still reasoning: the message streams and no answer text has come yet. */
  const thinkingNow = currentItem.streaming && currentItem.text.trim().length === 0
  /** « Réfléchit » while it lasts, then « A réfléchi pendant 5s » when it was followed live. */
  const thinkingLabel = (() => {
    if (thinkingNow) return t('conversation.thinking')
    const lasted =
      currentItem.thinkingMs !== undefined ? formatWorked(Math.max(1000, currentItem.thinkingMs)) : null
    return lasted ? t('conversation.thoughtFor', { value: lasted }) : t('conversation.thought')
  })()

  function openFile(ref: FileReference) {
    const projectId = conversation?.projectId
    if (!projectId && !isAbsoluteFilePath(ref.path)) {
      setLinkError(t('conversation.thisConversationIsntAttachedToAny'))
      return
    }
    setLinkError(null)
    ui.open('file', {
      projectId: projectId ?? '',
      path: ref.path,
      line: ref.line !== undefined ? String(ref.line) : undefined,
      endLine: ref.endLine !== undefined ? String(ref.endLine) : undefined,
    })
  }

  return (
    <article className="flex min-w-0 flex-col gap-1.5" aria-busy={currentItem.streaming}>
      {hasReasoning && (
        <Trace.Root>
          {/* Open while the model reasons, folded once it answers; the person's own toggle wins. */}
          <Trace.Collapsible open={reasoningOpen ?? thinkingNow} onOpenChange={setReasoningOpen}>
            <Trace.CollapsibleTrigger>
              <Trace.Line status={thinkingNow ? 'running' : undefined}>
                <Trace.Icon>
                  <BrainIcon animating={thinkingNow} />
                </Trace.Icon>
                <Trace.Title>{thinkingLabel}</Trace.Title>
              </Trace.Line>
            </Trace.CollapsibleTrigger>
            <Trace.CollapsibleContent className="text-xs whitespace-pre-wrap">
              {currentItem.thinking}
            </Trace.CollapsibleContent>
          </Trace.Collapsible>
        </Trace.Root>
      )}

      {!hasText ? null : currentItem.text ? (
        <>
          <MarkdownView
            source={currentItem.streaming ? throttled : currentItem.text}
            streaming={currentItem.streaming}
            idPrefix={idPrefix}
            onFile={openFile}
            onLinkResult={setLinkError}
            sources={sources}
          />
          {linkError && (
            <p className="text-xs break-words text-destructive" role="alert">
              {t('conversation.theLinkCouldNotBeOpened', { linkError })}
            </p>
          )}
        </>
      ) : null}
    </article>
  )
}

export default AssistantMessage
