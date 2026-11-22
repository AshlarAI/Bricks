import { Fragment, useEffect, useRef, useState } from 'react'
import { FolderIcon } from 'lucide-react'
import { Item, ItemContent, ItemDescription, ItemGroup, ItemTitle } from '$lib/components/ui/item'
import { t, useLanguage } from '$lib/i18n/i18n'
import { app, useApp } from '$lib/state/app'
import { errorMessage, type SessionSearchHit } from '$lib/ipc/client'
import { useClock } from './clock'
import { displayTitle, highlightParts, relativeDate } from './format'

const DEBOUNCE_MS = 250

export interface SearchResultsProps {
  /** The text being searched; cleared once a result is opened. */
  query?: string
  /** Called to update `query` (e.g. cleared once a result is opened). */
  onQueryChange?: (query: string) => void
  /** Called once a result is opened. */
  onOpened?: () => void
}

/** Text is rendered as nodes, never as HTML: titles and messages are untrusted. */
function Highlighted({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.match ? (
          <mark key={index} className="rounded-sm bg-warning-soft px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          <Fragment key={index}>{part.text}</Fragment>
        ),
      )}
    </>
  )
}

export function SearchResults({ query = '', onQueryChange, onOpened }: SearchResultsProps) {
  useLanguage()
  const now = useClock()
  const projects = useApp((s) => s.projects)

  // The text actually sent to the engine, once typing has paused for DEBOUNCE_MS.
  const [debounced, setDebounced] = useState('')
  const [hits, setHits] = useState<SessionSearchHit[]>([])
  const [loading, setLoading] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Identifies the latest request, so a slow earlier response never overwrites a newer one.
  const requestRef = useRef(0)

  const pending = query.trim() !== debounced
  const countLabel = t('navigation.resultCount', { count: hits.length })

  // Debounce: the query is sent only once typing has paused.
  useEffect(() => {
    const next = query.trim()
    const timer = setTimeout(
      () => {
        setDebounced(next)
      },
      next ? DEBOUNCE_MS : 0,
    )
    return () => clearTimeout(timer)
  }, [query])

  // Re-runs when the debounced text changes. The search covers every project.
  useEffect(() => {
    let cancelled = false
    const mine = ++requestRef.current
    if (!debounced) {
      setHits([])
      setFailure(null)
      setLoading(false)
      return
    }
    setLoading(true)
    app
      .search(debounced, true)
      .then((found) => {
        if (cancelled || mine !== requestRef.current) return
        setHits(found)
        setFailure(null)
      })
      .catch((error) => {
        if (cancelled || mine !== requestRef.current) return
        setHits([])
        setFailure(errorMessage(error))
      })
      .finally(() => {
        if (!cancelled && mine === requestRef.current) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [debounced])

  function projectName(hit: SessionSearchHit): string {
    const projectId = hit.session.project_id
    return projects.find((p) => p.id === projectId)?.name ?? t('common.unknownProject')
  }

  async function openHit(hit: SessionSearchHit) {
    const session = hit.session
    const projectId = session.project_id
    if (projectId && projectId !== app.currentProjectId) {
      const project = app.projects.find((p) => p.id === projectId)
      if (!project) {
        app.fail(new Error(t('navigation.thisConversationsProjectCantBeFound')))
        return
      }
      if (app.requireFolder(projectId, () => openHit(hit))) {
        onOpened?.()
        return
      }
      await app.selectProject(projectId)
    }
    onQueryChange?.('')
    onOpened?.()
    await app.openSession(session.id)
  }

  return (
    <section aria-label={t('navigation.searchResults')} className="flex flex-col gap-1 px-2 pb-3">
      {pending || loading ? (
        <p role="status" className="px-2 py-2 text-xs text-muted-foreground">
          {t('common.searching')}
        </p>
      ) : failure ? (
        <p role="alert" className="px-2 py-2 text-xs text-destructive">
          {t('common.searchFailed', { failure })}
        </p>
      ) : hits.length === 0 ? (
        <p role="status" className="px-2 py-2 text-sm text-muted-foreground">
          {t('navigation.noResultsFor', { debounced })}
        </p>
      ) : (
        <>
          <p role="status" className="px-2 text-xs text-muted-foreground">
            {countLabel}
          </p>
          <ItemGroup className="gap-0.5">
            {hits.map((hit) => (
              <Item key={hit.session.id} asChild size="sm" className="px-2 py-2 hover:bg-accent/60">
                <button type="button" className="w-full text-left" onClick={() => void openHit(hit)}>
                  <ItemContent className="min-w-0 gap-1">
                    <ItemTitle className="w-full">
                      <span className="min-w-0 flex-1 truncate">
                        <Highlighted text={displayTitle(hit.session.title)} query={debounced} />
                      </span>
                      <span className="shrink-0 text-xs font-normal text-muted-foreground">
                        {relativeDate(hit.session.updated_at, now)}
                      </span>
                    </ItemTitle>
                    <ItemDescription className="flex min-w-0 items-center gap-1.5 text-xs line-clamp-none">
                      <FolderIcon className="size-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{projectName(hit)}</span>
                    </ItemDescription>
                    {hit.matched === 'message' && hit.snippet && (
                      <ItemDescription className="text-xs">
                        <Highlighted text={hit.snippet} query={debounced} />
                      </ItemDescription>
                    )}
                  </ItemContent>
                </button>
              </Item>
            ))}
          </ItemGroup>
        </>
      )}
    </section>
  )
}

export default SearchResults
