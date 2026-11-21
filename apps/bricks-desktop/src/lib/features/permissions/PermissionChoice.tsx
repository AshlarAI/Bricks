// The first choice of permissions, above the composer, while the conversation's
// policy is not chosen. The choice applies to this conversation and becomes the
// one new conversations start from. CUSTOM opens the configuration to edit it.
import { useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { ShieldQuestionIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import type { PermissionProfile } from '$lib/ipc/engine'
import { app } from '$lib/state/app'
import { useConversation, type Conversation } from '$lib/state/conversation'
import { ui } from '$lib/state/ui'
import { PROFILE_OPTIONS, withProfile } from './policy'

export interface PermissionChoiceProps {
  conversation: Conversation | null
}

export function PermissionChoice({ conversation }: PermissionChoiceProps) {
  useLanguage()
  const permissions = useConversation(conversation, (c) => c.permissions)
  const policy = permissions?.policy ?? null
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  if (!conversation || !policy || policy.chosen) return null

  async function choose(profile: PermissionProfile) {
    if (!conversation || !policy || sending) return
    setSending(true)
    const err = await app.setPermissions(conversation.sessionId, withProfile(policy, profile), true)
    setRefusal(err)
    setSending(false)
    if (!err && profile === 'custom') ui.open('config')
  }

  return (
    <section
      aria-labelledby="permission-choice"
      className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-2 text-sm"
    >
      <ShieldQuestionIcon className="size-4 shrink-0 text-warning" aria-hidden="true" />
      <h2 id="permission-choice" className="font-medium">
        {t('common.permissions')}
      </h2>
      <div className="flex flex-wrap gap-1.5">
        {PROFILE_OPTIONS.map((option) => (
          <Button
            key={option.value}
            size="sm"
            variant="outline"
            disabled={sending}
            title={option.detail}
            onClick={() => void choose(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
      {refusal && (
        <p role="alert" className="basis-full text-xs break-words text-destructive">
          {refusal}
        </p>
      )}
    </section>
  )
}

export default PermissionChoice
