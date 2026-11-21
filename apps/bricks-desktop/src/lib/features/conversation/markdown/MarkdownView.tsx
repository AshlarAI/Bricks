// Rendered Markdown of one text: an assistant answer, or a sub-agent's task
// or result. One MarkdownDocument per instance (its caches, ids and math
// macros are its own); `idPrefix` must be unique per text and rendering zone.
// The caller throttles `source` while it streams.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '$lib/i18n/i18n'
import { useCodeLanguagesVersion } from '$lib/code-highlight'
import { cn } from '$lib/utils'
import { MarkdownDocument, markdownClicks } from '../markdown'
import { loadKatex } from './math'
import { createMermaidCache } from './mermaid'
import type { CitationSource } from './citations'
import type { FileReference, MarkdownHeading, MathRenderer } from './types'
import CitationCard, { type CitationCardHandle } from './CitationCard'
import DiffBlock from './DiffBlock'
import MarkdownBlock from './MarkdownBlock'
import MermaidBlock from './MermaidBlock'
import SvgBlock from './SvgBlock'
import VegaBlock from './VegaBlock'
import './markdown-view.css'

export interface MarkdownViewProps {
  source: string
  streaming?: boolean
  idPrefix: string
  /** Opens a file reference; absent: references and diff file names are not actionable. */
  onFile?: (ref: FileReference) => void
  /** Result of an attempt to open an external link: an error message, or null. */
  onLinkResult?: (error: string | null) => void
  /** Called when the headings of the text change, for a table of contents. */
  onHeadingsChange?: (headings: MarkdownHeading[]) => void
  /** Pages the conversation's web searches returned: the cards of its links show them. */
  sources?: ReadonlyMap<string, CitationSource>
  className?: string
}

export function MarkdownView({
  source,
  streaming = false,
  idPrefix,
  onFile,
  onLinkResult,
  onHeadingsChange,
  sources,
  className = 'text-sm',
}: MarkdownViewProps) {
  const language = useLanguage()
  const codeVersion = useCodeLanguagesVersion()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const cardRef = useRef<CitationCardHandle | null>(null)
  const mathRendererRef = useRef<MathRenderer | null>(null)
  const mathRequestedRef = useRef(false)
  const mountedRef = useRef(true)

  /** Bumped when the math renderer arrives or doc is reinitialized after StrictMode cleanup. */
  const [mathVersion, setMathVersion] = useState(0)
  const [docGeneration, setDocGeneration] = useState(0)

  const docRef = useRef<{ idPrefix: string; doc: MarkdownDocument } | null>(null)
  if (!docRef.current || docRef.current.idPrefix !== idPrefix) {
    docRef.current?.doc.dispose()
    docRef.current = { idPrefix, doc: new MarkdownDocument({ idPrefix }) }
    if (mathRendererRef.current) {
      docRef.current.doc.setMathRenderer(mathRendererRef.current)
    }
  }
  const doc = docRef.current.doc
  const mermaidCache = useMemo(() => createMermaidCache(), [idPrefix])

  useEffect(() => {
    mountedRef.current = true
    if (!docRef.current || docRef.current.idPrefix !== idPrefix) {
      docRef.current = { idPrefix, doc: new MarkdownDocument({ idPrefix }) }
      if (mathRendererRef.current) {
        docRef.current.doc.setMathRenderer(mathRendererRef.current)
      }
      setDocGeneration((g) => g + 1)
    }
    return () => {
      mountedRef.current = false
      docRef.current?.doc.dispose()
      docRef.current = null
    }
  }, [idPrefix])

  doc.setCodeVersion(codeVersion)
  doc.setLanguage(language)
  void mathVersion
  void docGeneration
  const blocks = doc.update(source, !streaming)
  const headings = doc.headings

  const prevHeadingsKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (!onHeadingsChange) return
    const key = headings.map((h) => `${h.level}:${h.id}:${h.text}`).join('\n')
    if (key === prevHeadingsKeyRef.current) return
    prevHeadingsKeyRef.current = key
    onHeadingsChange(headings)
  }, [blocks, headings, onHeadingsChange])

  // KaTeX is loaded only for a text that has a formula, once. The result is
  // kept even if more text arrived meanwhile; only unmounting drops it.
  useEffect(() => {
    if (mathRequestedRef.current || !doc.needsMath) return
    mathRequestedRef.current = true
    loadKatex().then(
      (renderer) => {
        mathRendererRef.current = renderer
        if (!mountedRef.current) return
        docRef.current?.doc.setMathRenderer(renderer)
        setMathVersion((v) => v + 1)
      },
      () => {
        // The formulas keep their source text; a later text retries the load.
        mathRequestedRef.current = false
      },
    )
  }, [blocks, doc])

  const clickActionRef = useRef<ReturnType<typeof markdownClicks>>(undefined)
  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const action = markdownClicks(node, {
      onLinkResult,
      linksEnabled: !streaming,
      onFileReference: onFile,
    })
    clickActionRef.current = action
    return () => {
      if (action && typeof action === 'object' && 'destroy' in action) {
        action.destroy?.()
      }
      clickActionRef.current = undefined
    }
  }, [])

  useEffect(() => {
    const action = clickActionRef.current
    if (action && typeof action === 'object' && 'update' in action) {
      action.update?.({
        onLinkResult,
        linksEnabled: !streaming,
        onFileReference: onFile,
      })
    }
  }, [onLinkResult, streaming, onFile])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return
    const cleanup = cardRef.current?.attach(node)
    return () => {
      if (typeof cleanup === 'function') cleanup()
    }
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          'md syntax-markdown leading-relaxed break-words text-foreground',
          streaming && 'streaming',
          className,
        )}
      >
        {blocks.map((block) => {
          if (block.kind === 'html') {
            return (
              <div
                key={block.key}
                className="md-html contents"
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            )
          }
          if (block.kind === 'mermaid') {
            return (
              <MermaidBlock
                key={block.key}
                source={block.source}
                complete={block.complete}
                id={`${idPrefix}-${block.key}`}
                cache={mermaidCache}
              />
            )
          }
          if (block.kind === 'svg') {
            return <SvgBlock key={block.key} source={block.source} complete={block.complete} />
          }
          if (block.kind === 'vega') {
            return <VegaBlock key={block.key} source={block.source} complete={block.complete} />
          }
          if (block.kind === 'markdown') {
            return (
              <MarkdownBlock
                key={block.key}
                source={block.source}
                complete={block.complete}
                idPrefix={`${idPrefix}-${block.key}`}
                onFile={onFile}
                onLinkResult={onLinkResult}
              />
            )
          }
          return <DiffBlock key={block.key} source={block.source} complete={block.complete} onFile={onFile} />
        })}
      </div>

      <CitationCard ref={cardRef} sources={sources} streaming={streaming} onLinkResult={onLinkResult} />
    </>
  )
}

export default MarkdownView
