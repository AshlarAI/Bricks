// Session inspector (`/session`): identifier, title, folder, model and effort
// (requested and applied), activity, memory space, approvals.
import { useEffect, useRef, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { errorMessage, sessionSnapshot } from '$lib/ipc/client'
import type { Snapshot } from '$lib/ipc/engine'
import EmptyState from '$lib/layout/EmptyState'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import type { InspectorState } from '$lib/state/ui'
import { displayTitle } from '$lib/features/navigation/format'
import { activityLabel } from './format'

// Opened without options: the view shows the conversation on screen.
export function SessionView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  const sessionId = conv?.sessionId ?? null
  const running = conv?.running ?? false
  const busy = conv?.busy ?? null

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)

  /** Only the newest read may write the view (a slower earlier one is dropped). */
  const loadTokenRef = useRef(0)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  // Read on open, then again when a run or a command starts or ends, since the
  // activity and the approvals come from the engine's snapshot.
  useEffect(() => {
    if (!sessionId) {
      loadTokenRef.current += 1
      setSnapshot(null)
      setLoadError(null)
      return
    }
    const token = ++loadTokenRef.current
    void sessionSnapshot(sessionId).then(
      (next) => {
        if (token !== loadTokenRef.current) return
        setSnapshot(next)
        setLoadError(null)
      },
      (e: unknown) => {
        if (token !== loadTokenRef.current) return
        setLoadError(errorMessage(e))
      },
    )
    return () => {
      loadTokenRef.current += 1
    }
  }, [sessionId, running, busy])

  async function copyId() {
    if (!sessionId) return
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(sessionId)
      setCopied(true)
      clearTimeout(copyTimerRef.current)
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyError(t('sessionInfo.couldNotCopySelectTheIdentifier'))
    }
  }

  if (!conv || !sessionId) {
    return <EmptyState title={t('common.noOpenConversation2')} />
  }

  const activity = snapshot ? activityLabel(snapshot.activity) : t('common.loading')

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-3 text-sm">
        <dt className="text-muted-foreground">{t('common.identifier')}</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <code className="min-w-0 break-all font-mono text-xs select-all">{sessionId}</code>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => void copyId()}
            aria-label={copied ? t('sessionInfo.identifierCopied') : t('sessionInfo.copyTheIdentifier')}
          >
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
          </Button>
        </dd>

        <dt className="text-muted-foreground">{t('sessionInfo.title')}</dt>
        <dd className="min-w-0 break-words">{displayTitle(conv.title)}</dd>

        <dt className="text-muted-foreground">{t('common.folder')}</dt>
        <dd className="min-w-0 font-mono text-xs break-all">
          {conv.workingDir || t('common.unknownValue')}
        </dd>

        <dt className="text-muted-foreground">{t('common.model')}</dt>
        <dd className="min-w-0 font-mono text-xs break-all">{conv.model || t('common.unknownValue')}</dd>

        <dt className="text-muted-foreground">{t('sessionInfo.effort')}</dt>
        <dd>{conv.effectiveReasoning ?? t('common.noValue')}</dd>

        <dt className="text-muted-foreground">{t('sessionInfo.activity')}</dt>
        <dd>{activity}</dd>

        <dt className="text-muted-foreground">{t('sessionInfo.memorySpace')}</dt>
        <dd className="min-w-0 break-words">
          {snapshot ? snapshot.memory_space ?? t('sessionInfo.noneLongTermMemoryDisabled') : t('common.loading')}
        </dd>

        <dt className="text-muted-foreground">{t('sessionInfo.approvals')}</dt>
        <dd>
          {snapshot
            ? snapshot.interactive
              ? t('sessionInfo.askedOfAPerson')
              : t('sessionInfo.nobodyToAnswerActionsNeedingApproval')
            : t('common.loading')}
        </dd>
      </dl>

      {copyError && (
        <p role="alert" className="text-sm text-destructive">
          {copyError}
        </p>
      )}
      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          {t('sessionInfo.couldNotReadTheSession', { loadError })}
        </p>
      )}
    </div>
  )
}

export default SessionView
