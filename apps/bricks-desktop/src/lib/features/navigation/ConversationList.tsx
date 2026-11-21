import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDownIcon,
  EllipsisVerticalIcon,
  FolderIcon,
  GitForkIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  TrashIcon,
} from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { SessionItem } from '$lib/ipc/client'
import { app, useApp } from '$lib/state/app'
import { Button } from '$lib/components/ui/button'
import { Input } from '$lib/components/ui/input'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '$lib/components/ui/alert-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '$lib/components/ui/dropdown-menu'
import StatusDot from '$lib/layout/StatusDot'
import { cn } from '$lib/utils'
import { displayTitle } from './format'

export interface ConversationListProps {
  /** The project whose conversations are listed (pinned ones left out). */
  projectId?: string
  /** An explicit list instead, shown as given (the pinned conversations). */
  sessions?: SessionItem[]
  /** Accessible name of the list. */
  label: string
  /** Conversations shown before « Afficher plus » (all when absent). */
  limit?: number
  /** Indented under its project's row. */
  nested?: boolean
}

/**
 * Marks a title clipped by its row (`data-clipped`), so only long titles fade out
 * over their last pixels instead of ending on an ellipsis.
 * Re-checked when the row is resized and when the title changes.
 */
function ClippedTitle({ title }: { title: string }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const shown = displayTitle(title)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const update = () => {
      element.toggleAttribute('data-clipped', element.scrollWidth > element.clientWidth + 0.5)
    }
    if (typeof ResizeObserver === 'undefined') {
      update()
      return
    }
    const observer = new ResizeObserver(update)
    observer.observe(element)
    update()
    return () => observer.disconnect()
  }, [shown])

  return (
    <span
      ref={ref}
      className="title-fade min-w-0 overflow-hidden text-compact whitespace-nowrap data-[clipped]:[-webkit-mask-image:linear-gradient(to_right,#000_calc(100%_-_24px),transparent)] data-[clipped]:[mask-image:linear-gradient(to_right,#000_calc(100%_-_24px),transparent)]"
    >
      {shown}
    </span>
  )
}

