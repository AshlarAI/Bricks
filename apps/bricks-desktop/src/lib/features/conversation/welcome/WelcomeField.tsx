// The welcome screen's backdrop: a slow field of characters in the text colour, hollow in
// the middle. Decorative only (hidden from assistive technology, no pointer events). It
// pauses while hidden or off screen, and draws a single still frame with reduced motion.
import { useEffect, useRef } from 'react'
import { useTheme } from '$lib/theme/theme'
import { cssColorToHex, readThemeToken } from '$lib/theme/resolved-theme'
import { FRAME_MS, drawField } from './dither'

/** The text colour of the theme on screen, faint enough to stay behind everything. */
function inkColour(): string {
  const hex = cssColorToHex(readThemeToken('--foreground')) ?? '#808080'
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.42)`
}

export function WelcomeField() {
  const { resolved: resolvedTheme } = useTheme()
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const element = canvasRef.current
    if (!element) return
    const context = element.getContext('2d')
    if (!context) return
    const ctx: CanvasRenderingContext2D = context

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const ink = inkColour()
    let width = 0
    let height = 0
    let visible = true
    let frame = 0
    let last = 0
    let raf = 0

    function resize() {
      const parent = element?.parentElement
      if (!element || !parent) return
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      width = parent.clientWidth
      height = parent.clientHeight
      element.width = Math.round(width * dpr)
      element.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawField(ctx, width, height, frame, ink)
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick)
      if (!visible || document.hidden || now - last < FRAME_MS) return
      last = now
      frame += 1
      drawField(ctx, width, height, frame, ink)
    }

    const resizer = new ResizeObserver(resize)
    if (element.parentElement) resizer.observe(element.parentElement)
    const watcher = new IntersectionObserver(
      ([entry]) => {
        visible = entry?.isIntersecting ?? true
      },
      { rootMargin: '80px' },
    )
    watcher.observe(element)
    resize()
    if (!reduced) raf = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(raf)
      resizer.disconnect()
      watcher.disconnect()
    }
  }, [resolvedTheme])

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 h-full w-full [mask-image:radial-gradient(ellipse_70%_60%_at_50%_45%,#000_55%,transparent_100%)]"
    />
  )
}

export default WelcomeField
