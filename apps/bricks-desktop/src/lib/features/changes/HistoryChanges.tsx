import { useEffect } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { changeLogDiff, type ChangeRecord } from '$lib/ipc/client'
import { Button } from '$lib/components/ui/button'
import EmptyState from '$lib/layout/EmptyState'
import { useApp } from '$lib/state/app'
import { useUi } from '$lib/state/ui'
import { changesetIdsOf, changesetLinkLabel } from '$lib/features/catalog/changeset-links'
import FileChangeRow from './FileChangeRow'
import ChangeTree from './ChangeTree'
import { buildFileTree } from './tree'
import { useProjectJournal } from './journal'
import { formatDateTime, kindLabel, shortId } from './format'
import { historyView } from './history-state'
import type { PatchSource } from './types'

export function HistoryChanges() {
  useLanguage()
  const ui = useUi()
  const projectId = useApp((s) => s.currentProjectId)
  const sessions = useApp((s) => s.sessions)
  const journal = useProjectJournal(projectId)

  const shown = historyView({
    hasProject: journal !== null,
    loaded: journal?.loaded ?? false,
    error: journal?.error ?? null,
    count: journal?.records.length ?? 0,
  })

  // Load once per project. An error waits for « Réessayer », no retry loop.
  useEffect(() => {
    if (journal && !journal.loaded && !journal.loading && !journal.error) {
      void journal.load()
    }
  }, [journal])

  function sessionTitle(sessionId: string): string {
    const session = sessions.find((s) => s.id === sessionId)
    return session?.title.trim() || t('changes.conversation', { sessionId: shortId(sessionId) })
  }

  function patchesOf(record: ChangeRecord, path: string, hasPatch: boolean): PatchSource[] {
    if (!hasPatch) return []
    return [
      {
        key: `${record.id}:${path}`,
        title: t('changes.diffOfTheOperationOf', { at: formatDateTime(record.at) }),
        load: () => changeLogDiff(record.id, path),
      },
    ]
  }

  if (shown.view === 'no_project') {
    return <EmptyState title={t('common.noOpenProject')} description={t('changes.chooseAProjectToSeeIts2')} />
  }

  if (shown.view === 'failed' && journal) {
    return (
      <EmptyState
        title={t('changes.historyUnavailable2')}
        description={journal.error ?? undefined}
        action={
          <Button variant="outline" size="sm" onClick={() => void journal.load()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  if (shown.view === 'loading') {
    return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
  }

  if (shown.view === 'entries' && journal) {
    return (
      <div className="flex flex-col gap-3">
        {shown.inlineError ? (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-xs text-destructive">
            <p className="min-w-0 break-words">{t('changes.couldNotLoadMore', { inlineError: shown.inlineError })}</p>
            <Button variant="outline" size="sm" disabled={journal.loading} onClick={() => void journal.more()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}

        {journal.records.map((record) => (
          <article key={record.id} className="rounded-lg border border-border bg-card">
            <header className="flex flex-col gap-0.5 px-3 pt-2">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="min-w-0 truncate text-sm font-medium">{sessionTitle(record.session_id)}</h3>
                <time className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDateTime(record.at)}</time>
              </div>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <p className="min-w-0 truncate text-xs text-muted-foreground">
                  {record.tool}
                  {record.agent_id ? t('changes.agent', { agentId: shortId(record.agent_id) }) : ''}
                  {record.changeset_id ? t('changes.changeset', { changesetId: shortId(record.changeset_id) }) : ''}
                </p>
                {changesetIdsOf([{ changesetId: record.changeset_id }]).map((id) => (
                  <Button
                    key={id}
                    variant="ghost"
                    size="xs"
                    className="shrink-0"
                    onClick={() => ui.open('changeset', { changesetId: id })}
                  >
                    {changesetLinkLabel([id], id)}
                  </Button>
                ))}
              </div>
            </header>
            <div className="mt-1 border-t border-border p-1">
              <ChangeTree
                nodes={buildFileTree(record.files, (entry) => entry.path)}
                file={(entry, name) => (
                  <FileChangeRow
                    name={name}
                    path={entry.path}
                    status={kindLabel(entry.kind)}
                    added={entry.added}
                    removed={entry.removed}
                    binary={entry.binary}
                    patches={patchesOf(record, entry.path, entry.has_patch)}
                  />
                )}
              />
            </div>
          </article>
        ))}

        {!journal.exhausted && (
          <div className="flex justify-center">
            <Button variant="outline" size="sm" disabled={journal.loading} onClick={() => void journal.more()}>
              {journal.loading ? t('common.loading') : t('changes.loadMore')}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return null
}

export default HistoryChanges
