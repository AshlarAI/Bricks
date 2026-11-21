// « Skills » of the settings: the built-in skill and the skills installed in Bricks' store, with
// the three actions on the store — write a new one, import a folder, remove an installed one.
// Every change goes through the engine's store (validated, published at once, nothing restarted);
// open conversations see it at their next request.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderInputIcon,
  PlusIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Alert, AlertDescription } from '$lib/components/ui/alert'
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import { ButtonGroup } from '$lib/components/ui/button-group'
import { Field, FieldError, FieldLabel } from '$lib/components/ui/field'
import { Input } from '$lib/components/ui/input'
import { Textarea } from '$lib/components/ui/textarea'
import { t, useLanguage } from '$lib/i18n/i18n'
import {
  errorMessage,
  skillsCatalog,
  skillsCreate,
  skillsImport,
  skillsRemove,
  type SkillChange,
  type SkillsCatalog,
} from '$lib/ipc/client'
import { cn } from '$lib/utils'
import SettingsGroup from './SettingsGroup'
import {
  clampPage,
  isInstalledSkill,
  pageCount,
  skillCountLabel,
  skillSourceLabel,
  skillStateLabel,
  skillStateTone,
  type SkillTone,
} from './skills'

function badgeClass(tone: SkillTone): string {
  if (tone === 'warn') return 'border-warning text-warning'
  if (tone === 'muted') return 'text-muted-foreground'
  return ''
}

