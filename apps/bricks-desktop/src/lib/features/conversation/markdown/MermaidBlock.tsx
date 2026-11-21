// A top-level ```mermaid fence of an assistant message. The renderer is
// loaded on demand, only once the fence is closed; the source stays visible
// until then and when rendering fails. The SVG comes from `renderMermaid`,
// already validated by `sanitizeSvg`.
import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import { fontsReady, useTheme } from '$lib/theme/theme'
import { useApp } from '$lib/state/app'
import { diagramSettings, diagramTheme } from '$lib/features/diagrams/settings'
import { renderMermaid, type MermaidCache } from './mermaid'
import { mermaidColors } from './mermaid-colors'
import SvgViewer from './SvgViewer'

export interface MermaidBlockProps {
  source: string
  complete: boolean
  /** Unique per message and block: the SVG ids derive from it. */
  id: string
  cache: MermaidCache
}

export function MermaidBlock({ source, complete, id, cache }: MermaidBlockProps) {
  useLanguage()
  const { resolved: resolvedTheme } = useTheme()
  const diagramsPref = useApp((s) => s.prefs.diagrams)

  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const instanceRef = useRef(0)

  const settings = diagramSettings(diagramsPref)
  const renderTheme = diagramTheme(settings)
  const renderLook = settings.mermaid.look
  const securityLevel = settings.mermaid.securityLevel

  // Render only a closed fence, once per source and theme. A late result for
  // an older source or theme is dropped.
  useEffect(() => {
    const version = ++instanceRef.current
    // A replacement/open fence must never keep the previous diagram exportable.
    setSvg(null)
    setError(null)
    if (!complete) return
    let cancelled = false
    void (async () => {
      await fontsReady
      if (cancelled) return
      const result = await renderMermaid(source, {
        id: `${id}-${version}`,
        theme: renderTheme,
        mode: resolvedTheme,
        look: renderLook,
        securityLevel,
        // Read after the mode's class is set: the app's colours of that mode.
        colors: renderTheme === 'app' ? mermaidColors() : undefined,
        fontFamily:
          getComputedStyle(document.documentElement).getPropertyValue('--ui-font-family').trim() || 'sans-serif',
        cache,
      })
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
  }, [source, complete, id, cache, renderTheme, resolvedTheme, renderLook, securityLevel])

  if (svg) {
    return <SvgViewer svg={svg} source={source} title="Mermaid" />
  }

  return (
    <figure className="my-2 overflow-hidden rounded-md bg-code-bg text-code-foreground" aria-busy={!error && complete}>
      {error && (
        <p className="px-2.5 pt-2 text-xs text-destructive" role="alert">
          {t('conversation.diagramNotRendered', { error })}
        </p>
      )}
      <ScrollArea orientation="horizontal">
        <pre className="p-2.5 text-xs leading-relaxed">
          <code className="font-mono">{source}</code>
        </pre>
      </ScrollArea>
    </figure>
  )
}

export default MermaidBlock
