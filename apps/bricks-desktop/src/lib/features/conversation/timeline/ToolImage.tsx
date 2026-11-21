// The image a tool call showed the model (`Read` of an image, or `ViewImage` in former
// conversations): the bytes it received, read from the session's history. The round's
// message is written once all its calls end, so the image is asked for again as the
// timeline grows, until found.
import { useEffect, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { sessionToolImage } from '$lib/ipc/client'
import { useConversation, type Conversation, type ToolItem } from '$lib/state/conversation'
import { basename, formatToolName, isRecord, summarizeInput } from '../format'

export interface ToolImageProps {
  item: ToolItem
  conversation: Conversation
}

export function ToolImage({ item, conversation }: ToolImageProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const subscribedLength = useConversation(liveConversation, (c) => c.items.length)
  const itemsLength = liveConversation ? (subscribedLength ?? 0) : (conversation?.items?.length ?? 0)

  const key = `${conversation.sessionId}:${item.toolCallId}`
  const [loaded, setLoaded] = useState<{ key: string; url: string } | null>(null)
  const src = loaded?.key === key ? loaded.url : null

  const path =
    isRecord(item.input) && typeof item.input.file_path === 'string' ? item.input.file_path : ''
  const label = (() => {
    if (path) return basename(path)
    if (item.name.startsWith('mcp__')) {
      const toolLabel = formatToolName(item.name)
      const target = summarizeInput(item.name, item.input)
      return target ? `${toolLabel} · ${target}` : toolLabel
    }
    return t('conversation.imageSeenByTheModel')
  })()
  const titleText = path || label

  useEffect(() => {
    if (src) return
    const sessionId = conversation.sessionId
    const callId = item.toolCallId
    let current = true
    sessionToolImage(sessionId, callId)
      .then((url) => {
        if (current && url) setLoaded({ key, url })
      })
      .catch(() => {})
    return () => {
      current = false
    }
  }, [src, key, itemsLength, conversation.sessionId, item.toolCallId])

  if (!src) return null

  return (
    <img
      src={src}
      alt={label}
      title={titleText}
      className="mt-1 ml-5 max-h-64 max-w-[min(100%,28rem)] rounded-md border border-border object-contain"
    />
  )
}

export default ToolImage
