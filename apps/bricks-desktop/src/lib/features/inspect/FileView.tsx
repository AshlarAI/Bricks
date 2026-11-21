// Read-only window of a project file opened from a file reference in a
// message. The path is resolved and checked by Rust (`project_file_read`)
// in the project of the conversation the message belongs to.
import { useEffect, useMemo, useRef, useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { highlightedLines, useCodeLanguagesVersion } from '$lib/code-highlight'
import { t, useLanguage } from '$lib/i18n/i18n'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { projectFileRead } from '$lib/ipc/client'
import type { ProjectFileWindow } from '$lib/features/conversation/markdown/types'
import type { InspectorState } from '$lib/state/ui'
import { cn } from '$lib/utils'

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

  useEffect(() => {
    if (!file) return
    scrollerRef.current?.querySelector<HTMLElement>('[data-first-marked]')?.scrollIntoView({ block: 'center' })
  }, [file, first])

  const highlighted = useMemo(() => {
    if (!file || file.lines.length === 0) return null
    void codeVersion
    return highlightedLines(file.lines.join('\n'), file.language)
  }, [file, codeVersion])

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
          <ScrollArea
            className="rounded-md bg-code-bg"
            viewportClass="max-h-[60vh] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            orientation="both"
            viewportRef={scrollerRef}
            viewportProps={{ role: 'region', 'aria-label': t('common.contentOf', { path }), tabIndex: 0 }}
          >
            <div className="font-mono text-xs leading-5 text-code-foreground">
              <div className="min-w-max py-1">
                {file.lines.map((text, i) => {
                  const n = file.start + i
                  const marked = first > 0 && n >= first && n <= last
                  const html = highlighted?.[i]
                  return (
                    <div
                      key={i}
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
              </div>
            </div>
          </ScrollArea>
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
