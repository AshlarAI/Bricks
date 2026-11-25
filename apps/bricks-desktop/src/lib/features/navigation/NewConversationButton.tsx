import { useId, useState } from 'react'
import { PlusIcon, useIconHover, type PlusIconHandle } from '$lib/components/icons'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip'
import { app, useApp } from '$lib/state/app'
import { cn } from '$lib/utils'

export interface NewConversationButtonProps {
  className?: string
  size?: 'default' | 'sm'
}

export function NewConversationButton({ className, size = 'default' }: NewConversationButtonProps) {
  useLanguage()
  const uid = useId()
  const hasProviders = useApp((s) => s.hasProviders)
  const chats = useApp((s) => s.chatsProject)
  const [starting, setStarting] = useState(false)
  const plusHover = useIconHover<PlusIconHandle>()

  /** Why a new conversation cannot start, or null when it can. */
  let blockedReason: string | null = null
  if (!hasProviders) {
    blockedReason = t('common.noProviderConfigured')
  } else if (!chats) {
    blockedReason = t('navigation.conversationsUnavailable')
  } else if (chats.missing) {
    blockedReason = t('navigation.theConversationsFolderCantBeFound')
  }

  async function start() {
    if (blockedReason || starting) return
    setStarting(true)
    try {
      await app.newConversation(app.chatsProject?.id)
    } finally {
      setStarting(false)
    }
  }

  return (
    <>
      {/* aria-disabled rather than disabled: the reason stays reachable by hover and by screen readers. */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size={size}
            aria-disabled={blockedReason ? 'true' : undefined}
            aria-describedby={blockedReason ? uid : undefined}
            className={cn('aria-disabled:opacity-50', className)}
            onMouseEnter={plusHover.onMouseEnter}
            onMouseLeave={plusHover.onMouseLeave}
            onClick={() => void start()}
          >
            <PlusIcon ref={plusHover.ref} aria-hidden="true" data-icon="inline-start" />
            {t('common.newConversation')}
          </Button>
        </TooltipTrigger>
        {blockedReason && <TooltipContent side="right">{blockedReason}</TooltipContent>}
      </Tooltip>
      {blockedReason && (
        <span id={uid} className="sr-only">
          {blockedReason}
        </span>
      )}
    </>
  )
}

export default NewConversationButton
