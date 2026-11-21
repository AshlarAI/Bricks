// Read-only reader of the right column: one tab per file of the open
// conversation, and per tab a source view (highlighted, numbered lines,
// read in bounded windows), a Markdown preview, and the recorded edit
// operations of that file (each patch on its own, never merged).
import { Fragment, useLayoutEffect, useRef, type UIEvent } from 'react'
import { XIcon } from 'lucide-react'
import { numberFormat, t, useLanguage } from '$lib/i18n/i18n'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group'
import FileIcon from '$lib/features/file-icons/FileIcon'
import DiffView from '$lib/features/changes/DiffView'
import SvgViewer from '$lib/features/conversation/markdown/SvgViewer'
import MarkdownView from '$lib/features/conversation/markdown/MarkdownView'
import DiffStat from '$lib/layout/DiffStat'
import { useApp } from '$lib/state/app'
import { useConversation, type Conversation } from '$lib/state/conversation'
import { reader, useReader, type ReaderTab } from '$lib/state/reader'
import { useCodeLanguagesVersion } from '$lib/code-highlight'
import { cn } from '$lib/utils'
import { highlightLines } from './highlight'

const MODES: { id: ReaderTab['mode']; readonly label: string }[] = [
  { id: 'source', get label() { return t('reader.source') } },
  { id: 'preview', get label() { return t('reader.preview') } },
  { id: 'changes', get label() { return t('common.changes') } },
]

function available(tab: ReaderTab, mode: ReaderTab['mode']): boolean {
  if (mode === 'preview') return tab.isMarkdown || tab.isSvg
  if (mode === 'changes') return tab.operations.length > 0
  return true
}

function prefixOf(tab: ReaderTab): string {
  const safe = tab.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return `r${safe.length}-${safe}`
}

const nf = numberFormat()

export interface ReaderPanelProps {
  conversation?: Conversation | null
}

