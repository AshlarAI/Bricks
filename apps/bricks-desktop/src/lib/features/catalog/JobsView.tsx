import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import { ChevronRightIcon, SquareIcon } from 'lucide-react'
import { RefreshCWIcon, useIconHover, type RefreshCWIconHandle } from '$lib/components/icons'
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
import { Button } from '$lib/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
import { formatDuration, formatTime } from '$lib/features/agents/agentView'
import StatusDot from '$lib/layout/StatusDot'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import type { InspectorState } from '$lib/state/ui'
import { formatBytes, jobDurationMs, jobStatus, jobsSummary, sortJobs } from './labels'
import { controlSlot, useEngineRequest, type ControlAnswer } from './request'

// Opened without options: the view always shows the engine's jobs.
export function JobsView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  /** Background jobs of this conversation, as the engine reports them. */
  const jobs = conv ? sortJobs([...conv.jobs.values()]) : []
  const anyRunning = jobs.some((job) => job.state === 'running')

  // One clock for the list, running only while a job runs.
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!anyRunning) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [anyRunning])

  const refresh = useEngineRequest()
  const refreshAnswer = refresh.answered<ControlAnswer>()
  const stop = useEngineRequest()
  const stopAnswer = stop.answered<ControlAnswer>()

  const summary = refresh.pending && jobs.length === 0 ? t('catalog.refreshing') : jobsSummary(jobs)
  /** Folded: the summary says the state; the list and each job's details open on demand. */
  const [open, setOpen] = useState(false)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmJob, setConfirmJob] = useState<string | null>(null)
  const confirmCommand = confirmJob ? (jobs.find((job) => job.jobId === confirmJob)?.command ?? '') : ''

  function refreshJobs() {
    void refresh.send({ type: 'agent_control', action: 'jobs' }, controlSlot, 'jobs')
  }

  function askStop(jobId: string) {
    setConfirmJob(jobId)
    setConfirmOpen(true)
  }

  function stopConfirmed() {
    const jobId = confirmJob
    setConfirmJob(null)
    setConfirmOpen(false)
    if (jobId) {
      void stop.send(
        { type: 'agent_control', action: 'stop_job', job_id: jobId },
        controlSlot,
        'stop_job',
      )
    }
  }

  const didInitRef = useRef(false)
  useEffect(() => {
    if (didInitRef.current) return
    didInitRef.current = true
    refreshJobs()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshHover = useIconHover<RefreshCWIconHandle>()

  return (
    <>
      <div className="flex flex-col gap-3 text-ui">
        {!conv ? (
          <p className="text-muted-foreground">{t('common.noOpenConversation2')}</p>
        ) : (
          <>
            <section
              aria-label={t('common.backgroundJobs')}
              className="rounded-xl border border-border bg-card text-card-foreground"
            >
              <Collapsible open={open} onOpenChange={setOpen}>
                <div className="flex min-w-0 items-center gap-1 pr-1.5">
                  <CollapsibleTrigger
                    disabled={jobs.length === 0}
                    className="group flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2 text-start enabled:hover:bg-element-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <ChevronRightIcon
                      className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90 group-disabled:opacity-0"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 truncate tabular-nums">{summary}</span>
                  </CollapsibleTrigger>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('common.refresh')}
                    title={t('common.refresh')}
                    disabled={refresh.pending}
                    onMouseEnter={refreshHover.onMouseEnter}
                    onMouseLeave={refreshHover.onMouseLeave}
                    onClick={refreshJobs}
                  >
                    <RefreshCWIcon
                      ref={refreshHover.ref}
                      className={refresh.pending ? 'animate-spin' : undefined}
                      aria-hidden="true"
                    />
                  </Button>
                </div>
                <CollapsibleContent>
                  <ScrollArea className="border-t border-border" viewportClass="max-h-[52vh]">
                    <ul>
                      {jobs.map((job) => {
                        const status = jobStatus(job.state)
                        return (
                          <li key={job.jobId} className="border-b border-border last:border-b-0">
                            <Collapsible>
                              <div className="flex min-w-0 items-center gap-1 pr-1.5">
                                <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-start hover:bg-element-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                                  <ChevronRightIcon
                                    className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
                                    aria-hidden="true"
                                  />
                                  <StatusDot status={status.dot} label={status.label} className="shrink-0" />
                                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={job.command}>
                                    {job.command}
                                  </span>
                                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                                    {formatDuration(jobDurationMs(job, now))}
                                  </span>
                                </CollapsibleTrigger>
                                {job.state === 'running' && (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    aria-label={t('catalog.stop', { command: job.command })}
                                    title={t('common.stop')}
                                    disabled={stop.pending}
                                    onClick={() => askStop(job.jobId)}
                                  >
                                    <SquareIcon aria-hidden="true" />
                                  </Button>
                                )}
                              </div>
                              <CollapsibleContent>
                                <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 px-3 pt-0.5 pb-2 pl-9 text-xs">
                                  <dt className="text-muted-foreground">{t('catalog.status')}</dt>
                                  <dd>{status.label}</dd>
                                  <dt className="text-muted-foreground">{t('catalog.started')}</dt>
                                  <dd className="tabular-nums">{formatTime(job.startedAt)}</dd>
                                  <dt className="text-muted-foreground">{t('common.folder')}</dt>
                                  <dd className="font-mono break-all">{job.cwd}</dd>
                                  <dt className="text-muted-foreground">PID</dt>
                                  <dd className="tabular-nums">{job.pid}</dd>
                                  <dt className="text-muted-foreground">{t('common.agent2')}</dt>
                                  <dd className="font-mono break-all">{job.agentId}</dd>
                                  <dt className="text-muted-foreground">{t('common.output')}</dt>
                                  <dd className="tabular-nums">
                                    {t('catalog.stdoutStderr', {
                                      stdoutBytes: formatBytes(job.stdoutBytes),
                                      stderrBytes: formatBytes(job.stderrBytes),
                                    })}
                                  </dd>
                                  {job.code !== undefined && (
                                    <>
                                      <dt className="text-muted-foreground">{t('catalog.code')}</dt>
                                      <dd className="tabular-nums">{job.code}</dd>
                                    </>
                                  )}
                                  {job.signal !== undefined && (
                                    <>
                                      <dt className="text-muted-foreground">{t('catalog.signal')}</dt>
                                      <dd className="tabular-nums">{job.signal}</dd>
                                    </>
                                  )}
                                  {job.logs.length > 0 && (
                                    <>
                                      <dt className="text-muted-foreground">{t('catalog.logs')}</dt>
                                      <dd className="font-mono break-all">{job.logs.join(', ')}</dd>
                                    </>
                                  )}
                                  {job.logsError && (
                                    <>
                                      <dt className="text-muted-foreground">{t('catalog.logCopy')}</dt>
                                      <dd className="break-all text-destructive">{job.logsError}</dd>
                                    </>
                                  )}
                                </dl>
                              </CollapsibleContent>
                            </Collapsible>
                          </li>
                        )
                      })}
                    </ul>
                  </ScrollArea>
                </CollapsibleContent>
              </Collapsible>
            </section>

            {refresh.refusal ? (
              <p role="alert" className="text-xs text-pretty text-destructive">
                {t('catalog.refreshRefused', { refusal: refresh.refusal })}
              </p>
            ) : refreshAnswer && !refreshAnswer.ok ? (
              <p role="alert" className="text-xs text-pretty text-destructive">
                {t('catalog.couldNotRefresh', { text: refreshAnswer.text })}
              </p>
            ) : null}

            {stop.refusal ? (
              <p role="alert" className="text-xs text-pretty text-destructive">
                {t('catalog.stopRefused', { refusal: stop.refusal })}
              </p>
            ) : stop.pending ? (
              <p role="status" className="text-xs text-muted-foreground">
                {t('catalog.stopRequested')}
              </p>
            ) : stopAnswer && !stopAnswer.ok ? (
              <p role="alert" className="text-xs text-pretty text-destructive">
                {t('catalog.couldNotStop', { text: stopAnswer.text })}
              </p>
            ) : null}
          </>
        )}
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('catalog.stopThisJob')}</AlertDialogTitle>
            <AlertDialogDescription className="font-mono break-all">
              {confirmCommand}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={stopConfirmed}>
              {t('common.stop')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export default JobsView
