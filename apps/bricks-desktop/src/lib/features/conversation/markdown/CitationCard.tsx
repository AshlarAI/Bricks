// The card of a web link in a reply (shadcn HoverCard): its title, its summary and its
// site. One card serves every link of the message: it opens on the link under the pointer or
// the focus, after a short delay, and stays while the pointer is over it.
import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ExternalLinkIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '$lib/components/ui/hover-card'
import { citationHost, citationKey, isCitable, type CitationSource } from './citations'

export interface CitationCardHandle {
  attach: (node: HTMLElement | null) => (() => void) | void
}

export interface CitationCardProps {
  /** While the text streams, links are not live yet: no card. */
  streaming?: boolean
  /** Pages the conversation's web searches returned, by `citationKey`. */
  sources?: ReadonlyMap<string, CitationSource>
  onLinkResult?: (error: string | null) => void
  ref?: Ref<CitationCardHandle>
}

interface AnchorRect {
  left: number
  top: number
  width: number
  height: number
}

const OPEN_DELAY = 250
const CLOSE_DELAY = 150

function readRect(el: HTMLElement): AnchorRect {
  const rect = el.getBoundingClientRect()
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function citationFrom(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>('a[data-citation]') : null
}

export function CitationCard({
  sources,
  streaming = false,
  onLinkResult,
  ref,
}: CitationCardProps) {
  useLanguage()

  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<HTMLAnchorElement | null>(null)
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null)

  const openRef = useRef(open)
  openRef.current = open
  const anchorRef = useRef(anchor)
  anchorRef.current = anchor
  const streamingRef = useRef(streaming)
  streamingRef.current = streaming

  const openTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const isOverTriggerRef = useRef(false)
  const isOverContentRef = useRef(false)

  const url = anchor?.getAttribute('href') ?? ''
  const source = url ? sources?.get(citationKey(url)) : undefined
  const host = citationHost(url)
  const title = source?.title || anchor?.textContent?.trim() || host

  const clearTimers = useCallback(() => {
    clearTimeout(openTimerRef.current)
    clearTimeout(closeTimerRef.current)
  }, [])

  const closeImmediately = useCallback(() => {
    clearTimers()
    isOverTriggerRef.current = false
    isOverContentRef.current = false
    setOpen(false)
  }, [clearTimers])

  const show = useCallback((link: HTMLAnchorElement) => {
    if (streamingRef.current) return
    isOverTriggerRef.current = true
    clearTimeout(closeTimerRef.current)
    clearTimeout(openTimerRef.current)
    if (openRef.current && anchorRef.current === link) return
    openTimerRef.current = setTimeout(() => {
      if (streamingRef.current || !link.isConnected) return
      setAnchor(link)
      setAnchorRect(readRect(link))
      setOpen(true)
    }, OPEN_DELAY)
  }, [])

  const hide = useCallback(() => {
    clearTimeout(openTimerRef.current)
    clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      if (!isOverTriggerRef.current && !isOverContentRef.current) {
        setOpen(false)
      }
    }, CLOSE_DELAY)
  }, [])

  const keep = useCallback(() => {
    isOverContentRef.current = true
    clearTimeout(closeTimerRef.current)
  }, [])

  const leaveContent = useCallback(() => {
    isOverContentRef.current = false
    hide()
  }, [hide])

  useEffect(() => {
    if (streaming) {
      clearTimers()
      isOverTriggerRef.current = false
      isOverContentRef.current = false
      setOpen(false)
    }
  }, [streaming, clearTimers])

  useEffect(() => {
    if (!open || !anchor) return
    const sync = () => {
      if (!anchor.isConnected) {
        setOpen(false)
        return
      }
      setAnchorRect(readRect(anchor))
    }
    window.addEventListener('scroll', sync, true)
    window.addEventListener('resize', sync)
    return () => {
      window.removeEventListener('scroll', sync, true)
      window.removeEventListener('resize', sync)
    }
  }, [open, anchor])

  useEffect(() => () => clearTimers(), [clearTimers])

  /**
   * Attaches the card to a message element: its links are its HTML,
   * not components, so the card listens to the whole message.
   */
  const attach = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return
      const over = (e: Event) => {
        const link = citationFrom(e.target)
        if (link) show(link)
      }
      const out = (e: Event) => {
        const link = citationFrom(e.target)
        const next = (e as PointerEvent | FocusEvent).relatedTarget
        if (link && !(next instanceof Node && link.contains(next))) {
          isOverTriggerRef.current = false
          hide()
        }
      }
      // A re-rendered block replaces its links: the card of a link that left the page closes.
      const watch = new MutationObserver(() => {
        if (openRef.current && anchorRef.current && !anchorRef.current.isConnected) {
          setOpen(false)
        }
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
        clearTimers()
      }
    },
    [show, hide, clearTimers],
  )

  useImperativeHandle(ref, () => ({ attach }), [attach])

  function handleOpenChange(next: boolean) {
    if (next) {
      setOpen(true)
      return
    }
    if (!isOverTriggerRef.current && !isOverContentRef.current) {
      setOpen(false)
    }
  }

  function visit() {
    setOpen(false)
    if (!isCitable(url)) return
    openUrl(url).then(
      () => onLinkResult?.(null),
      (error: unknown) => onLinkResult?.(error instanceof Error ? error.message : String(error)),
    )
  }

  return (
    <HoverCard open={open} onOpenChange={handleOpenChange} openDelay={OPEN_DELAY} closeDelay={CLOSE_DELAY}>
      <HoverCardTrigger asChild>
        <span
          aria-hidden="true"
          tabIndex={-1}
          style={
            anchorRect
              ? {
                  position: 'fixed',
                  left: anchorRect.left,
                  top: anchorRect.top,
                  width: anchorRect.width,
                  height: anchorRect.height,
                  pointerEvents: 'none',
                }
              : { display: 'none' }
          }
        />
      </HoverCardTrigger>
      <HoverCardContent
        className="flex w-72 flex-col gap-1"
        onPointerEnter={keep}
        onPointerLeave={leaveContent}
        onEscapeKeyDown={closeImmediately}
        onPointerDownOutside={closeImmediately}
      >
        <div className="font-medium">{title}</div>
        {source?.snippet && <p className="line-clamp-4 text-muted-foreground">{source.snippet}</p>}
        <Button variant="link" size="xs" className="h-auto justify-start p-0 text-muted-foreground" onClick={visit}>
          {host}
          <ExternalLinkIcon data-icon="inline-end" />
          <span className="sr-only">{t('conversation.opensInTheBrowser')}</span>
        </Button>
      </HoverCardContent>
    </HoverCard>
  )
}

export default CitationCard