export function ReaderPanel({ conversation: conversationProp }: ReaderPanelProps) {
  useLanguage()
  useCodeLanguagesVersion()
  const readerStore = useReader()
  const appCurrent = useApp((s) => s.current)
  const resolved = conversationProp !== undefined ? conversationProp : appCurrent
  const conversation = useConversation(resolved)

  const sessionId = conversation?.sessionId ?? null
  const tabs = sessionId ? readerStore.tabs(sessionId) : []
  const active = sessionId ? readerStore.active(sessionId) : null

  const activeWindow = active?.window ?? null
  const highlighted =
    active && activeWindow && activeWindow.lines.length > 0
      ? highlightLines(activeWindow.lines.join('\n'), active.language)
      : []

  // Each tab keeps its scroll position when the view changes.
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const activeId = active?.id
  const activeLoading = activeWindow?.loading ?? false
  useLayoutEffect(() => {
    const el = scrollerRef.current
    if (!el || !active) return
    el.scrollTop = active.scrollTop
  }, [active, activeId, activeLoading])

  function handleScroll(e: UIEvent<HTMLDivElement>) {
    if (active) reader.rememberScroll(active.id, e.currentTarget.scrollTop)
  }

  return (
    <section aria-label={t('common.reader')} className="flex h-full min-h-0 flex-col bg-background">
      {tabs.length === 0 ? (
        <p className="p-4 text-ui text-muted-foreground">{t('reader.noOpenFile')}</p>
      ) : (
        <>
          <ScrollArea className="shrink-0 border-b border-border/50" orientation="horizontal">
            <div className="flex items-center gap-0.5 px-1.5 py-1" role="tablist" aria-label={t('reader.openFiles')}>
              {tabs.map((tab) => (
                <div
                  key={tab.id}
                  className={cn(
                    'group flex max-w-48 min-w-12 shrink items-center rounded-md text-ui',
                    tab.id === active?.id
                      ? 'bg-element-selected text-foreground'
                      : 'text-muted-foreground hover:bg-element-hover',
                  )}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={tab.id === active?.id}
                    title={tab.fullPath}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md py-1 pr-1 pl-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => reader.activate(tab.id)}
                  >
                    <FileIcon path={tab.fullPath || tab.title} />
                    <span className="min-w-0 truncate">{tab.title}</span>
                  </button>
                  <button
                    type="button"
                    aria-label={t('reader.close', { title: tab.title })}
                    title={t('common.close')}
                    className="mr-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    onClick={() => reader.close(tab.id)}
                  >
                    <XIcon className="size-3" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          </ScrollArea>

          {active && (
            <>
              <div className="flex shrink-0 items-center gap-2 px-2 py-1">
                <ToggleGroup
                  type="single"
                  size="sm"
                  spacing={0.5}
                  aria-label={t('reader.readingMode')}
                  value={active.mode}
                  onValueChange={(mode) => {
                    if (mode) reader.setMode(active.id, mode as ReaderTab['mode'])
                  }}
                >
                  {MODES.filter((mode) => available(active, mode.id)).map((mode) => (
                    <ToggleGroupItem key={mode.id} value={mode.id} className="h-6 px-2 text-xs font-normal">
                      {mode.label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <span className="ml-auto min-w-0 truncate font-mono text-caption text-muted-foreground" title={active.fullPath}>
                  {active.fullPath}
                </span>
              </div>

              <ScrollArea
                className="min-h-0 flex-1"
                viewportClass="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                orientation={active.mode === 'changes' || active.mode === 'preview' ? 'vertical' : 'both'}
                viewportRef={scrollerRef}
                viewportProps={{
                  onScroll: handleScroll,
                  role: 'region',
                  'aria-label': t('common.contentOf', { path: active.title }),
                  tabIndex: 0,
                }}
              >
                {active.mode === 'changes' ? (
                  <div className="flex flex-col gap-3 p-2">
                    {active.operations.map((op, i) => (
                      <section key={op.key} aria-label={t('reader.operation', { value: i + 1 })} className="flex flex-col gap-1">
                        <p className="flex items-center gap-2 px-0.5 text-xs text-muted-foreground">
                          <span>{t('reader.operationOf', { value: i + 1, operations: active.operations.length })}</span>
                          <DiffStat additions={op.added} deletions={op.removed} />
                        </p>
                        {op.patch ? (
                          <DiffView patch={op.patch} truncated={op.truncated} loose />
                        ) : op.truncated ? (
                          <p className="px-0.5 text-xs text-muted-foreground">{t('reader.changesTooLargeNotKeptFor')}</p>
                        ) : (
                          <p className="px-0.5 text-xs text-muted-foreground">
                            {t('reader.changesNotSavedForThisOperation')}
                          </p>
                        )}
                      </section>
                    ))}
                  </div>
                ) : !activeWindow || activeWindow.loading ? (
                  <p className="p-3 text-xs text-muted-foreground" role="status">
                    {t('common.reading2')}
                  </p>
                ) : activeWindow.error ? (
                  <p className="p-3 text-xs text-destructive" role="alert">
                    {activeWindow.error}
                  </p>
                ) : active.mode === 'preview' ? (
                  <div className="flex flex-col gap-2 p-3">
                    {activeWindow.truncated && (
                      <p className="text-xs text-muted-foreground">
                        {t('reader.partialPreviewLinesToOf', {
                          start: nf.format(activeWindow.start),
                          value: nf.format(activeWindow.start + activeWindow.lines.length - 1),
                          totalLines: nf.format(activeWindow.totalLines),
                        })}
                      </p>
                    )}
                    <Fragment key={active.id}>
                      {active.isSvg ? (
                        activeWindow.truncated ? (
                          <p className="text-xs text-muted-foreground">{t('reader.theSvgFileMustBeFully')}</p>
                        ) : (
                          <SvgViewer
                            svg={activeWindow.lines.join('\n')}
                            title={active.title}
                            fileName={active.title}
                          />
                        )
                      ) : (
                        <MarkdownView source={activeWindow.lines.join('\n')} idPrefix={prefixOf(active)} />
                      )}
                    </Fragment>
                  </div>
                ) : (
                  <div className="min-w-max py-1 font-mono text-xs leading-5">
                    {highlighted.map((html, i) => (
                      <div key={i} className="grid grid-cols-[3.5rem_minmax(0,1fr)]">
                        <span className="px-2 text-right text-muted-foreground tabular-nums select-none">
                          {activeWindow.start + i}
                        </span>
                        <span className="pr-3 whitespace-pre" dangerouslySetInnerHTML={{ __html: html || ' ' }} />
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>

              {active.mode !== 'changes' &&
                activeWindow &&
                !activeWindow.loading &&
                !activeWindow.error &&
                activeWindow.truncated && (
                  <div className="flex shrink-0 items-center gap-2 border-t border-border/50 px-2 py-1 text-xs text-muted-foreground">
                    <span className="tabular-nums">
                      {t('reader.linesOf', {
                        start: nf.format(activeWindow.start),
                        value: nf.format(activeWindow.start + activeWindow.lines.length - 1),
                        totalLines: nf.format(activeWindow.totalLines),
                      })}
                    </span>
                  </div>
                )}
            </>
          )}
        </>
      )}
    </section>
  )
}

export default ReaderPanel
