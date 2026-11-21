// The `@` popover above the composer: project files and folders matching the
// text after `@`. Same listbox pattern as the command palette: the editor keeps
// the keyboard (aria-activedescendant); this component renders and reports.
import { useEffect } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { ProjectFileEntry } from '$lib/ipc/bindings/ProjectFileEntry'
import { Kbd } from '$lib/components/ui/kbd'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { RefreshCwIcon } from 'lucide-react'
import { cn } from '$lib/utils'
import type { MentionStatus } from './mention-files'

export interface MentionPaletteProps {
  /** Base id: the listbox is `id`, its options are `${id}-opt-${index}`. */
  id: string
  items: ProjectFileEntry[]
  activeIndex: number
  status: MentionStatus
  error?: string
  query: string
  onPick: (entry: ProjectFileEntry) => void
  onHover: (index: number) => void
  onRefresh: () => void
}

export function MentionPalette({
  id,
  items,
  activeIndex,
  status,
  error = '',
  query,
  onPick,
  onHover,
  onRefresh,
}: MentionPaletteProps) {
  useLanguage()

  // Keeps the highlighted entry visible while the arrow keys move it.
  useEffect(() => {
    document.getElementById(`${id}-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, activeIndex, items])

  return (
    <div className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-float">
      {items.length > 0 ? (
        <ScrollArea viewportClass="max-h-64">
          <div className="p-1" role="listbox" id={id} aria-label={t('composer.projectFiles')}>
            {items.map((entry, i) => (
              <div
                key={entry.path}
                role="option"
                id={`${id}-opt-${i}`}
                aria-selected={i === activeIndex}
                tabIndex={-1}
                className={cn(
                  'flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1.5 text-sm',
                  i === activeIndex && 'bg-accent text-accent-foreground',
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => onHover(i)}
                onClick={() => onPick(entry)}
                onKeyDown={(e) => {
                  // Options are not tab stops (the editor keeps the focus); Enter or Space still pick one.
                  if (e.key !== 'Enter' && e.key !== ' ') return
                  e.preventDefault()
                  onPick(entry)
                }}
              >
                <FileIcon path={entry.path} kind={entry.is_dir ? 'folder' : 'file'} />
                <span className="truncate font-mono">
                  {entry.path}
                  {entry.is_dir ? '/' : ''}
                </span>
              </div>
            ))}
          </div>
        </ScrollArea>
      ) : status === 'error' ? (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {t('composer.filesUnavailable', { error })}
        </p>
      ) : status === 'ready' ? (
        <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {t('composer.noFileMatches', { query })}
        </p>
      ) : (
        <p role="status" className="px-3 py-2 text-sm text-muted-foreground">
          {t('composer.searchingFiles')}
        </p>
      )}

      <div className="flex items-center justify-end gap-2 border-t px-2 py-1.5 text-xs text-muted-foreground">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-sm px-1.5 py-0.5 hover:bg-element-hover hover:text-foreground"
          aria-keyshortcuts="Control+R"
          title={t('composer.refreshTheFileListCtrlR')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onRefresh}
        >
          <RefreshCwIcon className="size-3.5" aria-hidden="true" />
          {t('common.refresh')}
          <Kbd>Ctrl R</Kbd>
        </button>
      </div>
    </div>
  )
}

export default MentionPalette
