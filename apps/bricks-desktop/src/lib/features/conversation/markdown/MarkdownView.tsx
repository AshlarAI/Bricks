// Rendered Markdown of one text: an assistant answer, or a sub-agent's task
// or result. One MarkdownDocument per instance (its caches, ids and math
// macros are its own); `idPrefix` must be unique per text and rendering zone.
// The caller throttles `source` while it streams.
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { useLanguage } from '$lib/i18n/i18n'
import { useCodeLanguagesVersion } from '$lib/code-highlight'
import { cn } from '$lib/utils'
import { MarkdownDocument, markdownClicks } from '../markdown'
import { loadKatex } from './math'
import { createMermaidCache, type MermaidCache } from './mermaid'
import type { CitationSource } from './citations'
import type { FileReference, MarkdownHeading, MathRenderer, RenderedBlock } from './types'
import CitationCard, { type CitationCardHandle } from './CitationCard'
import CodeFence from './CodeFence'
import DiffBlock from './DiffBlock'
import MarkdownBlock from './MarkdownBlock'
import MermaidBlock from './MermaidBlock'
import SvgBlock from './SvgBlock'
import VegaBlock from './VegaBlock'
import WebPageBlock from './WebPageBlock'
import './markdown-view.css'

const DEFER_MIN_BLOCKS = 24
const DEFER_HEAD_BLOCKS = 6
const DEFER_TAIL_STREAMING_BLOCKS = 4
const PROGRESSIVE_MIN_BLOCKS = 80
const PROGRESSIVE_INITIAL_BATCH = 40
const PROGRESSIVE_STEP = 60

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

const MarkdownBlockView = memo(function MarkdownBlockView({
  block,
  deferred,
  idPrefix,
  mermaidCache,
  onFile,
  onLinkResult,
}: {
  block: RenderedBlock
  deferred: boolean
  idPrefix: string
  mermaidCache: MermaidCache
  onFile?: (ref: FileReference) => void
  onLinkResult?: (error: string | null) => void
}) {
  if (block.kind === 'html') {
    return (
      <div
        className={deferred ? 'md-html md-block-deferred' : 'md-html contents'}
        dangerouslySetInnerHTML={{ __html: block.html }}
      />
    )
  }

  let content: React.ReactNode
  if (block.kind === 'mermaid') {
    content = (
      <MermaidBlock
        source={block.source}
        complete={block.complete}
        id={`${idPrefix}-${block.key}`}
        cache={mermaidCache}
      />
    )
  } else if (block.kind === 'svg') {
    content = <SvgBlock source={block.source} complete={block.complete} />
  } else if (block.kind === 'vega') {
    content = <VegaBlock source={block.source} complete={block.complete} />
  } else if (block.kind === 'webpage') {
    content = <WebPageBlock source={block.source} complete={block.complete} />
  } else if (block.kind === 'code') {
    content = <CodeFence source={block.source} lang={block.lang} complete={block.complete} />
  } else if (block.kind === 'markdown') {
    content = (
      <MarkdownBlock
        source={block.source}
        complete={block.complete}
        idPrefix={`${idPrefix}-${block.key}`}
        onFile={onFile}
        onLinkResult={onLinkResult}
      />
    )
  } else {
    content = <DiffBlock source={block.source} complete={block.complete} onFile={onFile} />
  }

  return deferred ? <div className="md-block-deferred">{content}</div> : content
})

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

  const { blocks, headings } = useMemo(() => {
    doc.setCodeVersion(codeVersion)
    doc.setLanguage(language)
    void mathVersion
    void docGeneration
    const nextBlocks = doc.update(source, !streaming)
    return { blocks: nextBlocks, headings: doc.headings }
  }, [doc, source, streaming, codeVersion, language, mathVersion, docGeneration])

  const progressive = !streaming && blocks.length > PROGRESSIVE_MIN_BLOCKS && typeof requestAnimationFrame !== 'undefined'
  const [batch, setBatch] = useState<{ idPrefix: string; source: string; count: number }>({
    idPrefix,
    source,
    count: PROGRESSIVE_INITIAL_BATCH,
  })
  const activeCount =
    batch.idPrefix === idPrefix && batch.source === source ? batch.count : PROGRESSIVE_INITIAL_BATCH
  const targetTotal = blocks.length

  useEffect(() => {
    if (!progressive) return
    let count =
      batch.idPrefix === idPrefix && batch.source === source ? batch.count : PROGRESSIVE_INITIAL_BATCH
    if (count >= targetTotal) return
    if (batch.idPrefix !== idPrefix || batch.source !== source) {
      setBatch({ idPrefix, source, count })
    }
    let raf = 0
    let cancelled = false
    const pump = () => {
      if (cancelled) return
      count = Math.min(targetTotal, count + PROGRESSIVE_STEP)
      setBatch({ idPrefix, source, count })
      if (count < targetTotal) {
        raf = requestAnimationFrame(pump)
      }
    }
    raf = requestAnimationFrame(pump)
    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progressive, idPrefix, source, targetTotal])

  const visibleBlocks = progressive ? blocks.slice(0, Math.min(blocks.length, activeCount)) : blocks

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

  const deferTailLimit = streaming ? blocks.length - DEFER_TAIL_STREAMING_BLOCKS : blocks.length

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
        {visibleBlocks.map((block, index) => (
          <MarkdownBlockView
            key={block.key}
            block={block}
            deferred={blocks.length > DEFER_MIN_BLOCKS && index >= DEFER_HEAD_BLOCKS && index < deferTailLimit}
            idPrefix={idPrefix}
            mermaidCache={mermaidCache}
            onFile={onFile}
            onLinkResult={onLinkResult}
          />
        ))}
      </div>

      <CitationCard ref={cardRef} sources={sources} streaming={streaming} onLinkResult={onLinkResult} />
    </>
  )
}

export default MarkdownView
