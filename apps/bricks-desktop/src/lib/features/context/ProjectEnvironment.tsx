import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CopyIcon, FolderIcon, FolderKanbanIcon, GitBranchIcon, TriangleAlertIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { useApp } from '$lib/state/app'
import { errorMessage, gitStatus, type GitStatus, type Project } from '$lib/ipc/client'
import { FocusGate } from '$lib/state/focus-gate'
import { Button } from '$lib/components/ui/button'
import SectionCard from '$lib/layout/SectionCard'

interface GitCounts {
  staged: number
  unstaged: number
  untracked: number
  conflicted: number
}

type GitResult =
  | { kind: 'error'; message: string }
  | { kind: 'ready'; status: GitStatus; counts: GitCounts }

function countEntries(status: GitStatus): GitCounts {
  const counts: GitCounts = { staged: 0, unstaged: 0, untracked: 0, conflicted: 0 }
  for (const entry of status.entries) counts[entry.area] += 1
  return counts
}

function dirtyCount(c: GitCounts): number {
  return c.staged + c.unstaged + c.untracked + c.conflicted
}

function headLabel(s: GitStatus): string {
  if (s.detached) return s.head ? t('context.detachedHead', { head: s.head }) : t('context.detachedHead2')
  const branch = s.branch ?? t('context.unknownBranch')
  return s.head ? branch : t('context.noCommits', { branch })
}

export interface ProjectEnvironmentProps {
  project: Project
}

