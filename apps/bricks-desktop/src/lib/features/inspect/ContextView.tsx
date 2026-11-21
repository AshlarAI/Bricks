// Context occupation (`/context`, `/ctx`): the same line as the context card
// (contextView.ts), and explicit compaction and clearing.
import { useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { useUi, type InspectorState } from '$lib/state/ui'
import { app, useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import { Button } from '$lib/components/ui/button'
import { contextLine } from '$lib/features/context/contextView'

export function ContextView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const ui = useUi()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  const status = conv?.context ?? null
  const stale = conv?.contextStale ?? false
  const line = contextLine(status, stale)
  const busy = conv ? conv.running || conv.busy !== null : false

  // Compaction: the answer is the `compaction` event newer than the request,
  // or a `command_rejected` for `compact` newer than the last rejection seen.
  const [compactSent, setCompactSent] = useState<{ compactAt: number | null; refusedAt: number | null } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const compactDone = (() => {
    const c = conv?.lastCompaction
    if (!compactSent || !c) return null
    return compactSent.compactAt === null || c.at > compactSent.compactAt ? c : null
  })()

  const compactRefused = (() => {
    const r = conv?.lastRejection
    if (!compactSent || !r || r.command !== 'compact') return null
    return compactSent.refusedAt === null || r.at > compactSent.refusedAt ? r.reason : null
  })()

  const compactPending = compactSent !== null && compactDone === null && compactRefused === null

  async function compact() {
    const current = app.current
    if (!current) return
    setActionError(null)
    setCompactSent({
      compactAt: current.lastCompaction?.at ?? null,
      refusedAt: current.lastRejection?.at ?? null,
    })
    const refused = await app.command(current.sessionId, { type: 'compact' })
    if (refused !== null) {
      setCompactSent(null)
      setActionError(refused)
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="flex flex-col gap-1" aria-label={t('inspect.contextUsage')}>
        <p className="text-base font-medium tabular-nums">{line}</p>
      </section>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => void compact()} disabled={busy || compactPending}>
          {compactPending ? t('common.compacting') : t('inspect.compactNow')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => ui.open('clear')}>
          {t('inspect.clearContext')}
        </Button>
      </div>

      <div className="flex flex-col gap-2 text-sm" role="status" aria-live="polite">
        {compactPending ? (
          <p className="text-muted-foreground">{t('inspect.compactionWaitingForTheEnginesAnswer')}</p>
        ) : compactRefused !== null ? (
          <p role="alert" className="text-destructive">
            {t('inspect.compactionRefused', { compactRefused })}
          </p>
        ) : compactDone ? (
          <p>
            {compactDone.compacted ? t('inspect.contextCompacted') : t('inspect.contextNotCompacted')}{' '}
            <span className="text-muted-foreground">
              {t('inspect.engineResult', { outcome: compactDone.outcome })}
            </span>
          </p>
        ) : null}
        {actionError && (
          <p role="alert" className="text-destructive">
            {actionError}
          </p>
        )}
      </div>
    </div>
  )
}

export default ContextView
