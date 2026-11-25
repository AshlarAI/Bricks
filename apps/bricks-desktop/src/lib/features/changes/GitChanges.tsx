import { useEffect, useRef, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { RefreshCWIcon, useIconHover, type RefreshCWIconHandle } from '$lib/components/icons'
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import EmptyState from '$lib/layout/EmptyState'
import SectionCard from '$lib/layout/SectionCard'
import { errorMessage, gitDiff, gitShow, type FileDiff, type GitArea, type GitCommit } from '$lib/ipc/client'
import { useApp } from '$lib/state/app'
import type { Conversation } from '$lib/state/conversation'
import FileChangeRow from './FileChangeRow'
import ChangeTree from './ChangeTree'
import { buildFileTree } from './tree'
import { useGitState } from './git'
import { countPatch } from './patch'
import { formatDateTime, gitCodeLabel, shortId } from './format'
import type { PatchSource } from './types'

const AREAS: { area: GitArea; readonly title: string }[] = [
  { area: 'staged', get title() { return t('changes.staged') } },
  { area: 'unstaged', get title() { return t('changes.unstaged') } },
  { area: 'untracked', get title() { return t('changes.untracked') } },
  { area: 'conflicted', get title() { return t('changes.conflicts') } },
]

type CommitDetail =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; files: { diff: FileDiff; added: number; removed: number }[] }

function countRunning(conversations: ReadonlyMap<string, Conversation>, projectId: string | null): number {
  if (!projectId) return 0
  let count = 0
  for (const c of conversations.values()) {
    if (c.projectId === projectId && c.running) count += 1
  }
  return count
}

