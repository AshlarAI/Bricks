import { useState, type ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
import { cn } from '$lib/utils'
import type { HeadingLevel } from './types'

export interface SectionCardProps {
  title: string
  description?: string
  /** Optional figure shown on the right of the title, e.g. a number of items. */
  count?: number
  /** Whether the body is shown. Defaults to open. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Heading level of the title (default 3: a section inside a panel whose title is h2). */
  headingLevel?: HeadingLevel
  /** Controls shown at the right of the header, next to the toggle. Click them without collapsing the card. */
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function SectionCard({
  title,
  description,
  count,
  open: openProp,
  onOpenChange,
  headingLevel = 3,
  actions,
  children,
  className,
}: SectionCardProps) {
  const [internalOpen, setInternalOpen] = useState(true)
  const open = openProp ?? internalOpen
  const handleOpenChange = (next: boolean) => {
    if (openProp === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  const HeadingTag = `h${headingLevel}` as const

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className={cn('rounded-2xl border border-border-subtle bg-card text-card-foreground shadow-float', className)}
    >
      <div className="flex items-center gap-1 pr-1">
        <HeadingTag className="min-w-0 flex-1 text-ui font-medium">
          <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 rounded-2xl px-3.5 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronDownIcon
              className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate">{title}</span>
            {count !== undefined && (
              <span className="font-mono text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
            )}
          </CollapsibleTrigger>
        </HeadingTag>
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
      </div>
      <CollapsibleContent>
        {description && <p className="px-3.5 pb-1 text-xs text-pretty text-muted-foreground">{description}</p>}
        <div className="border-t border-border-subtle px-3.5 py-2.5">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export default SectionCard
