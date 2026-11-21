import { useState } from 'react'
import { ShieldAlertIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { app } from '$lib/state/app'
import type { Conversation } from '$lib/state/conversation'
import type { Command } from '$lib/ipc/engine'

export interface SkillsTrustBannerProps {
  conversation: Conversation
  trust: NonNullable<Conversation['skillsTrust']>
}

export function SkillsTrustBanner({ conversation, trust }: SkillsTrustBannerProps) {
  useLanguage()
  const [sending, setSending] = useState<boolean | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  async function answer(allow: boolean) {
    if (sending !== null) return
    setSending(allow)
    setRefusal(null)
    const message: string | null = await app.command(conversation.sessionId, {
      type: 'trust_project_skills',
      allow,
    } satisfies Command)
    if (message) {
      setRefusal(message)
      setSending(null)
    }
  }

  return (
    <section
      aria-label={t('common.projectSkills')}
      className="flex flex-col gap-2.5 rounded-lg border border-warning/40 bg-card p-3 text-sm text-card-foreground"
    >
      <header className="flex items-center gap-2">
        <ShieldAlertIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
        <h2 className="font-medium">{t('conversation.projectSkillsToAllow')}</h2>
      </header>
      <p className="text-xs text-muted-foreground break-words">
        {t('conversation.thisProjectProvidesSkillsUntilThey')}
      </p>
      <ul className="flex flex-col gap-1 text-xs">
        {trust.sources.map((source, i) => (
          <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-medium">{source.source}</span>
            <span className="min-w-0 break-all font-mono text-muted-foreground">{source.path}</span>
            <span className="text-muted-foreground">{t('common.skillCount', { count: source.skills })}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={sending !== null} onClick={() => void answer(true)}>
          {t('conversation.allowProjectSkills')}
        </Button>
        <Button size="sm" variant="outline" disabled={sending !== null} onClick={() => void answer(false)}>
          {t('common.refuse')}
        </Button>
      </div>
      {sending !== null && refusal === null && (
        <p className="text-xs text-muted-foreground" role="status">
          {t('conversation.answerSent')}
        </p>
      )}
      {refusal && (
        <p className="text-xs text-destructive break-words" role="alert">
          {refusal}
        </p>
      )}
    </section>
  )
}

export default SkillsTrustBanner
