import { useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import { cn } from '$lib/utils'

export interface MonoBlockProps {
  text: string
  /** Accessible name of the scroll region, e.g. « Sortie de Bash ». */
  label: string
  /** Colours `+` and `-` lines as a unified diff. */
  diff?: boolean
  /** Lines shown before the « Afficher tout » control. */
  maxLines?: number
  className?: string
}

export function MonoBlock({
  text,
  label,
  diff = false,
  maxLines = 200,
  className,
}: MonoBlockProps) {
  useLanguage()
  const [showAll, setShowAll] = useState(false)

  const lines = text.split('\n')
  const shown = showAll ? lines : lines.slice(0, maxLines)
  const hiddenCount = lines.length - shown.length

  function lineClass(line: string): string {
    if (!diff) return ''
    if (line.startsWith('+++') || line.startsWith('---')) return 'text-muted-foreground'
    if (line.startsWith('+')) return 'bg-diff-add-bg text-diff-add'
    if (line.startsWith('-')) return 'bg-diff-del-bg text-diff-del'
    if (line.startsWith('@@')) return 'text-info'
    return ''
  }

  return (
    <>
      {/* The block scrolls, so keyboard users must be able to focus it (WCAG 2.1.1). */}
      <ScrollArea
        orientation="both"
        className={cn('rounded-md border border-border bg-code-bg text-code-foreground', className)}
        viewportClass="max-h-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        viewportProps={{ role: 'region', 'aria-label': label, tabIndex: 0 }}
      >
        <pre className="min-w-max p-2.5 font-mono text-xs leading-relaxed">
          {shown.map((line, i) => (
            <span key={i} className={cn('block whitespace-pre', lineClass(line))}>
              {line || ' '}
            </span>
          ))}
        </pre>
      </ScrollArea>
      {hiddenCount > 0 && (
        <button
          type="button"
          className="mt-1 rounded-sm text-xs text-brand underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={() => setShowAll(true)}
        >
          {t('conversation.showAllMoreLine', { count: hiddenCount })}
        </button>
      )}
    </>
  )
}

export default MonoBlock