export function SkillsSettings() {
  useLanguage()
  const uid = useId()

  const [query, setQuery] = useState('')
  /** The search the listing uses: trimmed, and applied a moment after typing. */
  const [applied, setApplied] = useState('')
  const [page, setPage] = useState(0)
  const [catalog, setCatalog] = useState<SkillsCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Only the latest request may write: an older answer that arrives late is dropped. */
  const latestRef = useRef(0)
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** One change at a time: the buttons wait for the answer. */
  const [busy, setBusy] = useState(false)
  /** The last refusal of an import or a removal (the form shows its own under its fields). */
  const [problem, setProblem] = useState<string | null>(null)
  /** What the last change did, read by screen readers and shown next to the count. */
  const [done, setDone] = useState<string | null>(null)

  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  /** The refused field and why; the entered text stays. */
  const [formError, setFormError] = useState<{ field: string; message: string } | null>(null)

  const [confirming, setConfirming] = useState<string | null>(null)

  const fetchCatalog = useCallback(
    async (request: { query: string; page: number }, reloadFlag: boolean) => {
      const token = ++latestRef.current
      setLoading(true)
      try {
        const next = await skillsCatalog(null, request.query, request.page, reloadFlag)
        if (token !== latestRef.current) return
        if (next.listing.entries.length === 0 && request.page > 0) {
          // The listing shrank under this page (after a removal, say): show its last page instead.
          setPage(clampPage(request.page, next.listing.total))
          return
        }
        setCatalog(next)
        setError(null)
      } catch (e) {
        if (token !== latestRef.current) return
        // No stale listing under an error: the page says what failed and nothing else.
        setCatalog(null)
        setError(errorMessage(e))
      } finally {
        if (token === latestRef.current) setLoading(false)
      }
    },
    [],
  )

  // Lists again when the applied search or the page changes.
  useEffect(() => {
    void fetchCatalog({ query: applied, page }, false)
  }, [applied, page, fetchCatalog])

  useEffect(() => {
    return () => clearTimeout(searchTimerRef.current)
  }, [])

  function onSearchInput(text: string) {
    setQuery(text)
    clearTimeout(searchTimerRef.current)
    searchTimerRef.current = setTimeout(() => {
      setApplied(text.trim())
      setPage(0)
    }, 250)
  }

  function reload() {
    void fetchCatalog({ query: applied, page }, true)
  }

  async function change(
    run: () => Promise<SkillChange>,
    success: (name: string) => string,
  ): Promise<SkillChange | null> {
    setBusy(true)
    setProblem(null)
    setDone(null)
    try {
      const result = await run()
      if (result.name) {
        setDone(success(result.name))
        await fetchCatalog({ query: applied, page }, false)
      }
      return result
    } catch (e) {
      setProblem(errorMessage(e))
      return null
    } finally {
      setBusy(false)
    }
  }

  function startAdding() {
    setAdding(true)
    setConfirming(null)
    setProblem(null)
  }

  function cancelAdding() {
    setAdding(false)
    setFormError(null)
  }

  async function submitNew(event: FormEvent) {
    event.preventDefault()
    setFormError(null)
    const result = await change(
      () => skillsCreate(name.trim(), description, instructions),
      (n) => t('settings.added', { n }),
    )
    if (!result) return
    if (result.problem) {
      setFormError({ field: result.problem.field, message: result.problem.message })
      return
    }
    setAdding(false)
    setName('')
    setDescription('')
    setInstructions('')
  }

  async function importFolder() {
    const picked = await openDialog({
      directory: true,
      multiple: false,
      title: t('settings.skillFolderToImport'),
    })
    if (!picked || Array.isArray(picked)) return
    const result = await change(
      () => skillsImport(picked),
      (n) => t('settings.imported', { n }),
    )
    if (result?.problem) setProblem(result.problem.message)
  }

  async function remove(skill: string) {
    setConfirming(null)
    const result = await change(
      () => skillsRemove(skill),
      (n) => t('settings.deleted', { n }),
    )
    if (result?.problem) setProblem(result.problem.message)
  }

  function fieldError(field: string): string | null {
    return formError?.field === field ? formError.message : null
  }

  function renderFieldMessage(field: string) {
    const message = fieldError(field)
    if (!message) return null
    return (
      <FieldError id={`${uid}-${field}-error`} className="text-pretty">
        {message}
      </FieldError>
    )
  }

  /** Errors about the document as a whole are shown under the form, not under one field. */
  const otherFormError =
    formError && !['name', 'description', 'instructions'].includes(formError.field)
      ? formError.message
      : null

  const listing = catalog?.listing ?? null
  const total = listing?.total ?? 0
  const pages = pageCount(total)
  const entries = listing?.entries ?? []
  const diagnostics = listing?.diagnostics ?? []
  const omitted = listing?.catalog_omitted ?? 0

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby={`${uid}-title`}>
        <h3 id={`${uid}-title`} className="text-ui font-semibold text-foreground">
          {t('common.skills')}
        </h3>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <Field className="min-w-0 flex-1">
            <FieldLabel htmlFor={`${uid}-search`}>{t('common.search')}</FieldLabel>
            <Input
              id={`${uid}-search`}
              type="search"
              value={query}
              onChange={(event) => onSearchInput(event.currentTarget.value)}
              placeholder={t('common.nameOrDescription')}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>

          <ButtonGroup aria-label={t('common.skills')} className="shrink-0">
            <Button variant="outline" size="sm" onClick={startAdding} disabled={busy || adding}>
              <PlusIcon aria-hidden="true" data-icon="inline-start" />
              {t('common.add')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void importFolder()} disabled={busy}>
              <FolderInputIcon aria-hidden="true" data-icon="inline-start" />
              {t('settings.import')}
            </Button>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCwIcon
                className={loading ? 'animate-spin' : undefined}
                data-icon="inline-start"
                aria-hidden="true"
              />
              {t('common.reload')}
            </Button>
          </ButtonGroup>
        </div>
      </section>

      {adding && (
        <form
          className="flex flex-col gap-3 rounded-lg border border-border p-3"
          aria-label={t('settings.newSkill')}
          onSubmit={(e) => void submitNew(e)}
        >
          <Field data-invalid={fieldError('name') ? 'true' : undefined}>
            <FieldLabel htmlFor={`${uid}-name`}>{t('settings.name')}</FieldLabel>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="font-mono"
              placeholder="release-notes"
              autoComplete="off"
              spellCheck={false}
              required
              aria-invalid={fieldError('name') ? true : undefined}
              aria-describedby={fieldError('name') ? `${uid}-name-error` : undefined}
            />
            {renderFieldMessage('name')}
          </Field>
          <Field data-invalid={fieldError('description') ? 'true' : undefined}>
            <FieldLabel htmlFor={`${uid}-description`}>{t('settings.description')}</FieldLabel>
            <Input
              id={`${uid}-description`}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('settings.whatTheSkillDoesAndWhen')}
              autoComplete="off"
              required
              aria-invalid={fieldError('description') ? true : undefined}
              aria-describedby={fieldError('description') ? `${uid}-description-error` : undefined}
            />
            {renderFieldMessage('description')}
          </Field>
          <Field data-invalid={fieldError('instructions') ? 'true' : undefined}>
            <FieldLabel htmlFor={`${uid}-instructions`}>{t('settings.instructions')}</FieldLabel>
            <Textarea
              id={`${uid}-instructions`}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              rows={8}
              className="font-mono text-xs"
              placeholder={t('settings.instructionsPlaceholder')}
              spellCheck={false}
              required
              aria-invalid={fieldError('instructions') ? true : undefined}
              aria-describedby={fieldError('instructions') ? `${uid}-instructions-error` : undefined}
            />
            {renderFieldMessage('instructions')}
          </Field>
          {otherFormError && (
            <p role="alert" className="flex items-start gap-2 text-xs text-pretty text-destructive">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              {otherFormError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={cancelAdding} disabled={busy}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {t('common.add')}
            </Button>
          </div>
        </form>
      )}

      {problem && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex w-full items-center justify-between gap-3">
            <span>{problem}</span>
            <Button variant="ghost" size="sm" onClick={() => setProblem(null)}>
              {t('common.close')}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {error ? (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription className="flex flex-col items-start gap-3">
            <p>{t('settings.couldNotReadTheSkills', { error })}</p>
            <Button variant="outline" size="sm" onClick={reload} disabled={loading}>
              <RefreshCwIcon aria-hidden="true" />
              {t('common.retry')}
            </Button>
          </AlertDescription>
        </Alert>
      ) : !catalog ? (
        <p role="status" className="text-ui text-muted-foreground">
          {t('settings.readingSkills')}
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-ui">
            <span className="text-muted-foreground tabular-nums" aria-live="polite">
              {skillCountLabel(total)}
              {applied ? t('settings.for', { applied }) : ''}
              {done ? ` · ${done}` : ''}
            </span>
            {pages > 1 && (
              <nav aria-label={t('settings.skillPages')} className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading || page === 0}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeftIcon aria-hidden="true" />
                  {t('common.previous')}
                </Button>
                <span className="text-muted-foreground tabular-nums">
                  {t('common.pageOf', { value: page + 1, pages })}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={loading || page + 1 >= pages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  {t('common.next')}
                  <ChevronRightIcon aria-hidden="true" />
                </Button>
              </nav>
            )}
          </div>

          {entries.length === 0 ? (
            <p className="text-ui text-muted-foreground">
              {applied ? t('common.noSkillMatches', { query: applied }) : t('settings.noSkills')}
            </p>
          ) : (
            <ul
              className="flex flex-col divide-y divide-border rounded-lg border border-border"
              aria-label={t('common.skills')}
              aria-busy={loading}
            >
              {entries.map((entry) => {
                const tone = skillStateTone(entry.state)
                const details = entry.details ?? []
                const installed = isInstalledSkill(entry.source)
                return (
                  <li key={`${entry.source}:${entry.name}`} className="flex flex-col gap-1.5 p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="min-w-0 font-mono text-ui break-all text-foreground">
                        {entry.name}
                      </span>
                      <Badge
                        variant={tone === 'ok' ? 'secondary' : 'outline'}
                        className={badgeClass(tone)}
                      >
                        {skillStateLabel(entry.state)}
                      </Badge>
                      {installed && (
                        <div className="ml-auto flex items-center gap-1">
                          {confirming === entry.name ? (
                            <>
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => void remove(entry.name)}
                                disabled={busy}
                              >
                                {t('common.delete')}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setConfirming(null)}
                                disabled={busy}
                              >
                                {t('common.cancel')}
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('settings.delete', { name: entry.name })}
                              title={t('common.delete')}
                              onClick={() => setConfirming(entry.name)}
                              disabled={busy}
                            >
                              <Trash2Icon aria-hidden="true" />
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{skillSourceLabel(entry.source)}</p>
                    {entry.description && (
                      <p className="text-xs text-pretty text-muted-foreground">
                        {entry.description}
                      </p>
                    )}
                    {details.length > 0 && (
                      <details className="text-xs text-muted-foreground">
                        <summary className="cursor-pointer hover:text-foreground">
                          {t('settings.details', { details: details.length })}
                        </summary>
                        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4">
                          {details.map((detail, i) => (
                            <li key={i} className="break-words">
                              {detail}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </li>
                )
              })}
            </ul>
          )}

          {catalog.sources.length > 0 && (
            <SettingsGroup title={t('settings.sourcesRead')}>
              <ul className="flex flex-col">
                {catalog.sources.map((source) => (
                  <li
                    key={`${source.source}:${source.path}`}
                    className="flex items-start justify-between gap-3 p-3 text-ui"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="text-foreground">{skillSourceLabel(source.source)}</span>
                      {source.path && (
                        <span
                          className="truncate font-mono text-xs text-muted-foreground"
                          title={source.path}
                        >
                          {source.path}
                        </span>
                      )}
                    </div>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {skillCountLabel(source.skills)}
                    </span>
                  </li>
                ))}
              </ul>
            </SettingsGroup>
          )}

          {(diagnostics.length > 0 || omitted > 0) && (
            <details className="text-ui">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                {t('settings.diagnostics', { value: diagnostics.length + (omitted > 0 ? 1 : 0) })}
              </summary>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-xs text-muted-foreground">
                {diagnostics.map((line, i) => (
                  <li key={i} className="break-words">
                    {line}
                  </li>
                ))}
                {omitted > 0 && (
                  <li>{t('settings.activatableSkillIsMissingFromThe', { count: omitted })}</li>
                )}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}

export default SkillsSettings
