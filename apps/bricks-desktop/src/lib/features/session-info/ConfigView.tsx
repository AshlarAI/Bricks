// Effective configuration of the session (`/config`): model, permissions
// (edited here), memory, sub-agents, configuration files read, other settings. Shows no key
// and no authentication header: the engine never sends them.
import { useEffect, useRef, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import PolicyEditor from '$lib/features/permissions/PolicyEditor'
import {
  errorMessage,
  sessionConfig,
  sessionTools,
  type SessionConfigInfo,
} from '$lib/ipc/client'
import type { SessionPolicy } from '$lib/ipc/engine'
import EmptyState from '$lib/layout/EmptyState'
import SectionCard from '$lib/layout/SectionCard'
import { app, useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import type { InspectorState } from '$lib/state/ui'

function ConfigField({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{value}</dd>
    </>
  )
}

// Opened without options: the view shows the conversation on screen.
export function ConfigView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  const sessionId = conv?.sessionId ?? null
  const running = conv?.running ?? false
  const permissionsRevision = conv?.permissions?.revision ?? null

  const [config, setConfig] = useState<SessionConfigInfo | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toolNames, setToolNames] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  /** The policy in force: the latest the conversation saw, else the one read. */
  const policy = conv?.permissions?.policy ?? config?.permission_policy ?? null

  /** Only the newest read may write the view (a slower earlier one is dropped). */
  const loadTokenRef = useRef(0)

  // Read on open, and again when a run ends or the policy changes.
  useEffect(() => {
    if (!sessionId) {
      loadTokenRef.current += 1
      setConfig(null)
      setLoadError(null)
      return
    }
    const token = ++loadTokenRef.current
    void Promise.all([sessionConfig(sessionId), sessionTools(sessionId)]).then(
      ([next, tools]) => {
        if (token !== loadTokenRef.current) return
        setConfig(next)
        setToolNames(tools.map((tool) => tool.name))
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
  }, [sessionId, running, permissionsRevision])

  /** Sends the change; the editor follows once the engine reports it. */
  async function change(next: SessionPolicy) {
    if (!sessionId) return
    setSaving(true)
    const nextRefusal = await app.setPermissions(sessionId, next)
    setRefusal(nextRefusal)
    setSaving(false)
  }

  if (!conv || !sessionId) {
    return <EmptyState title={t('common.noOpenConversation2')} />
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('sessionInfo.couldNotReadTheConfiguration', { loadError })}
      </p>
    )
  }

  if (!config) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('sessionInfo.loadingTheConfiguration')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <SectionCard title={t('common.model')}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 px-3 pb-3 text-sm">
          <ConfigField label={t('sessionInfo.provider')} value={config.provider || t('common.unknownValue')} />
          <ConfigField label={t('common.model')} value={config.model || t('common.unknownValue')} />
          <ConfigField label={t('sessionInfo.effort')} value={config.effective_reasoning ?? t('common.noValue')} />
          <ConfigField label={t('sessionInfo.workingFolder')} value={config.working_dir} />
        </dl>
      </SectionCard>

      <SectionCard title={t('common.permissions')}>
        <div className="flex flex-col gap-4 px-3 pb-3 text-sm">
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2">
            <ConfigField
              label={t('sessionInfo.approvals')}
              value={config.interactive ? t('sessionInfo.asked') : t('sessionInfo.refused')}
            />
          </dl>

          {policy && <PolicyEditor policy={policy} tools={toolNames} disabled={saving} onchange={change} />}
          {refusal && (
            <p role="alert" className="text-xs break-words text-destructive">
              {refusal}
            </p>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t('common.memory')}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 px-3 pb-3 text-sm">
          <ConfigField label={t('sessionInfo.workspace')} value={config.memory_space ?? t('sessionInfo.disabled')} />
        </dl>
      </SectionCard>

      <SectionCard title={t('common.agents')}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 px-3 pb-3 text-sm">
          <ConfigField
            label={t('common.subAgents')}
            value={config.agents_enabled ? t('sessionInfo.enabled') : t('sessionInfo.disabled2')}
          />
        </dl>
      </SectionCard>

      <SectionCard title={t('sessionInfo.sources')} count={config.sources.length}>
        <div className="flex flex-col gap-2 px-3 pb-3 text-sm">
          {config.sources.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {config.sources.map((source, i) => (
                <li key={i} className="font-mono text-xs break-all">
                  {source}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">{t('sessionInfo.noFileRead')}</p>
          )}
        </div>
      </SectionCard>

      <SectionCard title={t('sessionInfo.otherSettings')} count={config.settings.length}>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-6 gap-y-2 px-3 pb-3 text-sm">
          {config.settings.map((entry, i) => (
            <ConfigField key={i} label={entry.label} value={entry.value} />
          ))}
        </dl>
      </SectionCard>
    </div>
  )
}

export default ConfigView
