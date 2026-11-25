import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { CheckIcon, PencilIcon } from 'lucide-react'
import { CopyIcon, useIconHover, type CopyIconHandle } from '$lib/components/icons'
import { t, useLanguage } from '$lib/i18n/i18n'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { Button } from '$lib/components/ui/button'
import { Textarea } from '$lib/components/ui/textarea'
import * as Attachment from '$lib/components/ui/attachment'
import * as Bubble from '$lib/components/ui/bubble'
import * as Message from '$lib/components/ui/message'
import { TooltipProvider } from '$lib/components/ui/tooltip'
import MessageAction from './MessageAction'
import { app } from '$lib/state/app'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useConversation, type Conversation, type UserItem } from '$lib/state/conversation'
import type { AttachmentInfo } from '$lib/ipc/engine'
import { attachmentPreview } from '$lib/ipc/client'
import { attachmentKind, basename, formatBytes } from '../format'
import { isOpenableUrl, messageParts } from '../links'

export interface UserMessageProps {
  item: UserItem
  conversation?: Conversation | null
}

/** A copy kept by the desktop: `<id>-<name>` in the conversation's folder. */
const COPY = /^([0-9a-f]{32})-(.+)$/

function copyId(a: AttachmentInfo): string | null {
  return a.attachment_id ?? COPY.exec(basename(a.path))?.[1] ?? null
}

function shownName(a: AttachmentInfo): string {
  const name = basename(a.path)
  return COPY.exec(name)?.[2] ?? name
}

