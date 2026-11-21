// The long-term memory (`/memory`, `/memory global`, the settings): the notes of the
// project's or the global memory, 50 per page, searchable, editable in place, and
// deletable. Reading and editing work whether the memory is on or off.
import { useEffect, useRef, useState } from 'react'
import { t, localeTag, useLanguage } from '$lib/i18n/i18n'
import type { InspectorState } from '$lib/state/ui'
import type { MemoryEntry, MemoryEntryPage, MemoryScope } from '$lib/ipc/client'
import * as ipc from '$lib/ipc/client'
import { useApp } from '$lib/state/app'
import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs'
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import { Input } from '$lib/components/ui/input'
import { Skeleton } from '$lib/components/ui/skeleton'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { formatInt } from './format'

const PAGE = 50
const NOTE_MAX_CHARS = 280

export function MemoryView({ args }: { args: InspectorState['args'] }) {
  useLanguage()
  const app = useApp()

  /** The open project, when it has a memory (not the conversations of no project). */
  const project = app.currentProject && !app.currentProject.chats ? app.currentProject : null
  const projectId = project?.id ?? null

  const defaultScope: MemoryScope = args.scope === 'global' || !project ? 'global' : 'project'
  const scopeKey = `${String(args.scope ?? '')}:${projectId ?? ''}`
  const [scopeState, setScopeState] = useState<{ key: string; value: MemoryScope }>({
    key: scopeKey,
    value: defaultScope,
  })
  const scope: MemoryScope = scopeState.key === scopeKey ? scopeState.value : defaultScope

  const [query, setQuery] = useState('')
  const [offset, setOffset] = useState(0)
  const [page, setPage] = useState<MemoryEntryPage | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [savingId, setSavingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)

  // Reads the page for the current scope, search and offset. The search waits for
  // typing to pause; an older answer never replaces a newer one.
  const requestRef = useRef(0)
  const trimmedQuery = query.trim()

  useEffect(() => {
    const id = ++requestRef.current
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const result = await ipc.memoryEntries(
          scope,
          scope === 'project' ? projectId : null,
          'notes',
          trimmedQuery,
          offset,
          PAGE,
        )
        if (cancelled || id !== requestRef.current) return
        setPage(result)
        setLoadError(null)
      } catch (e) {
        if (cancelled || id !== requestRef.current) return
        setLoadError(ipc.errorMessage(e))
      }
    }, trimmedQuery ? 250 : 0)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [scope, trimmedQuery, offset, projectId, reloadTick])

  function choose(next: () => void) {
    next()
    setOffset(0)
    setEditingId(null)
    setConfirmingId(null)
  }

  function startEdit(entry: MemoryEntry) {
    setActionError(null)
    setConfirmingId(null)
    setEditingId(entry.id)
    setEditDraft(entry.text)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft('')
    setActionError(null)
  }

  async function saveEdit(entry: MemoryEntry) {
    if (savingId !== null) return
    const trimmed = editDraft.trim()
    if (!trimmed) return
    const targetScope = scope
    const targetProjectId = targetScope === 'project' ? projectId : null
    setSavingId(entry.id)
    setActionError(null)
    try {
      await ipc.memoryUpdateNote(targetScope, targetProjectId, entry.id, trimmed)
      setEditingId(null)
      setEditDraft('')
      setReloadTick((t) => t + 1)
    } catch (e) {
      setActionError(ipc.errorMessage(e))
    } finally {
      setSavingId(null)
    }
  }

  async function removeEntry(entry: MemoryEntry) {
    if (deletingId !== null) return
    const targetScope = scope
    const targetProjectId = targetScope === 'project' ? projectId : null
    setDeletingId(entry.id)
    setActionError(null)
    try {
      await ipc.memoryDeleteEntry(targetScope, targetProjectId, 'note', entry.id)
      setConfirmingId(null)
      if (editingId === entry.id) {
        setEditingId(null)
      }
      if (page) {
        const nextEntries = page.entries.filter((e) => e.id !== entry.id)
        setPage({ entries: nextEntries, total: Math.max(0, page.total - 1) })
        if (nextEntries.length === 0 && offset >= PAGE) {
          setOffset((prev) => Math.max(0, prev - PAGE))
        }
      }
      setReloadTick((t) => t + 1)
    } catch (e) {
      setActionError(ipc.errorMessage(e))
    } finally {
      setDeletingId(null)
    }
  }

  function when(at: number): string {
    return new Date(at).toLocaleString(localeTag(), { dateStyle: 'medium', timeStyle: 'short' })
  }

  /** The title of a conversation of the loaded lists, when known. */
  function conversation(sessionId: string): string | null {
    for (const list of app.sessionsByProject.values()) {
      const found = list.find((s) => s.id === sessionId)
      if (found) return found.title || t('common.untitled')
    }
    return null
  }

  /** Where a note comes from: its project (global memory), its conversation. */
  function source(e: MemoryEntry): string {
    const parts: string[] = []
    if (scope === 'global' && e.project_id) {
      parts.push(t('inspect.project', { projectId: e.project_name ?? e.project_id }))
    }
    if (e.session_id) parts.push(conversation(e.session_id) ?? t('inspect.closedConversation'))
    return parts.join(' · ')
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={scope}
          onValueChange={(v) => choose(() => setScopeState({ key: scopeKey, value: v as MemoryScope }))}
        >
          <TabsList aria-label={t('inspect.memoryShown')}>
            <TabsTrigger value="project" disabled={!project}>
              {t('common.project')}
            </TabsTrigger>
            <TabsTrigger value="global">{t('inspect.global')}</TabsTrigger>
          </TabsList>
        </Tabs>
        <Input
          type="search"
          placeholder={t('common.search')}
          aria-label={t('inspect.searchTheMemory')}
          className="h-8 min-w-40 flex-1 text-ui"
          value={query}
          onChange={(event) => {
            const nextQuery = event.currentTarget.value
            choose(() => setQuery(nextQuery))
          }}
        />
      </div>

      {loadError !== null ? (
        <p role="alert" className="text-ui text-pretty text-destructive">
          {loadError}
        </p>
      ) : page === null ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
        </div>
      ) : page.entries.length === 0 ? (
        <p className="text-ui text-muted-foreground">{t('inspect.noMemory')}</p>
      ) : (
        <>
          {actionError !== null && (
            <p role="alert" className="text-ui text-pretty text-destructive">
              {actionError}
            </p>
          )}
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {page.entries.map((entry) => {
              const entrySource = source(entry)
              return (
                <li key={entry.id} className="flex min-w-0 flex-col gap-1.5 px-3 py-2.5">
                  <div className="flex min-w-0 items-start justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">
                      <Badge variant="secondary">{t('common.note')}</Badge>
                      <time dateTime={new Date(entry.at).toISOString()}>{when(entry.at)}</time>
                      {entrySource && <span className="min-w-0 truncate">{entrySource}</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {confirmingId === entry.id ? (
                        <>
                          <Button
                            variant="destructive"
                            size="sm"
                            disabled={deletingId !== null}
                            onClick={() => void removeEntry(entry)}
                          >
                            {t('common.delete')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={deletingId !== null}
                            onClick={() => setConfirmingId(null)}
                          >
                            {t('common.cancel')}
                          </Button>
                        </>
                      ) : editingId !== entry.id ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('common.edit')}
                            title={t('common.edit')}
                            disabled={deletingId !== null || savingId !== null}
                            onClick={() => startEdit(entry)}
                          >
                            <PencilIcon aria-hidden="true" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('inspect.deleteMemoryEntry')}
                            title={t('common.delete')}
                            disabled={deletingId !== null || savingId !== null}
                            onClick={() => {
                              setActionError(null)
                              setConfirmingId(entry.id)
                            }}
                          >
                            <Trash2Icon aria-hidden="true" />
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </div>
                  {editingId === entry.id ? (
                    <form
                      className="flex flex-col gap-2"
                      onSubmit={(e) => {
                        e.preventDefault()
                        void saveEdit(entry)
                      }}
                    >
                      <Input
                        type="text"
                        maxLength={NOTE_MAX_CHARS}
                        aria-label={t('common.edit')}
                        className="h-8 text-ui"
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.currentTarget.value)}
                        disabled={savingId !== null}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-caption tabular-nums text-muted-foreground">
                          {editDraft.trim().length}/{NOTE_MAX_CHARS}
                        </span>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={savingId !== null}
                            onClick={cancelEdit}
                          >
                            {t('common.cancel')}
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={savingId !== null || editDraft.trim().length === 0}
                          >
                            {t('common.save')}
                          </Button>
                        </div>
                      </div>
                    </form>
                  ) : (
                    <p className="text-ui break-words whitespace-pre-wrap">{entry.text}</p>
                  )}
                </li>
              )
            })}
          </ul>
          <div className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
            <span className="tabular-nums">
              {t('inspect.of', {
                value: formatInt(offset + 1),
                entries: formatInt(offset + page.entries.length),
                total: formatInt(page.total),
              })}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={offset === 0}
                onClick={() => setOffset((prev) => Math.max(0, prev - PAGE))}
              >
                {t('common.previous')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={offset + PAGE >= page.total}
                onClick={() => setOffset((prev) => prev + PAGE)}
              >
                {t('common.next')}
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default MemoryView
