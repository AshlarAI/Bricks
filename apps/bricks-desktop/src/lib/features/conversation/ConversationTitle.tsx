// « Project › Conversation » (› Sub-agent). The project opens a new conversation in it; the
// conversation's name is where you are (double-click or the pencil to rename it). In a sub-agent's
// branch, the conversation's name leads back to it.
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { PencilIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { Input } from '$lib/components/ui/input'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '$lib/components/ui/breadcrumb'
import StatusDot from '$lib/layout/StatusDot'
import { app, useApp } from '$lib/state/app'
import { useConversation, type Conversation } from '$lib/state/conversation'
import { ui, useUi } from '$lib/state/ui'
import { agentName } from '$lib/features/agents/branch'

export interface ConversationTitleProps {
  conversation: Conversation | null
}

/** A link of the trail: a button that looks like the crumb, with a hover surface. */
const CRUMB =
  'min-w-0 truncate rounded-md px-1.5 py-0.5 hover:bg-element-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'

export function ConversationTitle({ conversation }: ConversationTitleProps) {
  useLanguage()
  const projects = useApp((s) => s.projects)
  const currentProject = useApp((s) => s.currentProject)
  const agentId = useUi((s) => s.agentId)

  const convProjectId = useConversation(conversation, (c) => c.projectId) ?? null
  const convTitle = useConversation(conversation, (c) => c.title) ?? ''
  const convItemCount = useConversation(conversation, (c) => c.items.length) ?? 0
  const convRunning = useConversation(conversation, (c) => c.running) ?? false
  const branch =
    useConversation(conversation, (c) => (agentId ? (c.agents.get(agentId) ?? null) : null)) ?? null

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const editingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  // A conversation without a project shows no project name.
  const project = (conversation && projects.find((p) => p.id === convProjectId)) ?? currentProject
  const projectName = project && !project.chats ? project.name : null
  const title = conversation ? convTitle.trim() || t('common.newConversation') : ''
  /** A new conversation, still empty, shows nothing: neither its project nor a name. */
  const shown = conversation !== null && (convTitle.trim() !== '' || convItemCount > 0)

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function startEdit() {
    if (!conversation) return
    editingRef.current = true
    setDraft(conversation.title)
    setEditing(true)
  }

  function cancelEdit() {
    editingRef.current = false
    setEditing(false)
  }

  /** Saves the title once; the input leaving the DOM also triggers blur, which is ignored here. */
  function commit() {
    if (!editingRef.current || !conversation) return
    editingRef.current = false
    setEditing(false)
    const next = draft.trim()
    if (!next || next === conversation.title) return
    void app.renameSession(conversation.sessionId, next)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    }
  }

  if (!shown && !branch) return null

  return (
    <div className="group/title flex min-w-0 max-w-full items-center gap-1">
      <Breadcrumb className="min-w-0" aria-label={t('conversation.breadcrumb')}>
        <BreadcrumbList className="flex-nowrap gap-1 text-ui">
          {projectName && project && (
            <>
              <BreadcrumbItem className="min-w-0 max-w-[40%] shrink">
                <BreadcrumbLink asChild>
                  <button
                    type="button"
                    className={CRUMB}
                    title={t('conversation.newConversationIn', { project: projectName })}
                    onClick={() => void app.newConversation(project.id)}
                  >
                    {projectName}
                  </button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="text-muted-foreground/60">/</BreadcrumbSeparator>
            </>
          )}

          {branch && (
            <>
              <BreadcrumbItem className="min-w-0 shrink">
                <BreadcrumbLink asChild>
                  <button type="button" className={CRUMB} title={title} onClick={() => ui.closeAgent()}>
                    {title}
                  </button>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="text-muted-foreground/60">/</BreadcrumbSeparator>
            </>
          )}

          {/* The page's h1 is the sr-only « Bricks » (AppShell): where you are is its h2. */}
          <BreadcrumbItem className="min-w-0">
            <h2 className="flex min-w-0 items-center font-medium">
              {editing && conversation ? (
                <Input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className="h-7 w-64 max-w-full text-ui"
                  aria-label={t('conversation.conversationTitle')}
                  maxLength={200}
                  onKeyDown={onKeyDown}
                  onBlur={commit}
                />
              ) : branch ? (
                <BreadcrumbPage className="min-w-0 truncate px-1.5 py-0.5" data-tauri-drag-region>
                  {agentName(branch)}
                </BreadcrumbPage>
              ) : (
                <BreadcrumbPage
                  className="min-w-0 truncate px-1.5 py-0.5"
                  title={title}
                  onDoubleClick={startEdit}
                >
                  {title}
                </BreadcrumbPage>
              )}
            </h2>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      {conversation && !editing && !branch && (
        <Button
          variant="ghost"
          size="icon-xs"
          className="opacity-0 transition-opacity group-hover/title:opacity-100 focus-visible:opacity-100"
          aria-label={t('conversation.editTheTitle')}
          onClick={startEdit}
        >
          <PencilIcon aria-hidden="true" />
        </Button>
      )}

      {(branch ? !branch.endedAt : convRunning) && <StatusDot status="running" label={t('common.running')} />}
    </div>
  )
}

export default ConversationTitle
