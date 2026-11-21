// A top-level ```vega-lite fence of an assistant message: the chart once the
// fence is closed, drawn as an SVG at the width available, in the app's theme
// under the chart's own colours. Vega is loaded on demand. While it streams,
// and when it cannot be drawn, its source stays shown.
import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import { fontsReady, useTheme } from '$lib/theme/theme'
import { mermaidColors } from './mermaid-colors'
import { renderVegaLite } from './vega'
import SvgViewer from './SvgViewer'

export interface VegaBlockProps {
  source: string
  complete: boolean
}

export function VegaBlock({ source, complete }: VegaBlockProps) {
  useLanguage()
  const { resolved: resolvedTheme } = useTheme()

  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [width, setWidth] = useState(0)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const widthRef = useRef(0)
  const instanceRef = useRef(0)

  // The width available, followed (after a pause) while the panel is resized.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0)
      clearTimeout(timer)
      const currentWidth = widthRef.current
      timer = setTimeout(
        () => {
          if (Math.abs(next - widthRef.current) >= 8) {
            widthRef.current = next
            setWidth(next)
          }
        },
        currentWidth === 0 ? 0 : 200,
      )
    })
    observer.observe(host)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [])

  // Drawn again for a new source, width or mode; a late result is dropped.
  useEffect(() => {
    const available = width
    const version = ++instanceRef.current
    // The previous chart stays shown while the next one is drawn (a resize).
    if (!complete || available === 0) {
      if (!complete) {
        setSvg(null)
        setError(null)
      }
      return
    }
    let cancelled = false
    void (async () => {
      // The theme's fonts, when they do not load, are no reason to draw nothing.
      await fontsReady.catch(() => {})
      if (cancelled) return
      let result: Awaited<ReturnType<typeof renderVegaLite>>
      try {
        result = await renderVegaLite(source, {
          // The viewer's own padding aside.
          width: available - 24,
          // Read after the mode's class is set: the app's colours of that mode.
          colors: mermaidColors(),
          fontFamily:
            getComputedStyle(document.documentElement).getPropertyValue('--ui-font-family').trim() || 'sans-serif',
        })
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) }
      }
      if (cancelled || version !== instanceRef.current) return
      if ('svg' in result) {
        setSvg(result.svg)
        setError(null)
      } else {
        setSvg(null)
        setError(result.error)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [source, complete, width, resolvedTheme])

  return (
    <div ref={hostRef} className="w-full">
      {svg ? (
        <SvgViewer svg={svg} source={source} title="Vega-Lite" variant="chart" fileName={t('conversation.chartSvg')} />
      ) : (
        <figure
          className="my-2 overflow-hidden rounded-md bg-code-bg text-code-foreground"
          aria-busy={!error && complete}
        >
          {error && (
            <p className="px-2.5 pt-2 text-xs text-destructive" role="alert">
              {t('conversation.chartNotRendered', { error })}
            </p>
          )}
          <ScrollArea orientation="horizontal">
            <pre className="p-2.5 text-xs leading-relaxed">
              <code className="font-mono">{source}</code>
            </pre>
          </ScrollArea>
        </figure>
      )}
    </div>
  )
}

export default VegaBlock
