import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import { RefreshCwIcon, SearchIcon } from 'lucide-react'
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import { Input } from '$lib/components/ui/input'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import type { InspectorState } from '$lib/state/ui'
import Pager from './Pager'
import { ENGINE_PAGE_SIZE, pageCount, scopeLabel, skillStateView } from './labels'
import { skillsSlot, useEngineRequest, type SkillsAnswer } from './request'

// Opened without options: the view always lists the session's skills.
export function SkillsView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  const request = useEngineRequest()
  const trust = useEngineRequest()

  /** Text of the search box, and the query of the last search sent. */
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  /** The engine's answer to the last listing request; null while awaited. */
  const answer = request.answered<SkillsAnswer>()
  const listing = answer ? answer.listing : null

  /** Project decision in force: a pending engine request, else the last listing's. */
  const decision = conv?.skillsTrust ? 'pending' : (conv?.skillsListing?.listing.project_decision ?? null)
  const trustRequest = conv?.skillsTrust ?? null

  function list(page: number, text: string) {
    void request.send({ type: 'list_skills', query: text, page }, skillsSlot)
  }

  function onSearch(event: SyntheticEvent) {
    event.preventDefault()
    const next = draft.trim()
    setQuery(next)
    list(0, next)
  }

  function reload() {
    setDraft('')
    setQuery('')
    void request.send({ type: 'reload_skills' }, skillsSlot)
  }

  /** A person's decision, never automatic. The listing is asked again after it. */
  async function decide(allow: boolean) {
    await trust.send({ type: 'trust_project_skills', allow }, () => null)
    list(0, query)
  }

  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    list(0, '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-4 text-sm">
      {!conv ? (
        <p className="text-muted-foreground">{t('common.noOpenConversation')}</p>
      ) : (
        <>
          {decision !== null && (
            <section
              aria-label={t('common.projectSkills')}
              className="flex flex-col gap-2 rounded-md border border-border p-3"
            >
              <h3 className="text-xs font-medium text-muted-foreground">{t('common.projectSkills')}</h3>
              {decision === 'pending' ? (
                <p className="text-xs text-pretty">{t('catalog.waitingForYourDecisionForThis')}</p>
              ) : decision === 'granted' ? (
                <p className="text-xs text-pretty">{t('catalog.allowedForThisSession')}</p>
              ) : (
                <p className="text-xs text-pretty">{t('catalog.refusedForThisSession')}</p>
              )}

              {trustRequest && (
                <>
                  <p className="font-mono text-xs break-all text-muted-foreground">{trustRequest.project}</p>
                  <ul className="flex flex-col gap-0.5 text-xs">
                    {trustRequest.sources.map((source, i) => (
                      <li key={i}>
                        <span className="font-mono">{scopeLabel(source.source)}</span>
                        {' · '}
                        {t('common.skillCount', { count: source.skills })}
                        {' · '}
                        <span className="font-mono break-all text-muted-foreground">{source.path}</span>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <div className="flex flex-wrap gap-2">
                {(decision === 'pending' || decision === 'denied') && (
                  <Button size="sm" disabled={trust.pending} onClick={() => void decide(true)}>
                    {t('catalog.allowProjectSkillsForThisSession')}
                  </Button>
                )}
                {(decision === 'pending' || decision === 'granted') && (
                  <Button variant="outline" size="sm" disabled={trust.pending} onClick={() => void decide(false)}>
                    {t('common.refuse')}
                  </Button>
                )}
              </div>

              {trust.refusal && (
                <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive">
                  {t('catalog.commandRefused', { refusal: trust.refusal })}
                </p>
              )}
            </section>
          )}

          <form role="search" className="flex flex-wrap items-end gap-2" onSubmit={onSearch}>
            <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-xs text-muted-foreground">
              {t('common.searchForASkill')}
              <Input
                type="search"
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                placeholder={t('common.nameOrDescription')}
                className="text-sm text-foreground"
              />
            </label>
            <Button type="submit" variant="outline" size="sm" disabled={request.pending}>
              <SearchIcon aria-hidden="true" />
              {t('common.search')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={request.pending}
              onClick={reload}
            >
              <RefreshCwIcon aria-hidden="true" />
              {t('common.reload')}
            </Button>
          </form>

          <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {request.pending
              ? t('common.loading')
              : listing
                ? t('common.skillCount', { count: listing.total })
                : null}
          </div>

          {request.refusal && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive">
              {t('catalog.commandRefused', { refusal: request.refusal })}
            </p>
          )}

          {listing && listing.diagnostics && listing.diagnostics.length > 0 && (
            <section
              aria-label={t('catalog.skillDiagnostics')}
              className="flex flex-col gap-1 rounded-md bg-warning-soft px-3 py-2 text-xs text-pretty"
            >
              <h3 className="font-medium">{t('catalog.diagnostics')}</h3>
              <ul className="flex list-disc flex-col gap-0.5 pl-4">
                {listing.diagnostics.map((diagnostic, i) => (
                  <li key={i} className="break-all">
                    {diagnostic}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {listing && (
            <>
              {listing.catalog_omitted > 0 && (
                <p className="text-xs text-pretty text-muted-foreground">
                  {t('catalog.outsideTheModelsCatalog', { catalogOmitted: listing.catalog_omitted })}
                </p>
              )}

              {listing.entries.length === 0 ? (
                <p className="text-muted-foreground">
                  {query ? t('common.noSkillMatches', { query }) : t('catalog.noSkillsAvailable')}
                </p>
              ) : (
                <>
                  {/* A named, focusable scroll container: keyboard users must be able to scroll
                    it (WCAG 2.1.1). */}
                  <ScrollArea
                    className="rounded-sm"
                    viewportClass="max-h-[46vh] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    viewportProps={{ role: 'region', 'aria-label': t('common.skills'), tabIndex: 0 }}
                  >
                    <div className="flex flex-col gap-3">
                      <ul className="flex flex-col gap-2">
                        {listing.entries.map((entry, i) => {
                          const view = skillStateView(entry.state)
                          return (
                            <li
                              key={i}
                              className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border px-2.5 py-2"
                            >
                              <div className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className="min-w-0 truncate font-mono font-medium">{entry.name}</span>
                                <Badge variant="outline">{scopeLabel(entry.source)}</Badge>
                                <Badge variant={view.variant}>{view.label}</Badge>
                                {entry.revision && (
                                  <span className="font-mono text-xs text-muted-foreground">
                                    {t('catalog.revision', { revision: entry.revision })}
                                  </span>
                                )}
                              </div>
                              {entry.description && <p className="text-xs text-pretty">{entry.description}</p>}
                              {entry.path && (
                                <p className="font-mono text-xs break-all text-muted-foreground">{entry.path}</p>
                              )}
                              {entry.details && entry.details.length > 0 && (
                                <ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs text-pretty">
                                  {entry.details.map((detail, j) => (
                                    <li key={j} className="break-all">
                                      {detail}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  </ScrollArea>

                  <Pager
                    page={listing.page}
                    pages={pageCount(listing.total, ENGINE_PAGE_SIZE)}
                    disabled={request.pending}
                    onchange={(page) => list(page, query)}
                  />
                </>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default SkillsView
