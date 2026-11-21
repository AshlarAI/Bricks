import { useId, type ReactNode } from 'react'
import { cn } from '$lib/utils'

export interface SettingsGroupProps {
  /** Visible heading; also names the group for assistive technology. */
  title: string
  description?: string
  className?: string
  /** A small control at the right of the title (an icon button). */
  action?: ReactNode
  children: ReactNode
}

export function SettingsGroup({
  title,
  description,
  className,
  action,
  children,
}: SettingsGroupProps) {
  const headingId = useId()

  return (
    <section aria-labelledby={headingId} className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1">
        <div className="flex min-h-6 items-center justify-between gap-2">
          <h3 id={headingId} className="text-ui font-semibold text-foreground">
            {title}
          </h3>
          {action}
        </div>
        {description && (
          <p className="text-xs text-pretty text-muted-foreground">{description}</p>
        )}
      </div>
      <div className="flex flex-col divide-y divide-border rounded-lg border border-border bg-transparent text-foreground">
        {children}
      </div>
    </section>
  )
}

export default SettingsGroup
