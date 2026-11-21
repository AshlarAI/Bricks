import { useEffect } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { changeLogDiff } from '$lib/ipc/client'
import { Button } from '$lib/components/ui/button'
import EmptyState from '$lib/layout/EmptyState'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import { useUi } from '$lib/state/ui'
import { changesetIdsOf, changesetLinkLabel } from '$lib/features/catalog/changeset-links'
import { conversationChanges, type FileView } from './conversation-changes'
import FileChangeRow from './FileChangeRow'
import ChangeTree from './ChangeTree'
import { buildFileTree } from './tree'
import { useSessionJournal } from './journal'
import { formatDateTime, kindLabel, shortId } from './format'
import type { PatchSource } from './types'

export function ConversationChanges() {
  useLanguage()
  const ui = useUi()
  const currentConv = useApp((s) => s.current)
  const conv = useConversation(currentConv)
  const journal = useSessionJournal(conv?.projectId, conv?.sessionId)

  // Load once per conversation. An error waits for « Réessayer », no retry loop.
  useEffect(() => {
    if (journal && !journal.loaded && !journal.loading && !journal.error) {
      void journal.load()
    }
  }, [journal])

  const groups = conv
    ? conversationChanges(conv.items, journal?.records ?? [], (runId) => conv.runs.get(runId)?.startedAt)
    : []

  const fileCount = new Set(groups.flatMap((g) => g.files.map((f) => f.path))).size

  function promptOf(runId: string | null): string {
    const prompt = runId && conv ? conv.runs.get(runId)?.prompt.trim() : ''
    if (!prompt) return t('common.run')
    return prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt
  }

  /** One patch per journal record that holds this file. Live edits have none yet. */
  function patchesOf(file: FileView): PatchSource[] {
    return file.operations.flatMap((op) => {
      const recordId = op.recordId
      if (!recordId || !op.hasPatch) return []
      return [
        {
          key: `${recordId}:${file.path}`,
          title: op.at ? t('changes.operationOf', { at: formatDateTime(op.at) }) : t('changes.operation'),
          load: () => changeLogDiff(recordId, file.path),
        },
      ]
    })
  }

  if (!conv) {
    return (
      <EmptyState
        title={t('common.noOpenConversation2')}
        description={t('changes.openAConversationToSeeThe')}
      />
    )
  }

  if (groups.length === 0) {
    if (journal?.error) {
      return (
        <EmptyState
          title={t('changes.logUnavailable')}
          description={journal.error}
          action={
            <Button variant="outline" size="sm" onClick={() => void journal.load()}>
              {t('common.retry')}
            </Button>
          }
        />
      )
    }
    if (!journal?.loaded) {
      return <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
    }
    return null
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs text-muted-foreground">{t('common.filesChanged', { count: fileCount })}</p>

      {groups.map((group) => (
        <section
          key={group.runId ?? 'sans-execution'}
          className="flex flex-col gap-1"
          aria-label={promptOf(group.runId)}
        >
          <header className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
            <h3 className="min-w-0 truncate font-medium text-foreground">{promptOf(group.runId)}</h3>
            {group.startedAt ? <time className="shrink-0 tabular-nums">{formatDateTime(group.startedAt)}</time> : null}
          </header>
          <div className="rounded-lg border border-border bg-card p-1">
            <ChangeTree
              nodes={buildFileTree(group.files, (entry) => entry.path)}
              file={(entry, name) => {
                const ids = changesetIdsOf(entry.operations)
                return (
                  <FileChangeRow
                    name={name}
                    path={entry.path}
                    status={kindLabel(entry.kind)}
                    added={entry.added}
                    removed={entry.removed}
                    binary={entry.binary}
                    agents={entry.agents.map((id) => t('common.agent', { profile: shortId(id) }))}
                    patches={patchesOf(entry)}
                    actions={
                      ids.length > 0 ? (
                        <>
                          {ids.map((id) => (
                            <Button
                              key={id}
                              variant="ghost"
                              size="xs"
                              onClick={() => ui.open('changeset', { changesetId: id })}
                            >
                              {changesetLinkLabel(ids, id)}
                            </Button>
                          ))}
                        </>
                      ) : undefined
                    }
                  />
                )
              }}
            />
          </div>
        </section>
      ))}
    </div>
  )
}

export default ConversationChanges
