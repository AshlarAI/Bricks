import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import { cn } from '$lib/utils'
import { parsePatch, type PatchLineKind } from './patch'

export interface DiffViewProps {
  /** Unified diff text, as produced by Rust. */
  patch: string
  /** The patch was cut to the size limit. */
  truncated?: boolean
  /** Binary file: there is no text to show. */
  binary?: boolean
  /** A patch written in a message: `+`/`-` lines count even without hunk headers. */
  loose?: boolean
  className?: string
}

// Both markers are on the left: a coloured gutter edge, then the old and
// new line numbers; the line keeps its own `+` / `-` (not colour only).
const ROW: Record<PatchLineKind, string> = {
  add: 'bg-diff-add-bg border-l-diff-add',
  del: 'bg-diff-del-bg border-l-diff-del',
  context: 'border-l-transparent',
  hunk: 'bg-muted text-muted-foreground border-l-transparent',
  meta: 'text-muted-foreground border-l-transparent',
}

export function DiffView({ patch, truncated = false, binary = false, loose = false, className }: DiffViewProps) {
  useLanguage()
  const shown = parsePatch(patch, { loose })

  return (
    <div
      className={cn(
        'overflow-hidden rounded-md border border-border bg-code-bg text-xs text-code-foreground',
        className,
      )}
    >
      {truncated && (
        <p role="status" className="border-b border-border px-2 py-1 text-warning">
          {t('changes.diffTruncatedOnlyTheFirstLines')}
        </p>
      )}

      {binary ? (
        <p className="px-2 py-2 text-muted-foreground">{t('changes.binaryFileNoPreviewAvailable')}</p>
      ) : shown.length === 0 ? (
        <p className="px-2 py-2 text-muted-foreground">{t('changes.noTextChanges')}</p>
      ) : (
        /* A named, focusable scroll container: keyboard users must be able to scroll
           it (WCAG 2.1.1). */
        <ScrollArea
          className="rounded-sm"
          viewportClass="max-h-96 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          orientation="both"
          viewportProps={{ role: 'region', 'aria-label': t('common.diff'), tabIndex: 0 }}
        >
          <div className="font-mono leading-5">
            <div className="min-w-max py-1">
              {shown.map((line, i) => (
                <div key={i} className={cn('grid grid-cols-[3rem_3rem_minmax(0,1fr)] border-l-[3px]', ROW[line.kind])}>
                  <span className="px-1 text-right text-muted-foreground tabular-nums select-none">
                    {line.oldNo ?? ''}
                  </span>
                  <span className="px-1 text-right text-muted-foreground tabular-nums select-none">
                    {line.newNo ?? ''}
                  </span>
                  <span className="px-2 whitespace-pre">{line.text}</span>
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

export default DiffView
