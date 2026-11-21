import type { ReactNode } from 'react'
import { cn } from '$lib/utils'
import type { HeadingLevel, IconComponent } from './types'

export interface EmptyStateProps {
  title: string
  description?: string
  /** A lucide icon component. Decorative: the title carries the meaning. */
  icon?: IconComponent
  /** Heading level of the title (default 2). Use the level that fits the region's outline. */
  headingLevel?: HeadingLevel
  /** Optional call to action, e.g. a Button. Rendered only when provided. */
  action?: ReactNode
  className?: string
}

export function EmptyState({
  title,
  description,
  icon: Icon,
  headingLevel = 2,
  action,
  className,
}: EmptyStateProps) {
  const HeadingTag = `h${headingLevel}` as const

  return (
    <div className={cn('flex flex-col items-center justify-center gap-3 px-6 py-10 text-center', className)}>
      {Icon && (
        <span className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-5" aria-hidden="true" />
        </span>
      )}
      <div className="flex max-w-xs flex-col gap-1">
        <HeadingTag className="text-sm font-medium text-foreground">{title}</HeadingTag>
        {description && <p className="text-sm text-pretty text-muted-foreground">{description}</p>}
      </div>
      {action && <div className="mt-1">{action}</div>}
    </div>
  )
}

export default EmptyState
