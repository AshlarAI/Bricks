// Clearing the active context (`/clear`). Says what it does and does not do,
// asks for the confirmation, then shows the engine's answer.
import { useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { useUi, type InspectorState } from '$lib/state/ui'
import { app, useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import { Button } from '$lib/components/ui/button'
import { Alert, AlertDescription } from '$lib/components/ui/alert'
import { Spinner } from '$lib/components/ui/spinner'

export function ClearView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const ui = useUi()
  const conv = useApp((s) => s.current)
  useConversation(conv)
  const busy = conv ? conv.running || conv.busy !== null : false

  /**
   * The request sent: the `lastClear` and the last rejection seen at that time.
   * The answer is a newer `lastClear` (set by `context_cleared`), or a
   * `command_rejected` for `clear_context` newer than the rejection seen.
   */
  const [sent, setSent] = useState<{ clearedAt: number | null; rejectionAt: number | null } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const cleared = (() => {
    const c = conv?.lastClear
    if (!sent || !c) return null
    return sent.clearedAt === null || c.at > sent.clearedAt ? c : null
  })()

  const refusal = (() => {
    const r = conv?.lastRejection
    if (!sent || !r || r.command !== 'clear_context') return null
    return sent.rejectionAt === null || r.at > sent.rejectionAt ? r.reason : null
  })()

  const pending = sent !== null && cleared === null && refusal === null

  async function clear() {
    const current = app.current
    if (!current) return
    setActionError(null)
    setSent({
      clearedAt: current.lastClear?.at ?? null,
      rejectionAt: current.lastRejection?.at ?? null,
    })
    const refused = await app.command(current.sessionId, { type: 'clear_context' })
    if (refused !== null) {
      setSent(null)
      setActionError(refused)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      {!conv ? (
        <p className="text-sm text-muted-foreground">{t('common.noOpenConversation')}</p>
      ) : (
        <>
          {conv.running ? (
            <Alert>
              <AlertDescription>{t('inspect.notPossibleDuringARun')}</AlertDescription>
            </Alert>
          ) : conv.busy !== null ? (
            <Alert>
              <AlertDescription>{t('inspect.anOperationIsInProgress')}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
            {cleared !== null ? (
              <>
                <p className="text-sm text-pretty">
                  {t('inspect.contextCleared', { count: cleared.messagesRemoved })}
                </p>
                <Button variant="outline" onClick={() => ui.close()}>
                  {t('common.close')}
                </Button>
              </>
            ) : pending ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Spinner aria-hidden="true" />
                {t('inspect.clearRequestedWaitingForTheEngines')}
              </p>
            ) : (
              <>
                <Button onClick={() => void clear()} disabled={busy}>
                  {t('common.clearContext')}
                </Button>
                <Button variant="ghost" onClick={() => ui.close()}>
                  {t('common.cancel')}
                </Button>
              </>
            )}
          </div>

          {refusal !== null && (
            <p role="alert" className="text-sm text-destructive">
              {t('inspect.clearRefused', { refusal })}
            </p>
          )}
          {actionError && (
            <p role="alert" className="text-sm text-destructive">
              {actionError}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default ClearView
