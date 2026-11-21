// The error above the composer, after ZCode's ChatErrorBanner: one line on a surface (its
// icon and its message), then its actions. Without an API key, only « Configurer » (the
// model settings). Otherwise « Afficher les détails » (a dialog with the engine's text) when
// there are details, « Copier » (summary and details), « Réessayer » when the caller can run
// the message again, and the close button.
import { useState } from 'react'
import { AnchorIcon, CopyIcon, InfoIcon, SettingsIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '$lib/components/ui/dialog'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { cn } from '$lib/utils'
import { chatErrorCopyText, type ChatErrorView } from './chat-error'

export interface ChatErrorBannerProps {
  error: ChatErrorView
  onRetry?: () => void
  retryDisabled?: boolean
  onDismiss?: () => void
  onOpenModelSettings?: () => void
}

/** ZCode's outline `sm` button: 24 px high, transparent until hover. */
const ACTION =
  'h-6 shrink-0 gap-1 rounded-md bg-transparent px-2 text-ui hover:bg-element-hover dark:border-border dark:bg-transparent dark:hover:bg-element-hover'
const ICON_ACTION =
  'size-6 shrink-0 rounded-md bg-transparent hover:bg-element-hover dark:border-border dark:bg-transparent dark:hover:bg-element-hover'

export function ChatErrorBanner({
  error,
  onRetry,
  retryDisabled = false,
  onDismiss,
  onOpenModelSettings,
}: ChatErrorBannerProps) {
  useLanguage()
  const [detailsOpen, setDetailsOpen] = useState(false)

  async function copy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      toast(t('chat.error.copyFailed', { error: 'clipboard-unavailable' }))
      return
    }
    try {
      await navigator.clipboard.writeText(chatErrorCopyText(error))
      toast(t('chat.error.copied'))
    } catch (e) {
      toast(t('chat.error.copyFailed', { error: e instanceof Error ? e.message : String(e) }))
    }
  }

  return (
    <div className="flex w-full justify-center">
      <div
        role="alert"
        data-slot="chat-error-banner"
        className="flex w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 backdrop-blur-md"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 text-ui text-foreground">
          {error.hookBlocked ? (
            <AnchorIcon className="size-4 shrink-0" aria-hidden="true" data-slot="chat-error-hook-icon" />
          ) : (
            <InfoIcon className="size-4 shrink-0" aria-hidden="true" />
          )}
          <div className="min-w-0 truncate font-medium" title={error.message}>
            {error.message}
          </div>
        </div>

        {error.modelConfigMissing && onOpenModelSettings && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(ACTION, 'gap-1.5')}
            aria-label={t('chat.error.setModels')}
            onClick={onOpenModelSettings}
          >
            <SettingsIcon className="size-3.5" aria-hidden="true" />
            {t('chat.error.setModels')}
          </Button>
        )}

        {!error.modelConfigMissing && error.detail && (
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={ACTION}
              data-slot="chat-error-details-button"
              onClick={() => setDetailsOpen(true)}
            >
              {t('chat.error.showDetails')}
            </Button>
            <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle className="whitespace-pre-wrap">{error.message}</DialogTitle>
                  <DialogDescription>{t('chat.error.showDetails')}</DialogDescription>
                </DialogHeader>
                <ScrollArea
                  orientation="both"
                  className="rounded-xl border border-border bg-surface"
                  viewportClass="max-h-[60vh]"
                >
                  <pre className="px-3 py-2 text-ui whitespace-pre-wrap text-muted-foreground">{error.detail}</pre>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          </>
        )}

        {!error.modelConfigMissing && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn(ACTION, 'gap-1.5')}
            aria-label={t('chat.error.copy')}
            onClick={() => void copy()}
          >
            <CopyIcon className="size-3.5" aria-hidden="true" />
            {t('chat.error.copy')}
          </Button>
        )}

        {!error.modelConfigMissing && onRetry && (
          <Button type="button" variant="outline" size="sm" className={ACTION} disabled={retryDisabled} onClick={onRetry}>
            {t('chat.error.retry')}
          </Button>
        )}

        {onDismiss && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            className={ICON_ACTION}
            title={t('chat.error.dismiss')}
            aria-label={t('chat.error.dismiss')}
            onClick={onDismiss}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>
    </div>
  )
}

export default ChatErrorBanner