export function ConversationList({ projectId, sessions, label, limit, nested = false }: ConversationListProps) {
  useLanguage()
  const projects = useApp((s) => s.projects)
  const currentSessionId = useApp((s) => s.currentSessionId)
  const pinnedIds = useApp((s) => s.prefs.pinned_sessions)
  const projectSessions = useApp((s) => (projectId ? s.sessionsOf(projectId) : undefined))

  const [showAll, setShowAll] = useState(false)
  /** Conversations whose forks are folded away. */
  const [folded, setFolded] = useState<Set<string>>(() => new Set())

  // Inline rename: the id of the conversation being renamed, and its draft title.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const [deleteTarget, setDeleteTarget] = useState<SessionItem | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // The list element, kept for keyboard navigation and focus restoration.
  const listRef = useRef<HTMLUListElement | null>(null)
  const renameInputRef = useRef<HTMLInputElement | null>(null)
  // Guards against duplicate endRename calls (e.g. Enter/Escape unmounting triggers onBlur).
  const renamingGuardRef = useRef<string | null>(null)
  const pendingFocusIdRef = useRef<string | null>(null)
  // Set when a menu item starts a rename or a delete: the menu must not hand focus back to its trigger.
  const keepFocusRef = useRef(false)

  const pinnedSet = useMemo(() => new Set(pinnedIds ?? []), [pinnedIds])

  const sorted = useMemo(() => {
    if (sessions) return sessions
    return [...(projectSessions ?? [])]
      .filter((s) => !pinnedSet.has(s.id))
      .sort((a, b) => b.updated_at - a.updated_at)
  }, [sessions, projectSessions, pinnedSet])

  /** The project a pinned conversation belongs to, shown under its title (none for the chats project). */
  function projectName(session: SessionItem): string | null {
    const project = projects.find((p) => p.id === session.project_id)
    return project && !project.chats ? project.name : null
  }

  /**
   * Forks sit under the first conversation of their line that is listed here, oldest first;
   * a fork whose parent is not listed is shown on its own.
   */
  const byId = useMemo(() => new Map(sorted.map((s) => [s.id, s])), [sorted])

  const rootOf = useCallback(
    (session: SessionItem): string => {
      let root = session
      const seen = new Set<string>([root.id])
      while (root.parent_id && byId.has(root.parent_id) && !seen.has(root.parent_id)) {
        root = byId.get(root.parent_id)!
        seen.add(root.id)
      }
      return root.id
    },
    [byId],
  )

  const forks = useMemo(() => {
    const out = new Map<string, SessionItem[]>()
    for (const s of sorted) {
      const root = rootOf(s)
      if (root === s.id) continue
      out.set(root, [...(out.get(root) ?? []), s].sort((a, b) => a.created_at - b.created_at))
    }
    return out
  }, [sorted, rootOf])

  /** The conversations listed at the top level, each with its forks under it. */
  const allRoots = useMemo(() => sorted.filter((s) => rootOf(s) === s.id), [sorted, rootOf])

  // The limit counts top-level rows; the shown conversation's line is always listed.
  const currentRoot = useMemo(() => {
    const current = currentSessionId ? byId.get(currentSessionId) : undefined
    return current ? rootOf(current) : null
  }, [currentSessionId, byId, rootOf])

  const roots = useMemo(
    () =>
      showAll || limit === undefined
        ? allRoots
        : allRoots.filter((s, i) => i < limit || s.id === currentRoot),
    [showAll, limit, allRoots, currentRoot],
  )

  // Focuses and selects the rename field as soon as it is mounted, or restores row focus after cancel/save.
  useEffect(() => {
    if (editingId !== null) {
      const input = renameInputRef.current
      if (input) {
        input.focus()
        input.select()
      }
      return
    }
    const id = pendingFocusIdRef.current
    if (!id) return
    pendingFocusIdRef.current = null
    listRef.current?.querySelector<HTMLElement>(`[data-session-item="${CSS.escape(id)}"]`)?.focus()
  }, [editingId])

  function toggleForks(id: string) {
    setFolded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onMenuClose(event: Event) {
    if (keepFocusRef.current) event.preventDefault()
    keepFocusRef.current = false
  }

  function startRename(session: SessionItem) {
    renamingGuardRef.current = session.id
    setEditingId(session.id)
    setDraft(session.title)
  }

  /** Ends the rename. Enter and Escape give focus back to the row; a blur does not steal it. */
  async function endRename(save: boolean, refocus: boolean) {
    const id = renamingGuardRef.current
    if (!id) return
    renamingGuardRef.current = null
    const session = sorted.find((s) => s.id === id)
    const title = draft.trim()
    if (refocus) pendingFocusIdRef.current = id
    setEditingId(null)
    if (save && session && title && title !== session.title) {
      await app.renameSession(id, title)
    }
  }

  function onRenameKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return
    if (event.key === 'Enter') {
      event.preventDefault()
      void endRename(true, true)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      void endRename(false, true)
    }
  }

  function onItemKeydown(event: React.KeyboardEvent<HTMLButtonElement>, session: SessionItem) {
    if (event.key === 'F2') {
      event.preventDefault()
      startRename(session)
      return
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-session-item]') ?? [])
    const index = items.indexOf(event.currentTarget)
    if (index < 0) return
    event.preventDefault()
    let next = index
    if (event.key === 'ArrowDown') next = Math.min(index + 1, items.length - 1)
    else if (event.key === 'ArrowUp') next = Math.max(index - 1, 0)
    else if (event.key === 'Home') next = 0
    else next = items.length - 1
    items[next]?.focus()
  }

  function askDelete(session: SessionItem) {
    keepFocusRef.current = true
    setDeleteTarget(session)
    setDeleteOpen(true)
  }

  function confirmDelete() {
    const target = deleteTarget
    // The dialog closes at once: deleting a running conversation waits for its run to stop.
    setDeleteOpen(false)
    if (target) void app.deleteSession(target.id)
  }

  function renderRow(session: SessionItem, fork: boolean, hasForks: boolean) {
    const current = session.id === currentSessionId
    const projectLabel = sessions ? projectName(session) : null
    const isPinned = pinnedSet.has(session.id)
    const isFolded = folded.has(session.id)

    return (
      <div
        className={cn(
          'group relative flex items-center rounded-lg transition-colors',
          current
            ? 'bg-background text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06),0_0_0_1px_var(--border-subtle)]'
            : 'hover:bg-element-hover',
        )}
      >
        {editingId === session.id ? (
          <div
            className={cn(
              'min-w-0 flex-1 py-1 pr-9',
              fork ? (nested ? 'pl-13' : 'pl-7') : nested ? 'pl-7' : 'pl-1.5',
            )}
          >
            <Input
              ref={renameInputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              aria-label={t('navigation.newConversationTitle')}
              maxLength={200}
              autoComplete="off"
              className="h-8 text-compact"
              onKeyDown={onRenameKey}
              onBlur={() => void endRename(true, false)}
            />
          </div>
        ) : (
          <>
            <button
              type="button"
              data-session-item={session.id}
              className={cn(
                'flex min-w-0 items-center gap-2 rounded-lg py-1.5 pr-2 text-left group-focus-within:pr-9 group-hover:pr-9 group-has-[[data-state=open]]:pr-9',
                hasForks ? 'shrink' : 'flex-1',
                fork ? (nested ? 'pl-14' : 'pl-8') : nested ? 'pl-8' : 'pl-2',
              )}
              aria-current={current ? 'true' : undefined}
              title={displayTitle(session.title)}
              onClick={() => void app.openSession(session.id)}
              onDoubleClick={() => {
                keepFocusRef.current = false
                startRename(session)
              }}
              onKeyDown={(event) => onItemKeydown(event, session)}
            >
              <span className="flex min-w-0 flex-1 flex-col">
                <ClippedTitle title={session.title} />
                {projectLabel && (
                  <span className="flex min-w-0 items-center gap-1 text-caption text-muted-foreground">
                    <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
                    <span className="truncate">{projectLabel}</span>
                  </span>
                )}
              </span>
              {session.running && <StatusDot status="running" label={t('navigation.conversationRunning')} />}
            </button>
            {hasForks && (
              <>
                <button
                  type="button"
                  className="-ml-1.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                  aria-expanded={!isFolded}
                  aria-label={t(isFolded ? 'navigation.showForks' : 'navigation.hideForks', {
                    title: displayTitle(session.title),
                  })}
                  onClick={() => toggleForks(session.id)}
                >
                  <ChevronDownIcon
                    className={cn('size-3.5 transition-transform', isFolded && '-rotate-90')}
                    aria-hidden="true"
                  />
                </button>
                {/* The rest of the row opens the conversation too (the button above stays the keyboard's). */}
                <div
                  className="min-w-0 flex-1 self-stretch"
                  aria-hidden="true"
                  onClick={() => void app.openSession(session.id)}
                />
              </>
            )}
          </>
        )}
        {fork && (
          <span
            className={cn(
              'pointer-events-none absolute top-0 h-1/2 w-2.5 rounded-bl-md border-b border-l border-muted-foreground/40',
              nested ? 'left-[38px]' : 'left-[14px]',
            )}
            aria-hidden="true"
          />
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="absolute top-1/2 right-1 shrink-0 -translate-y-1/2 text-muted-foreground opacity-0 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label={t('navigation.actionsForConversation', { title: displayTitle(session.title) })}
            >
              <EllipsisVerticalIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44" onCloseAutoFocus={onMenuClose}>
            <DropdownMenuItem
              onSelect={() => {
                keepFocusRef.current = true
                startRename(session)
              }}
            >
              <PencilIcon className="size-4" aria-hidden="true" />
              {t('navigation.rename')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void app.forkSession(session.id)}>
              <GitForkIcon className="size-4" aria-hidden="true" />
              {t('navigation.fork')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => app.togglePin(session.id)}>
              {isPinned ? (
                <>
                  <PinOffIcon className="size-4" aria-hidden="true" />
                  {t('navigation.unpin')}
                </>
              ) : (
                <>
                  <PinIcon className="size-4" aria-hidden="true" />
                  {t('navigation.pin')}
                </>
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => askDelete(session)}>
              <TrashIcon className="size-4" aria-hidden="true" />
              {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    )
  }

  return (
    <>
      <ul ref={listRef} className="flex flex-col gap-0.5" aria-label={label}>
        {roots.map((session) => {
          const kids = forks.get(session.id) ?? []
          return (
            <Fragment key={session.id}>
              <li>{renderRow(session, false, kids.length > 0)}</li>
              {kids.length > 0 &&
                !folded.has(session.id) &&
                kids.map((kid) => <li key={kid.id}>{renderRow(kid, true, false)}</li>)}
            </Fragment>
          )
        })}
        {limit !== undefined && allRoots.length > limit && (showAll || roots.length < allRoots.length) && (
          <li>
            <button
              type="button"
              className={cn(
                'flex w-full items-center gap-1 rounded-lg py-1.5 pr-2 text-left text-xs font-medium text-foreground/70 transition-colors hover:bg-element-hover hover:text-foreground',
                nested ? 'pl-8' : 'pl-2',
              )}
              aria-expanded={showAll}
              onClick={() => setShowAll((prev) => !prev)}
            >
              {showAll ? t('navigation.showLess') : t('navigation.showMore')}
              <ChevronDownIcon
                className={cn('size-3.5 transition-transform', showAll && 'rotate-180')}
                aria-hidden="true"
              />
            </button>
          </li>
        )}
      </ul>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('navigation.delete', { value: displayTitle(deleteTarget?.title ?? '') })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.running && `${t('navigation.theConversationIsRunningItWill')} `}
              {t('navigation.thisIsPermanentTheConversationAnd')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={confirmDelete}>
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default ConversationList
