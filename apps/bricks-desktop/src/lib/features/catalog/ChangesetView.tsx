import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
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
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import {
  changeStatusLabel,
  changesetLabel,
  changesetVariant,
  formatDuration,
} from '$lib/features/agents/agentView'
import DiffView from '$lib/features/changes/DiffView'
import DiffStat from '$lib/layout/DiffStat'
import type { ChangeSet } from '$lib/ipc/engine'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import type { InspectorState } from '$lib/state/ui'
import { argText, splitShortened } from './labels'
import { controlSlot, useEngineRequest, type ControlAnswer } from './request'

type Write = 'apply_changes' | 'discard_changes'

/** Apply and discard both need a ready change or one in conflict. */
function actionable(c: ChangeSet): boolean {
  return c.state === 'ready' || c.state === 'conflict'
}

export function ChangesetView({ args }: { args: InspectorState['args'] }) {
  useLanguage()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  const argId = argText(args.changesetId)
  /** What the caller asked: `inspect` (default), `apply` or `discard`. */
  const requested = argText(args.action) ?? 'inspect'
  /** A change picked in the list; `''` shows the list again. */
  const [picked, setPicked] = useState<string | null>(null)
  const selectedId = picked === null ? argId : picked || null
  const change = conv && selectedId ? (conv.changesets.get(selectedId) ?? null) : null
  const changes = conv ? [...conv.changesets.values()] : []

  /** Inspection of a change this conversation does not hold. */
  const inspect = useEngineRequest()
  const inspectAnswer = inspect.answered<ControlAnswer>()
  /** Apply or discard. */
  const act = useEngineRequest()
  const actAnswer = act.answered<ControlAnswer>()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmWrite, setConfirmWrite] = useState<Write>('apply_changes')

  function ask(write: Write) {
    setConfirmWrite(write)
    setConfirmOpen(true)
  }

  function writeConfirmed() {
    const id = selectedId
    if (id) {
      void act.send(
        { type: 'agent_control', action: confirmWrite, changeset_id: id },
        controlSlot,
        confirmWrite,
      )
    }
  }

  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    const id = selectedId
    if (!id) return
    if (change) {
      if (requested === 'apply' && actionable(change)) ask('apply_changes')
      else if (requested === 'discard' && actionable(change)) ask('discard_changes')
      return
    }
    // Not in this conversation's state: the engine is asked for its patch.
    if (requested === 'inspect') {
      void inspect.send(
        { type: 'agent_control', action: 'inspect_changes', changeset_id: id },
        controlSlot,
        'inspect_changes',
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="flex flex-col gap-4 text-sm">
      {!conv ? (
        <p className="text-muted-foreground">{t('common.noOpenConversation')}</p>
      ) : change ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={changesetVariant(change.state)}>{changesetLabel(change.state)}</Badge>
            <span className="text-xs text-muted-foreground">
              {t('common.fileCount', { count: change.files.length })}
            </span>
            <span className="min-w-0 font-mono text-xs break-all text-muted-foreground">{change.branch}</span>
            {changes.length > 1 && (
              <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setPicked('')}>
                {t('catalog.changeList')}
              </Button>
            )}
          </div>

          <p className="text-pretty">{change.task}</p>
          {change.note && <p className="text-xs text-pretty text-muted-foreground">{change.note}</p>}

          <dl className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">{t('common.agent2')}</dt>
            <dd className="font-mono break-all">{change.agent_id}</dd>
            <dt className="text-muted-foreground">{t('catalog.isolatedWorkspace')}</dt>
            <dd className="font-mono break-all">{change.workspace}</dd>
          </dl>

          {change.files.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs">
              {change.files.map((file) => (
                <li key={file.path} className="flex min-w-0 items-center gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">{changeStatusLabel(file.status)}</span>
                  <span className="min-w-0 flex-1 font-mono break-all">
                    {file.path}
                    {file.from ? (
                      <>
                        {' '}
                        <span className="text-muted-foreground">← {file.from}</span>
                      </>
                    ) : null}
                  </span>
                  {file.binary ? (
                    <span className="shrink-0 text-muted-foreground">{t('common.binary')}</span>
                  ) : (
                    <DiffStat additions={file.added ?? 0} deletions={file.removed ?? 0} className="shrink-0" />
                  )}
                </li>
              ))}
            </ul>
          )}

          {change.validations.length > 0 && (
            <section aria-label={t('catalog.checks')} className="flex flex-col gap-1">
              <h3 className="text-xs font-medium text-muted-foreground">{t('catalog.checks')}</h3>
              <ul className="flex flex-col gap-1 text-xs">
                {change.validations.map((check, i) => (
                  <li key={i} className="flex min-w-0 items-center gap-2">
                    <span className="min-w-0 flex-1 truncate font-mono">{check.command}</span>
                    {check.is_error && <span className="shrink-0 text-destructive">{t('catalog.error')}</span>}
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {formatDuration(check.duration_ms)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {actionable(change) && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={act.pending} onClick={() => ask('apply_changes')}>
                {t('catalog.apply')}
              </Button>
              <Button variant="outline" size="sm" disabled={act.pending} onClick={() => ask('discard_changes')}>
                {t('catalog.discard')}
              </Button>
            </div>
          )}

          {act.pending ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t('catalog.waitingForTheEnginesAnswer')}
            </p>
          ) : act.refusal ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive">
              {t('catalog.commandRefused', { refusal: act.refusal })}
            </p>
          ) : actAnswer ? (
            actAnswer.ok ? (
              <p role="status" className="text-xs text-pretty text-muted-foreground">
                {t('catalog.engineAnswer', { text: actAnswer.text })}
              </p>
            ) : (
              <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive">
                {actAnswer.action === 'apply_changes' ? t('common.couldNotApply') : t('common.couldNotDiscard')} :{' '}
                {actAnswer.text}
              </p>
            )
          ) : null}

          {change.state === 'conflict' && (
            <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-xs text-pretty">
              {t('catalog.conflictThisChangeNoLongerApplies')}
            </p>
          )}

          <section aria-label={t('common.diff')} className="flex flex-col gap-1">
            <h3 className="text-xs font-medium text-muted-foreground">{t('common.changes')}</h3>
            <DiffView patch={change.patch} />
          </section>

          <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
            <AlertDialogContent>
              <AlertDialogHeader>
                {confirmWrite === 'apply_changes' ? (
                  <>
                    <AlertDialogTitle>{t('catalog.applyThisChange')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('catalog.filesWillBeWritten', { count: change.files.length })}
                    </AlertDialogDescription>
                  </>
                ) : (
                  <>
                    <AlertDialogTitle>{t('catalog.discardThisChange')}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('catalog.theIsolatedChangeWillBeDeleted')}
                    </AlertDialogDescription>
                  </>
                )}
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  variant={confirmWrite === 'discard_changes' ? 'destructive' : 'default'}
                  onClick={writeConfirmed}
                >
                  {confirmWrite === 'apply_changes' ? t('catalog.apply') : t('catalog.discard')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      ) : selectedId ? (
        <>
          {requested !== 'inspect' ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive">
              {t('catalog.isolatedChangeNotFoundInThis', { selectedId })}
            </p>
          ) : inspect.pending ? (
            <p role="status" className="text-xs text-muted-foreground">
              {t('catalog.lookingForChange', { selectedId })}
            </p>
          ) : inspect.refusal ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive">
              {t('catalog.commandRefused', { refusal: inspect.refusal })}
            </p>
          ) : inspectAnswer && inspectAnswer.ok ? (
            (() => {
              const shown = splitShortened(inspectAnswer.text)
              return (
                <>
                  <p role="status" className="text-xs text-pretty text-muted-foreground">
                    {t('catalog.changeIsKnownToTheEngine', { selectedId })}
                  </p>
                  <DiffView patch={shown.patch} truncated={shown.truncated} />
                </>
              )
            })()
          ) : inspectAnswer ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-pretty text-destructive">
              {t('catalog.isolatedChangeNotFound', { selectedId, text: inspectAnswer.text })}
            </p>
          ) : null}
          {changes.length > 0 && (
            <Button variant="ghost" size="xs" className="self-start" onClick={() => setPicked('')}>
              {t('catalog.changeList')}
            </Button>
          )}
        </>
      ) : changes.length === 0 ? (
        <p className="text-muted-foreground">{t('catalog.noIsolatedChangeInThisConversation')}</p>
      ) : (
        /* A named, focusable scroll container: keyboard users must be able to scroll
           it (WCAG 2.1.1). */
        <ScrollArea
          className="rounded-sm"
          viewportClass="max-h-[52vh] outline-none focus-visible:ring-2 focus-visible:ring-ring"
          viewportProps={{ role: 'region', 'aria-label': t('common.isolatedChanges'), tabIndex: 0 }}
        >
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {changes.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setPicked(item.id)}
                    className="flex w-full min-w-0 flex-col gap-1.5 rounded-md border border-border bg-background px-2.5 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{item.task}</span>
                      <Badge variant={changesetVariant(item.state)}>{changesetLabel(item.state)}</Badge>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{t('common.fileCount', { count: item.files.length })}</span>
                      <span className="min-w-0 font-mono break-all">{item.branch}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

export default ChangesetView