export function GitChanges() {
  useLanguage()
  const projectId = useApp((s) => s.currentProjectId)
  const conversations = useApp((s) => s.conversations)
  const git = useGitState(projectId)
  const refreshHover = useIconHover<RefreshCWIconHandle>()

  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [details, setDetails] = useState<Record<string, CommitDetail>>({})

  // Refresh when the panel shows a project (and on each project switch).
  useEffect(() => {
    if (!git) return
    void git.refresh()
    if (!git.commitsLoaded && !git.commitsLoading) void git.loadCommits()
  }, [git])

  // Refresh when a run of this project ends: its edits are on disk now.
  const prevRunningRef = useRef<{ projectId: string | null; count: number }>({
    projectId: null,
    count: 0,
  })
  useEffect(() => {
    if (!projectId || !git) {
      prevRunningRef.current = { projectId, count: 0 }
      return
    }
    const syncRunning = () => {
      const now = countRunning(conversations, projectId)
      const prev = prevRunningRef.current
      if (prev.projectId === projectId && prev.count > now) {
        void git.refresh(true)
      }
      prevRunningRef.current = { projectId, count: now }
    }
    syncRunning()
    const unsubs: (() => void)[] = []
    for (const c of conversations.values()) {
      if (c.projectId === projectId) {
        unsubs.push(c.subscribe(syncRunning))
      }
    }
    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [conversations, projectId, git])

  // Refresh on window focus (gated inside GitState).
  useEffect(() => {
    if (!git) return
    const onFocus = () => void git.refreshOnFocus()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [git])

  const sections = AREAS.map((s) => ({
    ...s,
    entries: git?.status?.entries.filter((e) => e.area === s.area) ?? [],
  })).filter((s) => s.entries.length > 0)

  const ahead = git?.status?.ahead ?? 0
  const behind = git?.status?.behind ?? 0

  async function toggleCommit(commit: GitCommit) {
    const open = !expanded[commit.hash]
    setExpanded((prev) => ({ ...prev, [commit.hash]: open }))
    const currentDetail = details[commit.hash]
    if (!open || currentDetail?.status === 'ready' || currentDetail?.status === 'loading') return
    if (!projectId) return
    setDetails((prev) => ({ ...prev, [commit.hash]: { status: 'loading' } }))
    try {
      const files = await gitShow(projectId, commit.hash)
      setDetails((prev) => ({
        ...prev,
        [commit.hash]: {
          status: 'ready',
          files: files.map((diff) => ({ diff, ...countPatch(diff.patch) })),
        },
      }))
    } catch (e) {
      setDetails((prev) => ({ ...prev, [commit.hash]: { status: 'error', error: errorMessage(e) } }))
    }
  }

  function diffSource(path: string, area: GitArea): PatchSource[] {
    if (!projectId) return []
    // The revision changes with each status refresh, so a stale diff reloads.
    return [
      {
        key: `diff-${git?.revision ?? 0}`,
        title: t('common.diff'),
        load: () => gitDiff(projectId, path, area),
      },
    ]
  }

  if (!projectId) {
    return <EmptyState title={t('common.noOpenProject')} description={t('changes.chooseAProjectToSeeIts')} />
  }

  if (git?.statusError && !git.status) {
    return (
      <EmptyState
        title={t('changes.gitUnavailable')}
        description={git.statusError}
        action={
          <Button variant="outline" size="sm" onClick={() => void git.refresh()}>
            {t('common.retry')}
          </Button>
        }
      />
    )
  }

  if (git?.status && !git.status.is_repo) {
    return <EmptyState title={t('common.gitIsntInstalledInThisFolder')} />
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {git?.status?.detached ? (
            <Badge variant="outline">
              {t('changes.detachedHead', { value: git.status.head ? ` · ${git.status.head}` : '' })}
            </Badge>
          ) : git?.status?.branch ? (
            <span className="truncate font-mono text-sm">{git.status.branch}</span>
          ) : git?.status ? (
            <span className="text-sm text-muted-foreground">{t('changes.noBranchYet')}</span>
          ) : null}
          {ahead > 0 && <Badge variant="secondary">{t('changes.toPush', { ahead })}</Badge>}
          {behind > 0 && <Badge variant="secondary">{t('changes.toPull', { behind })}</Badge>}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.refresh')}
          title={t('common.refresh')}
          disabled={git?.statusLoading}
          onMouseEnter={refreshHover.onMouseEnter}
          onMouseLeave={refreshHover.onMouseLeave}
          onClick={() => void git?.refresh()}
        >
          <RefreshCWIcon
            ref={refreshHover.ref}
            className={git?.statusLoading ? 'size-4 animate-spin' : 'size-4'}
            aria-hidden="true"
          />
        </Button>
      </header>

      {!git?.status ? (
        <p className="px-3 py-6 text-center text-sm text-muted-foreground">{t('common.loading')}</p>
      ) : sections.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('changes.noChangesTheWorkingTreeIs')}</p>
      ) : (
        sections.map((section) => (
          <SectionCard key={section.area} title={section.title} count={section.entries.length}>
            <ChangeTree
              nodes={buildFileTree(section.entries, (entry) => entry.path)}
              file={(entry, name) => (
                <FileChangeRow
                  name={name}
                  path={entry.path}
                  status={gitCodeLabel(entry.code)}
                  added={entry.added}
                  removed={entry.removed}
                  binary={entry.binary}
                  countLabel={t('common.lines')}
                  note={entry.orig_path ? t('changes.from', { origPath: entry.orig_path }) : undefined}
                  patches={diffSource(entry.path, entry.area)}
                />
              )}
            />
          </SectionCard>
        ))
      )}

      <SectionCard title={t('changes.commits')} count={git?.commitsLoaded ? git.commits.length : undefined}>
        {git?.commitsError ? (
          <p role="alert" className="text-xs text-destructive">
            {t('changes.historyUnavailable', { commitsError: git.commitsError })}
          </p>
        ) : !git?.commitsLoaded ? (
          <p className="py-2 text-sm text-muted-foreground">{t('common.loading')}</p>
        ) : git.commits.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">{t('changes.noCommitsYet')}</p>
        ) : (
          <>
            <ul className="flex flex-col">
              {git.commits.map((commit) => {
                const isExpanded = Boolean(expanded[commit.hash])
                const detail = details[commit.hash]
                return (
                  <li key={commit.hash} className="border-b border-border py-1.5 last:border-b-0">
                    <button
                      type="button"
                      className="flex w-full min-w-0 items-baseline gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-expanded={isExpanded}
                      onClick={() => void toggleCommit(commit)}
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{commit.short}</span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        {commit.subject || t('changes.noMessage')}
                      </span>
                    </button>
                    <p className="pl-[3.25rem] text-xs text-muted-foreground">
                      {commit.author} · <time className="tabular-nums">{formatDateTime(commit.at)}</time>
                    </p>
                    {isExpanded && (
                      <div className="mt-1 pl-2">
                        {!detail || detail.status === 'loading' ? (
                          <p className="text-xs text-muted-foreground">{t('common.loading')}</p>
                        ) : detail.status === 'error' ? (
                          <p role="alert" className="text-xs text-destructive">
                            {t('changes.couldNotLoadTheCommit', { error: detail.error })}
                          </p>
                        ) : detail.files.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t('changes.noFileOfThisProjectIn')}</p>
                        ) : (
                          <ChangeTree
                            nodes={buildFileTree(detail.files, (entry) => entry.diff.path)}
                            file={(entry, name) => (
                              <FileChangeRow
                                name={name}
                                path={entry.diff.path}
                                added={entry.added}
                                removed={entry.removed}
                                binary={entry.diff.binary}
                                countLabel={t('common.lines')}
                                patches={[
                                  {
                                    key: 'diff',
                                    title: t('changes.diff', { hash: shortId(commit.hash) }),
                                    load: async () => entry.diff,
                                  },
                                ]}
                              />
                            )}
                          />
                        )}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
            {!git.commitsExhausted && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={git.commitsLoading}
                  onClick={() => void git.loadCommits(true)}
                >
                  {git.commitsLoading ? t('common.loading') : t('changes.loadMore')}
                </Button>
              </div>
            )}
          </>
        )}
      </SectionCard>
    </div>
  )
}

export default GitChanges