export function ProjectEnvironment({ project }: ProjectEnvironmentProps) {
  useLanguage()
  const conversations = useApp((s) => s.conversations)

  const projectId = project.id
  const projectMissing = project.missing
  const projectName = project.name
  const projectPath = project.path

  /** Last git result, tagged with the project it describes. */
  const [git, setGit] = useState<{ projectId: string; result: GitResult } | null>(null)
  /** `null` while the first read of the current project is pending. */
  const gitView = git && git.projectId === projectId ? git.result : null

  const [copied, setCopied] = useState(false)

  const requestSeqRef = useRef(0)
  const inFlightProjectIdRef = useRef<string | null>(null)
  const queuedProjectIdRef = useRef<string | null>(null)
  const destroyedRef = useRef(false)
  const gitFocusGateRef = useRef(new FocusGate())
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const lastRunningRef = useRef<Record<string, boolean>>({})
  const latestProjectRef = useRef({ id: projectId, missing: projectMissing })
  latestProjectRef.current = { id: projectId, missing: projectMissing }

  useEffect(() => {
    destroyedRef.current = false
    return () => {
      destroyedRef.current = true
      clearTimeout(copyTimerRef.current)
    }
  }, [])

  const refreshGit = useCallback(async (id: string, queueIfBusy = false) => {
    const gate = gitFocusGateRef.current
    if (gate.busy && inFlightProjectIdRef.current === id) {
      if (queueIfBusy) queuedProjectIdRef.current = id
      return
    }
    const seq = ++requestSeqRef.current
    inFlightProjectIdRef.current = id
    queuedProjectIdRef.current = null
    try {
      const status = await gate.track(() => gitStatus(id))
      if (seq === requestSeqRef.current && !destroyedRef.current) {
        setGit({ projectId: id, result: { kind: 'ready', status, counts: countEntries(status) } })
      }
    } catch (e) {
      if (seq === requestSeqRef.current && !destroyedRef.current) {
        setGit({ projectId: id, result: { kind: 'error', message: errorMessage(e) } })
      }
    } finally {
      if (seq === requestSeqRef.current) {
        inFlightProjectIdRef.current = null
        const latest = latestProjectRef.current
        if (!destroyedRef.current && queuedProjectIdRef.current === latest.id && !latest.missing) {
          const queued = queuedProjectIdRef.current
          queuedProjectIdRef.current = null
          if (queued) void refreshGit(queued)
        }
      }
    }
  }, [])

  // Project change: read the workspace state of the new folder.
  useEffect(() => {
    if (!projectMissing) void refreshGit(projectId)
  }, [projectId, projectMissing, refreshGit])

  // A run finished in a conversation of this project: the working tree may
  // have changed. Plain memory of each conversation's last state (not UI state).
  useEffect(() => {
    const checkFinished = () => {
      let finished = false
      for (const c of conversations.values()) {
        const running = c.running
        if (c.projectId === projectId && !running && lastRunningRef.current[c.sessionId] === true) {
          finished = true
        }
        lastRunningRef.current[c.sessionId] = running
      }
      if (finished && !projectMissing) void refreshGit(projectId, true)
    }
    checkFinished()
    const unsubs: (() => void)[] = []
    for (const c of conversations.values()) {
      if (c.projectId === projectId) {
        unsubs.push(c.subscribe(checkFinished))
      }
    }
    return () => {
      for (const unsub of unsubs) unsub()
    }
  }, [conversations, projectId, projectMissing, refreshGit])

  // Window focus refresh (gated).
  useEffect(() => {
    const onFocus = () => {
      if (!projectMissing && gitFocusGateRef.current.canRunOnFocus()) {
        void refreshGit(projectId)
      }
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [projectId, projectMissing, refreshGit])

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(projectPath)
      setCopied(true)
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch (e) {
      toast.error(t('common.couldNotCopy'), { description: errorMessage(e) })
    }
  }

  return (
    <SectionCard title={t('context.environment')}>
      <dl className="grid grid-cols-[1rem_minmax(0,1fr)] items-start gap-x-2.5 gap-y-2 text-xs">
        <dt className="flex h-4 items-center text-muted-foreground">
          <FolderKanbanIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{t('common.project')}</span>
        </dt>
        <dd className="min-w-0 truncate font-medium" title={projectName}>
          {projectName}
        </dd>

        <dt className="flex h-4 items-center text-muted-foreground">
          <FolderIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">{t('common.folder')}</span>
        </dt>
        <dd className="flex min-w-0 items-center gap-1">
          <span className="min-w-0 flex-1 truncate font-mono text-xs" title={projectPath}>
            {projectPath}
          </span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t('context.copyTheFolderPath')}
            onClick={() => void copyPath()}
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </Button>
        </dd>

        <dt className="flex h-4 items-center text-muted-foreground">
          <GitBranchIcon className="size-3.5" aria-hidden="true" />
          <span className="sr-only">Git</span>
        </dt>
        <dd className="min-w-0">
          {projectMissing ? (
            <span className="text-muted-foreground">{t('context.folderNotFound')}</span>
          ) : gitView === null ? (
            <span className="text-muted-foreground">{t('context.readingTheRepositoryStatus')}</span>
          ) : gitView.kind === 'error' ? (
            <span className="flex items-start gap-1.5 text-warning">
              <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span className="min-w-0 text-pretty">{t('context.gitUnavailable', { message: gitView.message })}</span>
            </span>
          ) : !gitView.status.is_repo ? (
            <span className="text-muted-foreground">{t('common.gitIsntInstalledInThisFolder')}</span>
          ) : (
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate font-mono">{headLabel(gitView.status)}</span>

              {(gitView.status.ahead > 0 || gitView.status.behind > 0) && (
                <span className="flex flex-wrap gap-x-3 tabular-nums text-muted-foreground">
                  {gitView.status.ahead > 0 && <span>{t('context.toPublish', { ahead: gitView.status.ahead })}</span>}
                  {gitView.status.behind > 0 && <span>{t('context.toPull', { behind: gitView.status.behind })}</span>}
                </span>
              )}

              {dirtyCount(gitView.counts) === 0 ? (
                <span className="text-success">{t('context.cleanWorkspace')}</span>
              ) : (
                <ul className="flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums text-muted-foreground">
                  {gitView.counts.staged > 0 && <li>{t('context.staged', { staged: gitView.counts.staged })}</li>}
                  {gitView.counts.unstaged > 0 && <li>{t('context.unstaged', { unstaged: gitView.counts.unstaged })}</li>}
                  {gitView.counts.untracked > 0 && (
                    <li>{t('context.untracked', { untracked: gitView.counts.untracked })}</li>
                  )}
                  {gitView.counts.conflicted > 0 && (
                    <li className="text-destructive">
                      {t('context.conflicted', { conflicted: gitView.counts.conflicted })}
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </dd>
      </dl>
    </SectionCard>
  )
}

export default ProjectEnvironment
