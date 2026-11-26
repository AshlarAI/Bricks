// Fixed-height vertical line windowing for large source, diff, and code-block views.
import { useCallback, useEffect, useRef, useState } from 'react'

export interface VirtualLinesOptions {
  totalLines: number
  /** Height of one line in CSS pixels. */
  lineHeight?: number
  /** Extra lines rendered above and below the viewport. */
  overscan?: number
  /** Disable windowing for small files or wrapped text. */
  enabled?: boolean
  /** Element that scrolls vertically. */
  scrollElement: HTMLElement | null
}

export interface VirtualLinesWindow {
  startIndex: number
  endIndex: number
  topPadPx: number
  bottomPadPx: number
  /** Call from the scroll container's `onScroll` for immediate rAF-batched updates. */
  onScroll: () => void
}

const DEFAULT_VIEWPORT_HEIGHT = 600

export function useVirtualLines({
  totalLines,
  lineHeight = 20,
  overscan = 24,
  enabled = true,
  scrollElement,
}: VirtualLinesOptions): VirtualLinesWindow {
  const [metrics, setMetrics] = useState({ scrollTop: 0, viewportHeight: DEFAULT_VIEWPORT_HEIGHT })
  const rafRef = useRef<number | null>(null)
  const scrollElRef = useRef<HTMLElement | null>(scrollElement)
  scrollElRef.current = scrollElement

  const measure = useCallback(() => {
    const el = scrollElRef.current
    if (!el) return
    const nextTop = el.scrollTop
    const nextHeight = el.clientHeight || DEFAULT_VIEWPORT_HEIGHT
    setMetrics((prev) =>
      prev.scrollTop === nextTop && prev.viewportHeight === nextHeight
        ? prev
        : { scrollTop: nextTop, viewportHeight: nextHeight },
    )
  }, [])

  const onScroll = useCallback(() => {
    if (!enabled) return
    if (rafRef.current !== null) return
    if (typeof requestAnimationFrame === 'undefined') {
      measure()
      return
    }
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      measure()
    })
  }, [enabled, measure])

  useEffect(() => {
    if (!enabled || !scrollElement) return
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(scrollElement)
    return () => observer.disconnect()
  }, [enabled, scrollElement, measure])

  useEffect(() => {
    return () => {
      if (rafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [])

  if (!enabled || totalLines === 0) {
    return {
      startIndex: 0,
      endIndex: totalLines,
      topPadPx: 0,
      bottomPadPx: 0,
      onScroll,
    }
  }

  const safeLineHeight = Math.max(1, lineHeight)
  const visibleCount = Math.ceil(metrics.viewportHeight / safeLineHeight)
  const firstVisible = Math.floor(metrics.scrollTop / safeLineHeight)
  const startIndex = Math.max(0, firstVisible - overscan)
  const endIndex = Math.min(totalLines, firstVisible + visibleCount + overscan)

  return {
    startIndex,
    endIndex,
    topPadPx: startIndex * safeLineHeight,
    bottomPadPx: Math.max(0, (totalLines - endIndex) * safeLineHeight),
    onScroll,
  }
}

/** Longest line string for preserving horizontal scroll width while virtualized. */
export function longestLineOf(lines: readonly string[]): string {
  let best = ''
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line !== undefined && line.length > best.length) best = line
  }
  return best
}
