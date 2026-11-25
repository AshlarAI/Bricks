import { useEffect, useRef, useState, type SyntheticEvent } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import { SearchIcon } from 'lucide-react'
import { RefreshCWIcon, useIconHover, type RefreshCWIconHandle } from '$lib/components/icons'
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import { Input } from '$lib/components/ui/input'
import { useApp } from '$lib/state/app'
import type { InspectorState } from '$lib/state/ui'
import Pager from './Pager'
import { ENGINE_PAGE_SIZE, pageCount, scopeLabel } from './labels'
import { profilesSlot, useEngineRequest, type ProfilesAnswer } from './request'

// Opened without options: the view always lists the engine's profiles.
export function AgentProfilesView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const conv = useApp((s) => s.current)
  const request = useEngineRequest()
  const reloadHover = useIconHover<RefreshCWIconHandle>()

  /** Text of the search box, and the query of the last search sent. */
  const [draft, setDraft] = useState('')
  const [query, setQuery] = useState('')

  /** The engine's answer to the last request; null while it is awaited. */
  const profiles = request.answered<ProfilesAnswer>()

  function list(page: number, text: string) {
    void request.send({ type: 'list_agent_profiles', query: text, page }, profilesSlot)
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
    void request.send({ type: 'reload_agent_profiles' }, profilesSlot)
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
          <form role="search" className="flex flex-wrap items-end gap-2" onSubmit={onSearch}>
            <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-xs text-muted-foreground">
              {t('catalog.searchForAProfile')}
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
              onMouseEnter={reloadHover.onMouseEnter}
              onMouseLeave={reloadHover.onMouseLeave}
              onClick={reload}
            >
              <RefreshCWIcon ref={reloadHover.ref} aria-hidden="true" />
              {t('common.reload')}
            </Button>
          </form>

          <div role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {request.pending
              ? t('common.loading')
              : profiles
                ? t('catalog.profileCount', { count: profiles.total })
                : null}
          </div>

          {request.refusal && (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive">
              {t('catalog.commandRefused', { refusal: request.refusal })}
            </p>
          )}

          {profiles && profiles.diagnostics && profiles.diagnostics.length > 0 && (
            <section
              aria-label={t('catalog.profileDiagnostics')}
              className="flex flex-col gap-1 rounded-md bg-warning-soft px-3 py-2 text-xs text-pretty"
            >
              <h3 className="font-medium">{t('catalog.diagnostics')}</h3>
              <ul className="flex list-disc flex-col gap-0.5 pl-4">
                {profiles.diagnostics.map((diagnostic, i) => (
                  <li key={i}>
                    <span className="font-mono break-all">{diagnostic.source}</span> : {diagnostic.message}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {profiles && (
            profiles.profiles.length === 0 ? (
              <p className="text-muted-foreground">
                {query ? t('catalog.noProfileMatches', { query }) : t('catalog.noAgentProfileDefined')}
              </p>
            ) : (
              <>
                {/* A named, focusable scroll container: keyboard users must be able to scroll
                  it (WCAG 2.1.1). */}
                <ScrollArea
                  className="rounded-sm"
                  viewportClass="max-h-[52vh] outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  viewportProps={{ role: 'region', 'aria-label': t('common.agentProfiles'), tabIndex: 0 }}
                >
                  <div className="flex flex-col gap-3">
                    <ul className="flex flex-col gap-2">
                      {profiles.profiles.map((profile, i) => (
                        <li key={i} className="flex min-w-0 flex-col gap-1.5 rounded-md border border-border px-2.5 py-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="min-w-0 truncate font-mono font-medium">{profile.name}</span>
                            <Badge variant="outline">{scopeLabel(profile.scope)}</Badge>
                            {profile.valid ? (
                              <Badge variant="secondary">{t('catalog.valid')}</Badge>
                            ) : (
                              <Badge variant="destructive">{t('common.invalid')}</Badge>
                            )}
                          </div>
                          {profile.description && <p className="text-xs text-pretty">{profile.description}</p>}
                          <p className="font-mono text-xs break-all text-muted-foreground">{profile.source}</p>
                          {profile.error && <p className="text-xs text-pretty text-destructive">{profile.error}</p>}
                          {profile.shadows && profile.shadows.length > 0 && (
                            <p className="text-xs text-muted-foreground">
                              {t('catalog.hiddenBy')}{' '}
                              <span className="font-mono break-all">{profile.shadows.join(', ')}</span>
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                </ScrollArea>

                <Pager
                  page={profiles.page}
                  pages={pageCount(profiles.total, ENGINE_PAGE_SIZE)}
                  disabled={request.pending}
                  onchange={(page) => list(page, query)}
                />
              </>
            )
          )}
        </>
      )}
    </div>
  )
}

export default AgentProfilesView
