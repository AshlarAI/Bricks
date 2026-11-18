<script lang="ts">
  // The card of a web link in a reply (shadcn-svelte HoverCard): its title, its summary and its
  // site. One card serves every link of the message: it opens on the link under the pointer or
  // the focus, after a short delay, and stays while the pointer is over it.
  import { t } from '$lib/i18n/i18n.svelte'
  import { openUrl } from '@tauri-apps/plugin-opener'
  import ExternalLink from '@lucide/svelte/icons/external-link'
  import { Button } from '$lib/components/ui/button'
  import * as HoverCard from '$lib/components/ui/hover-card'
  import { citationHost, citationKey, isCitable, type CitationSource } from './citations'

  let {
    sources,
    streaming = false,
    onLinkResult,
  }: {
    /** While the text streams, links are not live yet: no card. */
    streaming?: boolean
    /** Pages the conversation's web searches returned, by `citationKey`. */
    sources?: ReadonlyMap<string, CitationSource>
    onLinkResult?: (error: string | null) => void
  } = $props()

  const OPEN_DELAY = 250
  const CLOSE_DELAY = 150

  let open = $state(false)
  let anchor = $state<HTMLAnchorElement | null>(null)
  let openTimer: ReturnType<typeof setTimeout> | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  const url = $derived(anchor?.getAttribute('href') ?? '')
  const source = $derived(url ? sources?.get(citationKey(url)) : undefined)
  const host = $derived(citationHost(url))
  const title = $derived(source?.title || anchor?.textContent?.trim() || host)

  function citation(target: EventTarget | null): HTMLAnchorElement | null {
    return target instanceof Element ? target.closest<HTMLAnchorElement>('a[data-citation]') : null
  }

  function show(link: HTMLAnchorElement) {
    if (streaming) return
    clearTimeout(closeTimer)
    clearTimeout(openTimer)
    if (open && anchor === link) return
    openTimer = setTimeout(() => {
      anchor = link
      open = true
    }, OPEN_DELAY)
  }

  function hide() {
    clearTimeout(openTimer)
    clearTimeout(closeTimer)
    closeTimer = setTimeout(() => (open = false), CLOSE_DELAY)
  }

  function keep() {
    clearTimeout(closeTimer)
  }

  /**
   * Attaches the card to a message element (`{@attach card.attach}`): its links are its HTML,
   * not components, so the card listens to the whole message.
   */
  export function attach(node: HTMLElement) {
    const over = (e: Event) => {
      const link = citation(e.target)
      if (link) show(link)
    }
    const out = (e: Event) => {
      const link = citation(e.target)
      const next = (e as PointerEvent | FocusEvent).relatedTarget
      if (link && !(next instanceof Node && link.contains(next))) hide()
    }
    // A re-rendered block replaces its links: the card of a link that left the page closes.
    const watch = new MutationObserver(() => {
      if (open && anchor && !anchor.isConnected) open = false
    })
    watch.observe(node, { childList: true, subtree: true })
    node.addEventListener('pointerover', over)
    node.addEventListener('pointerout', out)
    node.addEventListener('focusin', over)
    node.addEventListener('focusout', out)
    return () => {
      watch.disconnect()
      node.removeEventListener('pointerover', over)
      node.removeEventListener('pointerout', out)
      node.removeEventListener('focusin', over)
      node.removeEventListener('focusout', out)
      clearTimeout(openTimer)
      clearTimeout(closeTimer)
    }
  }

  function visit() {
    open = false
    if (!isCitable(url)) return
    openUrl(url).then(
      () => onLinkResult?.(null),
      (error: unknown) => onLinkResult?.(error instanceof Error ? error.message : String(error)),
    )
  }
</script>

<HoverCard.Root bind:open>
  <HoverCard.Content
    customAnchor={anchor}
    class="flex w-72 flex-col gap-1"
    onpointerenter={keep}
    onpointerleave={hide}
  >
    <div class="font-medium">{title}</div>
    {#if source?.snippet}
      <p class="line-clamp-4 text-muted-foreground">{source.snippet}</p>
    {/if}
    <Button variant="link" size="xs" class="h-auto justify-start p-0 text-muted-foreground" onclick={visit}>
      {host}
      <ExternalLink data-icon="inline-end" />
      <span class="sr-only">{t('conversation.opensInTheBrowser')}</span>
    </Button>
  </HoverCard.Content>
</HoverCard.Root>
