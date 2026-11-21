import { useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { toast } from 'sonner'
import {
  ArrowDownToLineIcon,
  CheckCircle2Icon,
  RotateCcwIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Alert, AlertDescription } from '$lib/components/ui/alert'
import { Button } from '$lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '$lib/components/ui/dialog'
import { Progress } from '$lib/components/ui/progress'
import { Spinner } from '$lib/components/ui/spinner'
import { t, useLanguage } from '$lib/i18n/i18n'
import { errorMessage } from '$lib/ipc/client'
import { app, useApp } from '$lib/state/app'
import { downloadPercent, formatDownloadProgress, formatPubDate, metadataOf } from './updates'

export interface UpdateDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UpdateDialog({ open, onOpenChange }: UpdateDialogProps) {
  useLanguage()
  const status = useApp((s) => s.updateStatus)
  const hasActiveRuns = useApp((s) => s.hasActiveRuns)
  const infoVersion = useApp((s) => s.info?.version ?? '')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const meta = metadataOf(status)
  const pubDate = formatPubDate(meta?.pub_date)
  const percent =
    status.phase === 'downloading'
      ? downloadPercent(status.downloaded_bytes, status.total_bytes)
      : null
  const progressText =
    status.phase === 'downloading'
      ? formatDownloadProgress(status.downloaded_bytes, status.total_bytes)
      : ''

  async function handleCheck() {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await app.checkForUpdates()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload() {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await app.downloadUpdate()
    } catch (e) {
      const msg = errorMessage(e)
      setActionError(msg)
      toast.error(t('updates.checkFailed', { message: msg }))
    } finally {
      setBusy(false)
    }
  }

  async function handleCancel() {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await app.cancelUpdateDownload()
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleIgnore() {
    if (busy || !meta) return
    setBusy(true)
    setActionError(null)
    try {
      await app.ignoreUpdate(meta.version)
      onOpenChange(false)
    } catch (e) {
      const msg = errorMessage(e)
      setActionError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  async function handleInstall() {
    if (busy) return
    setBusy(true)
    setActionError(null)
    try {
      await app.installUpdate()
    } catch (e) {
      const msg = errorMessage(e)
      setActionError(msg)
      toast.error(msg)
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {status.phase === 'downloading' && meta ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('updates.downloadingTitle', { version: meta.version })}</DialogTitle>
              <DialogDescription>
                {t('updates.versionTransition', {
                  current: meta.current_version,
                  next: meta.version,
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 py-2">
              <Progress
                value={percent ?? 100}
                max={100}
                className={percent == null ? 'animate-pulse' : undefined}
              />
              <p className="text-ui text-muted-foreground tabular-nums">
                {t('updates.downloadProgress', { version: meta.version, progress: progressText })}
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => void handleCancel()}>
                {t('updates.cancelDownload')}
              </Button>
              <Button onClick={() => onOpenChange(false)}>{t('updates.background')}</Button>
            </DialogFooter>
          </>
        ) : status.phase === 'ready' && meta ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('updates.readyTitle', { version: meta.version })}</DialogTitle>
              <DialogDescription>
                {t('updates.versionTransition', {
                  current: meta.current_version,
                  next: meta.version,
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-1">
              <p className="text-ui text-foreground">{t('updates.readyPrompt', { version: meta.version })}</p>
              {hasActiveRuns && (
                <Alert variant="warning">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertDescription>{t('updates.activeAgentWarning')}</AlertDescription>
                </Alert>
              )}
              {actionError && (
                <Alert variant="destructive">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertDescription>{actionError}</AlertDescription>
                </Alert>
              )}
            </div>
            <DialogFooter>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                {t('updates.later')}
              </Button>
              <Button disabled={busy} onClick={() => void handleInstall()}>
                {busy ? (
                  <Spinner data-icon="inline-start" />
                ) : (
                  <RotateCcwIcon aria-hidden="true" data-icon="inline-start" />
                )}
                {t('updates.restartToUpdate')}
              </Button>
            </DialogFooter>
          </>
        ) : meta ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('updates.title')}</DialogTitle>
              <DialogDescription>
                {t('updates.versionTransition', {
                  current: meta.current_version,
                  next: meta.version,
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-1">
              {pubDate && (
                <p className="text-xs text-muted-foreground">{t('updates.publishedOn', { date: pubDate })}</p>
              )}
              <ScrollArea className="rounded-md border border-border bg-muted/40" viewportClass="max-h-56">
                <div className="p-3 text-ui whitespace-pre-wrap text-foreground">
                  {meta.notes?.trim() || t('updates.noReleaseNotes')}
                </div>
              </ScrollArea>
              {status.phase === 'error' ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertDescription>{t('updates.checkFailed', { message: status.message })}</AlertDescription>
                </Alert>
              ) : actionError ? (
                <Alert variant="destructive">
                  <TriangleAlertIcon aria-hidden="true" />
                  <AlertDescription>{actionError}</AlertDescription>
                </Alert>
              ) : null}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" disabled={busy} onClick={() => void handleIgnore()}>
                {t('updates.ignoreVersion')}
              </Button>
              <div className="flex items-center gap-2">
                <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                  {t('updates.later')}
                </Button>
                <Button disabled={busy} onClick={() => void handleDownload()}>
                  {busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <ArrowDownToLineIcon aria-hidden="true" data-icon="inline-start" />
                  )}
                  {status.phase === 'error' ? t('updates.retry') : t('updates.download')}
                </Button>
              </div>
            </DialogFooter>
          </>
        ) : status.phase === 'checking' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('updates.title')}</DialogTitle>
              <DialogDescription>{t('updates.checkingHint')}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2.5 py-3 text-ui text-muted-foreground">
              <Spinner />
              <span>{t('updates.checking')}</span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
            </DialogFooter>
          </>
        ) : status.phase === 'error' ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('updates.title')}</DialogTitle>
            </DialogHeader>
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertDescription>{t('updates.checkFailed', { message: status.message })}</AlertDescription>
            </Alert>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
              <Button disabled={busy} onClick={() => void handleCheck()}>
                {t('updates.retry')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('updates.title')}</DialogTitle>
              <DialogDescription>{t('updates.currentVersionHint', { version: infoVersion })}</DialogDescription>
            </DialogHeader>
            <div className="flex items-center gap-2 py-2 text-ui text-foreground">
              <CheckCircle2Icon aria-hidden="true" className="size-4 text-emerald-600" />
              <span>{t('updates.upToDate')}</span>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {t('common.close')}
              </Button>
              <Button disabled={busy} onClick={() => void handleCheck()}>
                {t('updates.checkForUpdates')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default UpdateDialog
