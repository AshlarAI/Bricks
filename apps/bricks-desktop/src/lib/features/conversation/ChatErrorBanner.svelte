<script lang="ts">
  // The error above the composer, after ZCode's ChatErrorBanner: one line on a surface (its
  // icon and its message), then its actions. Without an API key, only « Configurer » (the
  // model settings). Otherwise « Afficher les détails » (a dialog with the engine's text) when
  // there are details, « Copier » (summary and details), « Réessayer » when the caller can run
  // the message again, and the close button.
  import { t } from '$lib/i18n/i18n.svelte'
  import AnchorIcon from '@lucide/svelte/icons/anchor'
  import CopyIcon from '@lucide/svelte/icons/copy'
  import InfoIcon from '@lucide/svelte/icons/info'
  import SettingsIcon from '@lucide/svelte/icons/settings'
  import XIcon from '@lucide/svelte/icons/x'
  import { toast } from 'svelte-sonner'
  import { Button } from '$lib/components/ui/button'
  import * as Dialog from '$lib/components/ui/dialog'
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  import { cn } from '$lib/utils'
  import { chatErrorCopyText, type ChatErrorView } from './chat-error'

  let {
    error,
    onRetry,
    retryDisabled = false,
    onDismiss,
    onOpenModelSettings,
  }: {
    error: ChatErrorView
    onRetry?: () => void
    retryDisabled?: boolean
    onDismiss?: () => void
    onOpenModelSettings?: () => void
  } = $props()

  let detailsOpen = $state(false)

  /** ZCode's outline `sm` button: 24 px high, transparent until hover. */
  const ACTION = 'h-6 shrink-0 gap-1 rounded-md bg-transparent px-2 text-ui hover:bg-element-hover dark:border-border dark:bg-transparent dark:hover:bg-element-hover'
  const ICON_ACTION = 'size-6 shrink-0 rounded-md bg-transparent hover:bg-element-hover dark:border-border dark:bg-transparent dark:hover:bg-element-hover'

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
</script>

<div class="flex w-full justify-center">
  <div
    role="alert"
    data-slot="chat-error-banner"
    class="flex w-full flex-wrap items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 backdrop-blur-md"
  >
    <div class="flex min-w-0 flex-1 items-center gap-2 text-ui text-foreground">
      {#if error.hookBlocked}
        <AnchorIcon class="size-4 shrink-0" aria-hidden="true" data-slot="chat-error-hook-icon" />
      {:else}
        <InfoIcon class="size-4 shrink-0" aria-hidden="true" />
      {/if}
      <div class="min-w-0 truncate font-medium" title={error.message}>{error.message}</div>
    </div>

    {#if error.modelConfigMissing && onOpenModelSettings}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class={cn(ACTION, 'gap-1.5')}
        aria-label={t('chat.error.setModels')}
        onclick={onOpenModelSettings}
      >
        <SettingsIcon class="size-3.5" aria-hidden="true" />
        {t('chat.error.setModels')}
      </Button>
    {/if}

    {#if !error.modelConfigMissing && error.detail}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class={ACTION}
        data-slot="chat-error-details-button"
        onclick={() => (detailsOpen = true)}
      >
        {t('chat.error.showDetails')}
      </Button>
      <Dialog.Root bind:open={detailsOpen}>
        <Dialog.Content class="sm:max-w-2xl">
          <Dialog.Header>
            <Dialog.Title class="whitespace-pre-wrap">{error.message}</Dialog.Title>
            <Dialog.Description>{t('chat.error.showDetails')}</Dialog.Description>
          </Dialog.Header>
          <ScrollArea orientation="both" class="rounded-xl border border-border bg-surface" viewportClass="max-h-[60vh]">
            <pre class="px-3 py-2 text-ui whitespace-pre-wrap text-muted-foreground">{error.detail}</pre>
          </ScrollArea>
        </Dialog.Content>
      </Dialog.Root>
    {/if}

    {#if !error.modelConfigMissing}
      <Button
        type="button"
        variant="outline"
        size="sm"
        class={cn(ACTION, 'gap-1.5')}
        aria-label={t('chat.error.copy')}
        onclick={() => void copy()}
      >
        <CopyIcon class="size-3.5" aria-hidden="true" />
        {t('chat.error.copy')}
      </Button>
    {/if}

    {#if !error.modelConfigMissing && onRetry}
      <Button type="button" variant="outline" size="sm" class={ACTION} disabled={retryDisabled} onclick={onRetry}>
        {t('chat.error.retry')}
      </Button>
    {/if}

    {#if onDismiss}
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        class={ICON_ACTION}
        title={t('chat.error.dismiss')}
        aria-label={t('chat.error.dismiss')}
        onclick={onDismiss}
      >
        <XIcon class="size-4" aria-hidden="true" />
      </Button>
    {/if}
  </div>
</div>