export function UserMessage({ item, conversation = null }: UserMessageProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const subscribedRunning = useConversation(liveConversation, (c) => c.running)
  const subscribedReadOnly = useConversation(liveConversation, (c) => c.readOnly)

  const running = liveConversation ? (subscribedRunning ?? false) : (conversation?.running ?? false)
  const readOnly = liveConversation
    ? (subscribedReadOnly ?? false)
    : (conversation?.readOnly ?? false)

  // Previews of the images, read from the conversation's copies.
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const copyHover = useIconHover<CopyIconHandle>()
  const requestedRef = useRef(new Set<string>())
  const sessionId = conversation?.sessionId

  useEffect(() => {
    if (!sessionId) return
    let cancelled = false
    for (const a of item.attachments) {
      const id = a.kind === 'image' ? copyId(a) : null
      const cacheKey = id ? `${sessionId}:${id}` : null
      if (!id || !cacheKey || requestedRef.current.has(cacheKey)) continue
      requestedRef.current.add(cacheKey)
      attachmentPreview('session', sessionId, id)
        .then((p) => {
          const url = p.data_url
          if (!cancelled && url) {
            setPreviews((prev) => (prev[id] ? prev : { ...prev, [id]: url }))
          }
        })
        .catch(() => {
          requestedRef.current.delete(cacheKey)
        })
    }
    return () => {
      cancelled = true
    }
  }, [sessionId, item.attachments])

  // The text is plain: its web addresses are link parts, rendered as markup.
  const parts = messageParts(item.text)
  /** Error of the last link that could not be opened; cleared by the next successful open. */
  const [linkError, setLinkError] = useState<string | null>(null)

  // « Copier »: the message's own text.
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(item.text)
      setCopyError(null)
      setCopied(true)
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setCopied(false)
      setCopyError(e instanceof Error ? e.message : String(e))
    }
  }

  // « Modifier »: the text in a field, saved by replacing this turn and running again.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const restoreFocusRef = useRef(false)

  useEffect(() => {
    if (editing) {
      const element = textareaRef.current
      if (!element) return
      element.focus()
      element.setSelectionRange(element.value.length, element.value.length)
    } else if (restoreFocusRef.current) {
      restoreFocusRef.current = false
      editButtonRef.current?.focus()
    }
  }, [editing])

  const canSave = !saving && !running && (draft.trim() !== '' || item.attachments.length > 0)

  function startEdit() {
    setDraft(item.text)
    setEditError(null)
    setEditing(true)
  }

  function cancelEdit() {
    restoreFocusRef.current = true
    setEditing(false)
    setEditError(null)
  }

  async function save() {
    if (!conversation || !canSave) return
    setSaving(true)
    const error = await app.reviseMessage(conversation, item, draft)
    setSaving(false)
    if (error) {
      setEditError(error)
      return
    }
    setEditing(false)
  }

  function onEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancelEdit()
    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void save()
    }
  }

  function openLink(event: MouseEvent<HTMLAnchorElement>, href: string) {
    // Never let the webview navigate: the address goes to the system handler.
    event.preventDefault()
    if (!isOpenableUrl(href)) return
    openUrl(href).then(
      () => setLinkError(null),
      (error: unknown) => setLinkError(error instanceof Error ? error.message : String(error)),
    )
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      {editing ? (
        <div className="flex w-full max-w-[85%] flex-col gap-2">
          <Textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={t('conversation.messageEdited')}
            className="max-h-[40vh] min-h-20 text-sm"
            onKeyDown={onEditKeyDown}
          />
          {editError && (
            <p className="text-xs break-words text-destructive" role="alert">
              {editError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" size="sm" onClick={cancelEdit}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" disabled={!canSave} onClick={() => void save()}>
              {t('conversation.saveAndRerun')}
            </Button>
          </div>
        </div>
      ) : item.text ? (
        <>
          <Message.Root align="end">
            <Message.Content className="gap-1">
              <Bubble.Root align="end" variant="muted" className="max-w-[85%]">
                <Bubble.Content dir="auto" className="text-start whitespace-pre-wrap">
                  {item.commandLabel && (
                    <span
                      className="mr-1.5 inline-block rounded-sm bg-background/70 px-1.5 align-baseline font-mono text-xs text-muted-foreground"
                      dir="ltr"
                    >
                      {item.commandLabel}
                    </span>
                  )}
                  {parts.map((part, i) =>
                    part.kind === 'link' ? (
                      <a
                        key={i}
                        href={part.href}
                        rel="noopener noreferrer nofollow"
                        title={part.href}
                        className="rounded-sm text-brand underline underline-offset-2 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        onClick={(event) => openLink(event, part.href)}
                        onAuxClick={(event) => event.preventDefault()}
                      >
                        {part.text}
                      </a>
                    ) : (
                      part.text
                    ),
                  )}
                </Bubble.Content>
              </Bubble.Root>
              {/* Present at rest (no shift when they show), visible on hover, focus or touch. */}
              <TooltipProvider delayDuration={400}>
                <Message.Footer className="gap-0.5 px-0 opacity-0 transition-opacity group-hover/message:opacity-100 group-focus-within/message:opacity-100 [@media(hover:none)]:opacity-100">
                  {/* A message sent by a typed command (`/skill …`) is sent again by typing it. */}
                  {conversation && !readOnly && !item.commandLabel && (
                    <MessageAction
                      ref={editButtonRef}
                      label={t('conversation.editTheMessage')}
                      disabled={running}
                      onclick={startEdit}
                    >
                      <PencilIcon aria-hidden="true" />
                    </MessageAction>
                  )}
                  <MessageAction
                    label={t('conversation.copyTheMessage')}
                    onclick={() => void copy()}
                    onMouseEnter={copyHover.onMouseEnter}
                    onMouseLeave={copyHover.onMouseLeave}
                  >
                    {copied ? (
                      <CheckIcon aria-hidden="true" />
                    ) : (
                      <CopyIcon ref={copyHover.ref} aria-hidden="true" />
                    )}
                  </MessageAction>
                </Message.Footer>
              </TooltipProvider>
            </Message.Content>
          </Message.Root>
          {copyError && (
            <p className="max-w-[85%] text-xs break-words text-destructive" role="alert">
              {t('conversation.couldNotCopy', { copyError })}
            </p>
          )}
          {linkError && (
            <p className="max-w-[85%] text-xs break-words text-destructive" role="alert">
              {t('conversation.theLinkCouldNotBeOpened', { linkError })}
            </p>
          )}
        </>
      ) : null}

      {item.attachments.length > 0 && (
        <ul
          className="flex max-w-[85%] flex-wrap items-end justify-end gap-2"
          aria-label={t('common.attachments')}
        >
          {item.attachments.map((attachment, i) => {
            const name = shownName(attachment)
            const id = copyId(attachment)
            const preview = id ? previews[id] : undefined
            const details = [
              formatBytes(attachment.bytes) || attachmentKind(attachment.kind, name),
              attachment.note,
            ]
              .filter(Boolean)
              .join(' · ')

            return (
              <li key={`${i}:${attachment.path}`} className="min-w-0">
                <Attachment.Root
                  size="sm"
                  orientation={preview ? 'vertical' : 'horizontal'}
                  className={preview ? undefined : 'max-w-64 min-w-0'}
                  title={name}
                >
                  {preview ? (
                    <Attachment.Media variant="image">
                      <img src={preview} alt="" />
                    </Attachment.Media>
                  ) : (
                    <Attachment.Media>
                      <FileIcon
                        path={name}
                        kind={attachment.kind === 'folder' ? 'folder' : 'file'}
                      />
                    </Attachment.Media>
                  )}
                  <Attachment.Content>
                    <Attachment.Title>{name}</Attachment.Title>
                    {details && <Attachment.Description>{details}</Attachment.Description>}
                  </Attachment.Content>
                </Attachment.Root>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default UserMessage
