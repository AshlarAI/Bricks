import type { ComponentProps } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Dotm3x3_20 } from '$lib/components/ui/dotm-3x3-20'
import { cn } from '$lib/utils'
import type { StatusState } from './types'

export type { StatusState }

export const STATUS_LABELS: Record<StatusState, string> = {
  get idle() {
    return t('layout.idle')
  },
  get running() {
    return t('common.running')
  },
  get waiting() {
    return t('layout.waiting')
  },
  get success() {
    return t('common.finished')
  },
  get error() {
    return t('common.error')
  },
  get cancelled() {
    return t('common.cancelled')
  },
}

const DOT: Record<StatusState, string> = {
  idle: 'bg-status-idle',
  running: 'bg-info',
  waiting: 'bg-warning',
  success: 'bg-success',
  error: 'bg-destructive',
  // Cancelled is a hollow ring so it is not confused with idle by colour alone.
  cancelled: 'border border-muted-foreground bg-transparent',
}

export interface StatusDotProps extends ComponentProps<'span'> {
  status: StatusState
  /** Overrides the default label. */
  label?: string
  /** Shows the label as visible text next to the dot. Otherwise it is screen-reader only. */
  showLabel?: boolean
}

export function StatusDot({ status, label, showLabel = false, className, ...restProps }: StatusDotProps) {
  useLanguage()
  const text = label ?? STATUS_LABELS[status]

  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs text-muted-foreground', className)} {...restProps}>
      {status === 'running' ? (
        <span aria-hidden="true" data-status={status} className="inline-flex shrink-0 items-center justify-center text-info">
          <Dotm3x3_20 dotSize={2.5} cellPadding={1} ariaLabel="" />
        </span>
      ) : (
        <span
          aria-hidden="true"
          data-status={status}
          className={cn('inline-block size-2 shrink-0 rounded-full', DOT[status])}
        />
      )}
      {showLabel ? <span>{text}</span> : <span className="sr-only">{text}</span>}
    </span>
  )
}

export default StatusDot
