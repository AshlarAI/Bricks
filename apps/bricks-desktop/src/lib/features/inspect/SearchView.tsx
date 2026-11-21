// Workspace text search (`/search`, `/s`): a real search of the project's
// files by the engine. Not the conversation search.
import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { InspectorState } from '$lib/state/ui'
import { app, useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import { Button } from '$lib/components/ui/button'
import { ButtonGroup } from '$lib/components/ui/button-group'
import { Spinner } from '$lib/components/ui/spinner'
import { Input } from '$lib/components/ui/input'
import { Field, FieldError, FieldLabel } from '$lib/components/ui/field'
import { Switch } from '$lib/components/ui/switch'
import { SearchIcon } from 'lucide-react'
import { cn } from '$lib/utils'
import { formatInt, formatMs } from './format'
import { groupByFile, highlight, readSearchInput, searchStatus } from './search'

export function SearchView({ args }: { args: InspectorState['args'] }) {
  useLanguage()
  const uid = useId()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  const result = conv?.searchResult ?? null
  const groups = result ? groupByFile(result.hits) : []
  const status = result ? searchStatus(result.status) : null

  // The query given with the command: read once, when the view opens.
  const initialQuery = typeof args.query === 'string' ? args.query : ''
  const [text, setText] = useState(initialQuery)
  const [regexSwitch, setRegexSwitch] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  /** The request sent last, with the markers of the answers already in the reducer. */
  const [sent, setSent] = useState<{
    text: string
    regex: boolean
    resultAt: number | null
    rejectionAt: number | null
  } | null>(null)

  // The engine answers with an event: the view waits for a result newer than
  // the one it had when it sent, or for a refusal of `search` newer than the
  // last rejection it saw.
  const answered = sent !== null && result !== null && (sent.resultAt === null || result.at > sent.resultAt)

  const refusal = (() => {
    const r = conv?.lastRejection
    if (!sent || !r || r.command !== 'search') return null
    return sent.rejectionAt === null || r.at > sent.rejectionAt ? r.reason : null
  })()

  const pending = sent !== null && !answered && refusal === null
  // The highlight follows the mode of the request that produced the shown result.
  const highlightRegex = sent !== null && answered ? sent.regex : false

  const preview = readSearchInput(text, regexSwitch)
  const hasText = preview.text.trim() !== ''

  async function submit(event?: SyntheticEvent) {
    event?.preventDefault()
    const current = app.current
    if (!current) {
      setFormError(t('inspect.openASessionTheSearchCovers'))
      return
    }
    const request = readSearchInput(text, regexSwitch)
    if (request.text.trim() === '') {
      setFormError(t('inspect.typeTheTextToSearchFor'))
      return
    }
    setFormError(null)
    setSent({
      text: request.text,
      regex: request.regex,
      resultAt: current.searchResult?.at ?? null,
      rejectionAt: current.lastRejection?.at ?? null,
    })
    const refused = await app.command(current.sessionId, {
      type: 'search',
      text: request.text,
      regex: request.regex,
    })
    if (refused !== null) {
      setSent(null)
      setFormError(refused)
    }
  }

  // A query given with the command (`/search words`) runs once, as the TUI does.
  const autoSubmittedRef = useRef(false)
  useEffect(() => {
    if (autoSubmittedRef.current) return
    autoSubmittedRef.current = true
    if (initialQuery.trim() !== '') void submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form className="flex flex-col gap-2" onSubmit={(e) => void submit(e)}>
        <Field data-invalid={formError ? 'true' : undefined}>
          <FieldLabel htmlFor={`${uid}-query`}>{t('inspect.textToSearchForInThe')}</FieldLabel>
          <ButtonGroup className="w-full">
            <Input
              id={`${uid}-query`}
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              placeholder={t('inspect.textOrReExpression')}
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
            <Button type="submit" disabled={pending || !hasText}>
              {pending ? (
                <>
                  <Spinner data-icon="inline-start" aria-hidden="true" />
                  {t('inspect.searching')}
                </>
              ) : (
                <>
                  <SearchIcon data-icon="inline-start" aria-hidden="true" />
                  {t('common.search')}
                </>
              )}
            </Button>
          </ButtonGroup>
          {formError && <FieldError>{formError}</FieldError>}
        </Field>
        <Field orientation="horizontal" className="w-fit">
          <Switch id={`${uid}-regex`} checked={regexSwitch} onCheckedChange={setRegexSwitch} />
          <FieldLabel htmlFor={`${uid}-regex`} className="font-normal">
            {t('inspect.regularExpression')}
          </FieldLabel>
        </Field>
      </form>

      <div role="status" aria-live="polite" className="text-sm">
        {pending ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Spinner aria-hidden="true" />
            {t('inspect.searchingIn', { value: conv?.workingDir ?? t('inspect.theProject') })}
          </p>
        ) : refusal !== null ? (
          <p role="alert" className="text-destructive">
            {t('inspect.searchRefused', { refusal })}
          </p>
        ) : null}
      </div>

      {!pending && result && status && (
        <section className="flex min-w-0 flex-col gap-3" aria-label={t('inspect.searchResults')}>
          <header className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="min-w-0 text-sm font-medium break-all">
                {t('inspect.resultsFor')}
                <span className="font-mono">{result.query}</span>
                {t('inspect.resultsForEnd')}
              </h3>
              <span
                className={cn(
                  'text-xs font-medium',
                  status.tone === 'success' && 'text-success',
                  status.tone === 'warning' && 'text-warning',
                  status.tone === 'destructive' && 'text-destructive',
                  status.tone === 'muted' && 'text-muted-foreground',
                )}
              >
                {status.label}
              </span>
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('inspect.resultsInFiles', {
                results: t('inspect.resultsShown', { count: result.hits.length }),
                files: t('common.fileCount', { count: groups.length }),
              })}{' '}
              · {formatMs(result.elapsedMs)}
            </p>
          </header>

          {result.notes.length > 0 && (
            <ul className="flex list-disc flex-col gap-1 pl-4 text-xs text-pretty text-muted-foreground">
              {result.notes.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          )}

          {groups.length === 0 ? (
            <p className="text-sm text-pretty text-muted-foreground">
              {result.status === 'complete'
                ? t('inspect.noResultsInTheTextOf')
                : result.status === 'partial'
                  ? t('inspect.noResultsShownButTheSearch')
                  : t('inspect.noResultsShown')}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {groups.map((group) => (
                <div key={group.path} className="flex min-w-0 flex-col gap-1">
                  <h4 className="flex min-w-0 items-baseline gap-2 text-xs font-medium">
                    <span className="min-w-0 truncate font-mono" title={group.path}>
                      {group.path}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {formatInt(group.hits.length)}
                    </span>
                  </h4>
                  <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
                    {group.hits.map((hit, i) => (
                      <li key={i} className="flex min-w-0 gap-3 px-2 py-1.5 text-xs">
                        <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                          {hit.line}:{hit.column}
                        </span>
                        <code className="min-w-0 font-mono break-all whitespace-pre-wrap">
                          {highlight(hit.text, result.query, highlightRegex).map((segment, j) =>
                            segment.match ? (
                              <mark key={j} className="rounded-sm bg-warning-soft text-foreground">
                                {segment.text}
                              </mark>
                            ) : (
                              segment.text
                            ),
                          )}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {result.omitted > 0 && (
            <p className="text-xs text-muted-foreground tabular-nums">
              {t('inspect.occurrencesHidden', { count: result.omitted })}
            </p>
          )}
        </section>
      )}
    </div>
  )
}

export default SearchView
