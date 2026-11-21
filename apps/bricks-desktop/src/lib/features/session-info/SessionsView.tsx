// Resume picker (`/resume`, `/sessions`): the conversations of the current
// project, and a search across every project. Choosing one reopens it in its
// own project, through the desktop registry.
import { useEffect, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { SearchIcon } from 'lucide-react'
import { Badge } from '$lib/components/ui/badge'
import { Input } from '$lib/components/ui/input'
import { errorMessage, type SessionItem, type SessionSearchHit } from '$lib/ipc/client'
import EmptyState from '$lib/layout/EmptyState'
import {
  displayTitle,
  highlightParts,
  relativeDate,
  shortPath,
  type TextPart,
} from '$lib/features/navigation/format'
import { useApp } from '$lib/state/app'
import { useUi, type InspectorState } from '$lib/state/ui'

const SEARCH_DELAY_MS = 250

// Opened without options: the picker always lists the current project.
export function SessionsView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const app = useApp()
  const ui = useUi()

  const [draft, setDraft] = useState('')
  /** The trimmed text the last search is about (empty: the project's list). */
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SessionSearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  /** Id of the conversation being reopened, while the desktop answers. */
  const [resumingId, setResumingId] = useState<string | null>(null)
  /** Refusal of the desktop to reopen a conversation (kept in the view). */
  const [refusal, setRefusal] = useState<string | null>(null)

  const currentId = app.current?.sessionId ?? null
  const projectSessions = app.sessions

  useEffect(() => {
    void app.refreshSessions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Search waits for a short pause in typing; an older answer never replaces a newer one.
  useEffect(() => {
    const text = draft.trim()
    const timer = setTimeout(() => setQuery(text), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [draft])

  useEffect(() => {
    const text = query
    if (!text) {
      setHits([])
      setSearching(false)
      setSearchError(null)
      return
    }
    let stale = false
    setSearching(true)
    setSearchError(null)
    app.search(text, true).then(
      (found) => {
        if (stale) return
        setHits(found)
        setSearching(false)
      },
      (e: unknown) => {
        if (stale) return
        setHits([])
        setSearchError(errorMessage(e))
        setSearching(false)
      },
    )
    return () => {
      stale = true
    }
  }, [query, app])

  function projectName(projectId: string | null): string {
    if (!projectId) return t('sessionInfo.noProject')
    return app.projects.find((p) => p.id === projectId)?.name ?? t('common.unknownProject')
  }

  /** The title as text parts; a search hit marks the words it matched. */
  function titleParts(item: SessionItem, hit: SessionSearchHit | null): TextPart[] {
    const title = displayTitle(item.title)
    return hit ? highlightParts(title, query) : [{ text: title, match: false }]
  }

  /** One line under a title: when, size, model, folder. */
  function meta(item: SessionItem): string {
    const count = t('sessionInfo.messageCount', { count: item.message_count })
    const folder = item.working_dir ? shortPath(item.working_dir) : t('common.unknownFolder')
    return [
      relativeDate(item.updated_at),
      count,
      item.model ?? t('sessionInfo.unknownModel'),
      folder,
    ].join(' · ')
  }

  async function resume(sessionId: string) {
    if (resumingId) return
    setResumingId(sessionId)
    setRefusal(null)
    const message = await app.resumeSession(sessionId)
    setResumingId(null)
    if (message) {
      setRefusal(message)
      return
    }
    ui.close()
  }

  /** Items of the list: the search hits, or the project's conversations. */
  const rows = query
    ? hits.map((hit) => ({ item: hit.session, hit }))
    : projectSessions.map((item) => ({ item, hit: null as SessionSearchHit | null }))

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={draft}
          onChange={(e) => setDraft(e.currentTarget.value)}
          placeholder={t('sessionInfo.titleOrMessageText')}
          aria-label={t('sessionInfo.searchAConversationAcrossAllProjects')}
          className="pl-8"
          autoComplete="off"
        />
      </div>

      {refusal && (
        <p role="alert" className="text-sm text-destructive">
          {refusal}
        </p>
      )}

      {query && searchError ? (
        <p role="alert" className="text-sm text-destructive">
          {t('common.searchFailed', { failure: searchError })}
        </p>
      ) : query && searching && hits.length === 0 ? (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {t('common.searching')}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => {
            const item = row.item
            return (
              <li key={item.id}>
                <button
                  type="button"
                  className="flex w-full min-w-0 flex-col gap-1 px-3 py-2.5 text-left transition-colors outline-none hover:bg-element-hover focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  aria-current={item.id === currentId ? 'true' : undefined}
                  disabled={resumingId !== null}
                  onClick={() => void resume(item.id)}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                      {titleParts(item, row.hit).map((part, i) =>
                        part.match ? (
                          <mark key={i} className="rounded-sm bg-warning-soft text-foreground">
                            {part.text}
                          </mark>
                        ) : (
                          part.text
                        ),
                      )}
                    </span>
                    {item.id === currentId ? (
                      <Badge variant="default">{t('sessionInfo.current')}</Badge>
                    ) : item.open ? (
                      <Badge variant="secondary">{t('sessionInfo.open')}</Badge>
                    ) : null}
                    {item.running && <Badge variant="outline">{t('common.running')}</Badge>}
                  </span>
                  {row.hit?.snippet && (
                    <span className="line-clamp-2 text-xs text-muted-foreground">
                      {highlightParts(row.hit.snippet, query).map((part, i) =>
                        part.match ? (
                          <mark key={i} className="rounded-sm bg-warning-soft text-foreground">
                            {part.text}
                          </mark>
                        ) : (
                          part.text
                        ),
                      )}
                    </span>
                  )}
                  <span className="truncate text-xs text-muted-foreground">
                    {row.hit ? `${projectName(item.project_id)} · ` : ''}
                    {meta(item)}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : query ? (
        !searching && !searchError ? <EmptyState title={t('sessionInfo.noConversationFound')} /> : null
      ) : !app.currentProject ? (
        <EmptyState title={t('sessionInfo.noProjectSelected')} />
      ) : (
        <EmptyState title={t('sessionInfo.noConversationInThisProject')} />
      )}
    </div>
  )
}

export default SessionsView
