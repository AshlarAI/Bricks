// Read-only window of a project file opened from a file reference in a
// message. The path is resolved and checked by Rust (`project_file_read`)
// in the project of the conversation the message belongs to.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  canHighlightText,
  highlightedLines,
  isHighlightable,
  shouldUseWorkerHighlight,
  useCodeLanguagesVersion,
} from '$lib/code-highlight'
import { t, useLanguage } from '$lib/i18n/i18n'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { projectFileRead } from '$lib/ipc/client'
import type { ProjectFileWindow } from '$lib/features/conversation/markdown/types'
import { longestLineOf, useVirtualLines } from '$lib/hooks/use-virtual-lines'
import { highlightHtmlLinesAsync } from '$lib/shiki-async'
import type { InspectorState } from '$lib/state/ui'
import { cn } from '$lib/utils'

const FILE_LINE_HEIGHT = 20
const FILE_VIRTUALIZE_THRESHOLD = 200

export function FileView({ args }: { args: InspectorState['args'] }) {
  useLanguage()
  const codeVersion = useCodeLanguagesVersion()

  const projectId = typeof args.projectId === 'string' ? args.projectId : ''
  const path = typeof args.path === 'string' ? args.path : ''
  const line = typeof args.line === 'string' ? Number(args.line) : undefined
  const endLine = typeof args.endLine === 'string' ? Number(args.endLine) : undefined

  const [file, setFile] = useState<ProjectFileWindow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const [scrollEl, setScrollEl] = useState<HTMLDivElement | null>(null)
  const attachScroller = useCallback((el: HTMLDivElement | null) => {
    scrollerRef.current = el
    setScrollEl(el)
  }, [])

  useEffect(() => {
    let cancelled = false
    setFile(null)
    setError(null)
    projectFileRead(projectId, path, line ?? null, endLine ?? null).then(
      (result) => {
        if (!cancelled) setFile(result)
      },
      (e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [projectId, path, line, endLine])

  const first = line ?? 0
  const last = endLine ?? line ?? 0
  const shownPath = file?.path ?? path

  const sourceText = useMemo(() => (file && file.lines.length > 0 ? file.lines.join('\n') : ''), [file])
  const totalLines = file?.lines.length ?? 0
  const virtualize = totalLines > FILE_VIRTUALIZE_THRESHOLD
  const useWorker =
    !!file &&
    sourceText !== '' &&
    isHighlightable(file.language) &&
    canHighlightText(sourceText) &&
    shouldUseWorkerHighlight(sourceText, totalLines)

  const [workerHighlight, setWorkerHighlight] = useState<{
    source: string
    language: string | null
    lines: string[]
  } | null>(null)

  useEffect(() => {
    if (!useWorker || !file?.language) {
      setWorkerHighlight(null)
      return
    }
    const controller = new AbortController()
    void highlightHtmlLinesAsync(sourceText, file.language, controller.signal).then((lines) => {
      if (!controller.signal.aborted && lines) {
        setWorkerHighlight({ source: sourceText, language: file.language, lines })
      }
    })
    return () => controller.abort()
  }, [useWorker, sourceText, file?.language])

  const highlighted = useMemo(() => {
    if (!file || !sourceText) return null
    void codeVersion
    if (useWorker) {
      if (
        workerHighlight &&
        workerHighlight.source === sourceText &&
        workerHighlight.language === file.language
      ) {
        return workerHighlight.lines
      }
      return null
    }
    return highlightedLines(sourceText, file.language)
  }, [file, sourceText, codeVersion, useWorker, workerHighlight])

  const window = useVirtualLines({
    totalLines,
    lineHeight: FILE_LINE_HEIGHT,
    enabled: virtualize,
    scrollElement: scrollEl,
  })

  const widestLine = useMemo(() => {
    if (!virtualize || !file) return ''
    return longestLineOf(file.lines)
  }, [virtualize, file])

  useEffect(() => {
    const el = scrollerRef.current
    if (!file || !el) return
    if (virtualize && first > 0) {
      const targetIndex = Math.max(0, first - file.start)
      const centerOffset = Math.max(0, (el.clientHeight || 300) / 2 - FILE_LINE_HEIGHT / 2)
      el.scrollTop = Math.max(0, targetIndex * FILE_LINE_HEIGHT - centerOffset)
      window.onScroll()
      return
    }
    el.querySelector<HTMLElement>('[data-first-marked]')?.scrollIntoView({ block: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, first, virtualize])

  const visibleLines = useMemo(() => {
    if (!file) return []
    if (!virtualize) return file.lines
    return file.lines.slice(window.startIndex, window.endIndex)
  }, [file, virtualize, window.startIndex, window.endIndex])

  return (
    <div className="flex min-h-0 flex-col gap-2 text-ui">
      <p className="flex min-w-0 items-start gap-1.5 font-mono text-xs text-muted-foreground">
        <span className="flex h-4 shrink-0 items-center">
          <FileIcon path={shownPath} />
        </span>
        <span className="min-w-0 break-all">
          {shownPath}
          {line ? (
            <>
              :{line}
              {endLine && endLine !== line ? `-${endLine}` : null}
            </>
          ) : null}
        </span>
      </p>
      {error ? (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      ) : !file ? (
        <p className="text-xs text-muted-foreground" role="status">
          {t('common.reading2')}
        </p>
      ) : (
        <>
          <div
            ref={attachScroller}
            onScroll={window.onScroll}
            role="region"
            aria-label={t('common.contentOf', { path })}
            tabIndex={0}
            className="max-h-[60vh] overflow-auto rounded-md bg-code-bg scrollbar-thin outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="font-mono text-xs leading-5 text-code-foreground">
              <div className="min-w-max py-1">
                {virtualize && widestLine ? (
                  <div
                    aria-hidden="true"
                    className="invisible h-0 overflow-hidden grid grid-cols-[3.5rem_minmax(0,1fr)] select-none"
                  >
                    <span className="px-2">{file.start + totalLines}</span>
                    <span className="px-2 whitespace-pre">{widestLine}</span>
                  </div>
                ) : null}
                {virtualize && window.topPadPx > 0 ? (
                  <div aria-hidden="true" style={{ height: window.topPadPx }} />
                ) : null}
                {visibleLines.map((text, i) => {
                  const lineIndex = window.startIndex + i
                  const n = file.start + lineIndex
                  const marked = first > 0 && n >= first && n <= last
                  const html = highlighted?.[lineIndex]
                  return (
                    <div
                      key={lineIndex}
                      className={cn('grid grid-cols-[3.5rem_minmax(0,1fr)]', marked && 'bg-info-soft')}
                      data-first-marked={marked && n === first ? '' : undefined}
                    >
                      <span className="px-2 text-right text-muted-foreground tabular-nums select-none">{n}</span>
                      {html !== undefined ? (
                        <span className="px-2 whitespace-pre" dangerouslySetInnerHTML={{ __html: html }} />
                      ) : (
                        <span className="px-2 whitespace-pre">{text}</span>
                      )}
                    </div>
                  )
                })}
                {virtualize && window.bottomPadPx > 0 ? (
                  <div aria-hidden="true" style={{ height: window.bottomPadPx }} />
                ) : null}
              </div>
            </div>
          </div>
          {file.truncated && (
            <p className="text-xs text-muted-foreground">
              {t('inspect.linesToOf', {
                start: file.start,
                value: file.start + file.lines.length - 1,
                totalLines: file.totalLines,
              })}
            </p>
          )}
        </>
      )}
    </div>
  )
}

export default FileView
