import type { ComponentProps } from 'react'
import { numberFormat, t, useLanguage } from '$lib/i18n/i18n'
import { cn } from '$lib/utils'

const formatter = numberFormat()

export interface DiffStatProps extends ComponentProps<'span'> {
  /** Number of added units (lines, files...). Negative or fractional values are clamped to whole numbers >= 0. */
  additions: number
  /** Number of removed units. */
  deletions: number
  /** What the numbers count, e.g. "lignes" or "fichiers". Shown after the figures. */
  label?: string
}

export function DiffStat({ additions, deletions, label, className, ...restProps }: DiffStatProps) {
  useLanguage()

  const add = Math.max(0, Math.trunc(additions) || 0)
  const del = Math.max(0, Math.trunc(deletions) || 0)
  const addText = formatter.format(add)
  const delText = formatter.format(del)
  const spoken = [t('layout.additionCount', { count: add }), t('layout.deletionCount', { count: del }), label]
    .filter(Boolean)
    .join(', ')

  return (
    <span className={cn('inline-flex items-baseline gap-1.5 whitespace-nowrap text-xs tabular-nums', className)} {...restProps}>
      <span aria-hidden="true" className="inline-flex items-baseline gap-1 font-mono">
        {/* A zero beside a non-zero count says nothing: « +12 », « −3 », « +0 » only when both are zero. */}
        {(add > 0 || del === 0) && (
          <span className={add > 0 ? 'text-diff-add' : 'text-muted-foreground'}>+{addText}</span>
        )}
        {del > 0 && <span className="text-diff-del">−{delText}</span>}
      </span>
      {label && (
        <span aria-hidden="true" className="text-muted-foreground">
          {label}
        </span>
      )}
      <span className="sr-only">{spoken}</span>
    </span>
  )
}

export default DiffStat
