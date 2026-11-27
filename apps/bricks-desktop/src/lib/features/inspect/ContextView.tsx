// Context occupation (`/context`, `/ctx`): the same line as the context card
// (contextView.ts), and explicit compaction and clearing.
import { useState } from 'react'
import { CircleAlertIcon, InfoIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { useUi, type InspectorState } from '$lib/state/ui'
import { app, useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import { Button } from '$lib/components/ui/button'
import { Marker, MarkerContent, MarkerIcon } from '$lib/components/ui/marker'
import { Spinner } from '$lib/components/ui/spinner'
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
          <Marker>
            <MarkerIcon>
              <Spinner aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent className="shimmer motion-reduce:shimmer-none">
              {t('inspect.compactionWaitingForTheEnginesAnswer')}
            </MarkerContent>
          </Marker>
        ) : compactRefused !== null ? (
          <Marker tone="error" role="alert">
            <MarkerIcon>
              <CircleAlertIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>{t('inspect.compactionRefused', { compactRefused })}</MarkerContent>
          </Marker>
        ) : compactDone ? (
          <Marker>
            <MarkerIcon>
              <InfoIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>
              <span className="text-foreground">
                {compactDone.compacted ? t('inspect.contextCompacted') : t('inspect.contextNotCompacted')}
              </span>{' '}
              <span>{t('inspect.engineResult', { outcome: compactDone.outcome })}</span>
            </MarkerContent>
          </Marker>
        ) : null}
        {actionError && (
          <Marker tone="error" role="alert">
            <MarkerIcon>
              <CircleAlertIcon aria-hidden="true" />
            </MarkerIcon>
            <MarkerContent>{actionError}</MarkerContent>
          </Marker>
        )}
      </div>
    </div>
  )
}

export default ContextView
