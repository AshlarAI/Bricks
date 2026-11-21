import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import {
  CodeIcon,
  CopyIcon,
  DownloadIcon,
  FileImageIcon,
  ImageDownIcon,
  Maximize2Icon,
  MoveIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
import { Button } from '$lib/components/ui/button'
import { Toggle } from '$lib/components/ui/toggle'
import * as CodeBlock from '$lib/components/ui/code-block'
import { useHighlightedCode } from '$lib/hooks/use-highlighted-code'
import { useApp } from '$lib/state/app'
import { useTheme } from '$lib/theme/theme'
import { diagramMode, diagramSettings, diagramTheme } from '$lib/features/diagrams/settings'
import { savePngFile, saveSvgFile } from '$lib/ipc/client'
import { cn } from '$lib/utils'
import { exportableSvg } from './mermaid'
import { svgFrame } from './svg-viewer'
import { effectiveBackground, svgToPng } from './svg-png'

/**
 * `mermaid`: a diagram in the chosen Mermaid theme; `chart`: a chart drawn in
 * the app's colours; `drawing`: an SVG the model wrote; `file`: a file read.
 */
export type SvgViewerVariant = 'mermaid' | 'chart' | 'drawing' | 'file'

export interface SvgViewerProps {
  svg: string
  source?: string
  title?: string
  fileName?: string
  variant?: SvgViewerVariant
}

/** What `save_png_file` accepts at most (32 Mio). */
const PNG_LIMIT = 32 * 1024 * 1024

export function SvgViewer({
  svg,
  source,
  title: titleProp,
  fileName: fileNameProp,
  variant: variantProp,
}: SvgViewerProps) {
  useLanguage()
  const { resolved: resolvedTheme } = useTheme()
  const diagramsPref = useApp((s) => s.prefs.diagrams)

  const title = titleProp ?? t('conversation.diagram')
  const fileName = fileNameProp ?? t('conversation.diagramSvg')
  const variant: SvgViewerVariant = variantProp ?? (source !== undefined ? 'mermaid' : 'file')

  const settings = useMemo(() => diagramSettings(diagramsPref), [diagramsPref])
  const options = settings.diagramViewer
  // A diagram or chart drawn in the app's colours sits on the app's code background;
  // any other SVG (a Mermaid theme, a drawing, a file) keeps a plain background of its own.
  const appColours = variant === 'chart' || (variant === 'mermaid' && diagramTheme(settings) === 'app')
  const mode =
    variant === 'chart'
      ? resolvedTheme
      : variant === 'mermaid'
        ? diagramMode(settings, resolvedTheme)
        : 'light'
  const frame = useMemo(
    () => svgFrame(svg, options, mode, appColours ? 'transparent' : 'plain'),
    [svg, options, mode, appColours],
  )
  /** At most 26rem high, and never wider than the drawing itself. */
  const inlineStyle: CSSProperties = frame.size
    ? {
        aspectRatio: `${frame.size.width} / ${frame.size.height}`,
        maxWidth: `${frame.size.width}px`,
        maxHeight: '26rem',
      }
    : { height: '26rem' }

  const [zoom, setZoom] = useState(1)
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const [moving, setMoving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showSource, setShowSource] = useState(false)

  /** The source's language; the highlighter loads only once the source is shown. */
  const sourceLanguage = variant === 'mermaid' ? 'mermaid' : variant === 'chart' ? 'json' : 'xml'
  const sourceLines = useHighlightedCode(source ?? '', showSource ? sourceLanguage : '')

  const figureRef = useRef<HTMLElement | null>(null)
  /** WebKit and Chromium write images to the clipboard; elsewhere the button is not shown. */
  const canCopyImage =
    typeof ClipboardItem !== 'undefined' && typeof navigator !== 'undefined' && !!navigator.clipboard?.write
  const pointerRef = useRef<{ id: number; x: number; y: number; startX: number; startY: number } | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(timerRef.current)
    }
  }, [])

  const pan = options.allowPan && moving
  const transform = `translate(${options.allowPan ? x : 0}px, ${options.allowPan ? y : 0}px) scale(${options.allowZoom ? zoom : 1})`

  function flash(text: string) {
    if (!mountedRef.current) return
    setFeedback(text)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      if (mountedRef.current) setFeedback(null)
    }, 1800)
  }

  function reset() {
    setZoom(1)
    setX(0)
    setY(0)
  }

  function start(event: PointerEvent<HTMLButtonElement>) {
    if (!pan || event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY, startX: x, startY: y }
  }

  function drag(event: PointerEvent<HTMLButtonElement>) {
    const pointer = pointerRef.current
    if (!pan || pointer?.id !== event.pointerId) return
    setX(pointer.startX + event.clientX - pointer.x)
    setY(pointer.startY + event.clientY - pointer.y)
  }

  function stop() {
    pointerRef.current = null
  }

  function key(event: KeyboardEvent<HTMLButtonElement>) {
    if (!pan) return
    const shifts: Record<string, [number, number]> = {
      ArrowLeft: [-24, 0],
      ArrowRight: [24, 0],
      ArrowUp: [0, -24],
      ArrowDown: [0, 24],
    }
    const shift = shifts[event.key]
    if (!shift) return
    event.preventDefault()
    setX((prev) => prev + shift[0])
    setY((prev) => prev + shift[1])
  }

  async function copy() {
    if (!options.allowCopy) return
    try {
      await navigator.clipboard.writeText(source ?? frame.svg)
      flash(t('conversation.sourceCopied'))
    } catch {
      flash(t('common.couldNotCopy'))
    }
  }

  async function download() {
    if (!options.allowDownload || !frame.svg) return
    try {
      if (await saveSvgFile(fileName, exportableSvg(frame.svg))) flash(t('conversation.svgSaved'))
    } catch {
      flash(t('conversation.couldNotExport'))
    }
  }

  /** The colour the diagram is seen on: the frame's own plain background, else the figure's. */
  function imageBackground(): string {
    if (!appColours) return mode === 'dark' ? '#111827' : '#ffffff'
    return effectiveBackground(figureRef.current, mode === 'dark' ? '#111827' : '#ffffff')
  }

  /** The whole diagram as a PNG, whatever the zoom or the position of the view. */
  function png(): Promise<Blob> {
    return svgToPng(exportableSvg(frame.svg), frame.size, imageBackground())
  }

  function copyImage() {
    if (!options.allowCopy || !frame.svg || !canCopyImage) return
    // Written at once, inside the click: WebKit keeps the user's gesture only
    // until the first await; the image itself comes later, as a promise.
    const image = png()
    let written: Promise<void>
    try {
      written = navigator.clipboard.write([new ClipboardItem({ 'image/png': image })])
    } catch {
      image.catch(() => {})
      flash(t('common.couldNotCopy'))
      return
    }
    Promise.all([written, image]).then(
      () => flash(t('conversation.imageCopied')),
      () => flash(t('common.couldNotCopy')),
    )
  }

  async function downloadPng() {
    if (!options.allowDownload || !frame.svg) return
    try {
      const blob = await png()
      // The backend refuses more; the bytes are not even sent.
      if (blob.size > PNG_LIMIT) {
        flash(t('conversation.pngTooLarge'))
        return
      }
      const name = fileName.replace(/\.svg$/i, '') + '.png'
      if (await savePngFile(name, new Uint8Array(await blob.arrayBuffer()))) flash(t('conversation.pngSaved'))
    } catch {
      flash(t('conversation.couldNotExport'))
    }
  }

  function renderControls(fullscreen = false) {
    return (
      <div className="flex flex-wrap items-center gap-0.5">
        {options.allowZoom && frame.svg && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('conversation.zoomOut')}
              aria-label={t('conversation.zoomOut')}
              disabled={zoom <= 0.5}
              onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            >
              <ZoomOutIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="tabular-nums"
              title={t('conversation.resetTheView')}
              aria-label={t('conversation.resetTheView')}
              onClick={reset}
            >
              {Math.round(zoom * 100)} %
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('conversation.zoomIn')}
              aria-label={t('conversation.zoomIn')}
              disabled={zoom >= 4}
              onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
            >
              <ZoomInIcon aria-hidden="true" />
            </Button>
          </>
        )}
        {options.allowPan && frame.svg && (
          <Toggle
            size="sm"
            className="size-8 p-0"
            title={t('conversation.moveTheDiagramDragOrUse')}
            aria-label={t('conversation.moveTheDiagram')}
            pressed={moving}
            onPressedChange={setMoving}
          >
            <MoveIcon aria-hidden="true" />
          </Toggle>
        )}
        {options.allowFullscreen && frame.svg && !fullscreen && (
          <Button
            variant="ghost"
            size="icon-sm"
            title={t('common.fullscreen')}
            aria-label={t('common.fullscreen')}
            onClick={() => setExpanded(true)}
          >
            <Maximize2Icon aria-hidden="true" />
          </Button>
        )}
        {options.allowDownload && frame.svg && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('conversation.exportAsSvg')}
              aria-label={t('conversation.exportAsSvg')}
              onClick={() => void download()}
            >
              <DownloadIcon aria-hidden="true" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('conversation.exportAsPng')}
              aria-label={t('conversation.exportAsPng')}
              onClick={() => void downloadPng()}
            >
              <FileImageIcon aria-hidden="true" />
            </Button>
          </>
        )}
        {source !== undefined && (
          <Toggle
            size="sm"
            className="size-8 p-0"
            title={t('conversation.showTheSource')}
            aria-label={t('conversation.showTheSource')}
            pressed={showSource}
            onPressedChange={setShowSource}
          >
            <CodeIcon aria-hidden="true" />
          </Toggle>
        )}
        {options.allowCopy && (
          <>
            <Button
              variant="ghost"
              size="icon-sm"
              title={t('conversation.copyTheSource')}
              aria-label={t('conversation.copyTheSource')}
              onClick={() => void copy()}
            >
              <CopyIcon aria-hidden="true" />
            </Button>
            {canCopyImage && (
              <Button
                variant="ghost"
                size="icon-sm"
                title={t('conversation.copyImage')}
                aria-label={t('conversation.copyImage')}
                disabled={!frame.svg}
                onClick={copyImage}
              >
                <ImageDownIcon aria-hidden="true" />
              </Button>
            )}
          </>
        )}
        {feedback && (
          <span role="status" className="px-1 text-xs">
            {feedback}
          </span>
        )}
      </div>
    )
  }

  function renderViewport(fullscreen = false) {
    return (
      <div
        className={cn('relative overflow-hidden', !fullscreen && 'mx-auto w-full')}
        style={
          fullscreen
            ? { height: `calc(100dvh - ${showSource && source !== undefined ? '25rem' : '8rem'})` }
            : inlineStyle
        }
      >
        <div className="size-full origin-center" style={{ transform }}>
          <iframe
            title={title}
            sandbox=""
            referrerPolicy="no-referrer"
            srcDoc={frame.document}
            className="size-full border-0"
            style={{ pointerEvents: pan ? 'none' : 'auto' }}
          />
        </div>
        {pan && (
          <button
            type="button"
            aria-label={t('conversation.moveTheDiagramDragOrUse2')}
            className="absolute inset-0 size-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            onPointerDown={start}
            onPointerMove={drag}
            onPointerUp={stop}
            onPointerCancel={stop}
            onLostPointerCapture={stop}
            onKeyDown={key}
          >
            <span className="sr-only">{t('conversation.moveTheDiagram')}</span>
          </button>
        )}
      </div>
    )
  }

  function renderSourceView() {
    if (!showSource || source === undefined) return null
    return (
      <CodeBlock.Root size="sm" className="rounded-none border-0 border-t border-border bg-code-bg text-code-foreground">
        <CodeBlock.Content lineNumbers className="max-h-80">
          {sourceLines.map((line, index) => (
            <CodeBlock.Line key={index} code={line} />
          ))}
        </CodeBlock.Content>
      </CodeBlock.Root>
    )
  }

  return (
    <>
      <figure
        ref={figureRef}
        className={cn(
          'my-2 overflow-hidden rounded-md border border-border text-card-foreground',
          appColours ? 'bg-code-bg' : 'bg-card',
        )}
      >
        <figcaption className="flex flex-wrap items-center justify-between gap-1 px-2 py-1 text-xs text-muted-foreground">
          <span>{title}</span>
          {renderControls()}
        </figcaption>
        {frame.svg ? (
          !(expanded && options.allowFullscreen) && renderViewport()
        ) : (
          <p role="alert" className="p-3 text-xs text-destructive">
            {t('conversation.invalidOrTooLargeSvg')}
          </p>
        )}
        {!expanded && renderSourceView()}
      </figure>
      <Dialog open={expanded && options.allowFullscreen} onOpenChange={setExpanded}>
        <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-2 rounded-none sm:max-w-none">
          <DialogHeader>
            <DialogTitle className="text-center text-ui">{title}</DialogTitle>
          </DialogHeader>
          {renderControls(true)}
          {frame.svg && renderViewport(true)}
          {renderSourceView()}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default SvgViewer
