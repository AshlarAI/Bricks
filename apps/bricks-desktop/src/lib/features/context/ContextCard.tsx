// The context occupation of the shown conversation, compact: its share, one bar
// and, once a request was sent on this context, its sources. The bar's fill is
// the occupation; each source colours the part of it its share of the last
// request's text stands for. Unknown or stale reads `—`.
import { t, useLanguage } from '$lib/i18n/i18n'
import { useConversation, type Conversation } from '$lib/state/conversation'
import SectionCard from '$lib/layout/SectionCard'
import { cn } from '$lib/utils'
import { contextGauge, contextShares, formatPercent, formatShort, type ContextSource } from './contextView'

// The primary colour for the messages, then the theme's chart hues: they follow light and dark.
const COLOR: Record<ContextSource, string> = {
  conversation: 'bg-primary',
  tool_results: 'bg-chart-1',
  tool_definitions: 'bg-chart-3',
  instructions: 'bg-chart-4',
  other: 'bg-chart-5',
}

export interface ContextCardProps {
  conversation: Conversation
}

export function ContextCard({ conversation }: ContextCardProps) {
  useLanguage()
  const status = useConversation(conversation, (c) => c.context) ?? null
  const stale = useConversation(conversation, (c) => c.contextStale) ?? false

  const gauge = contextGauge(status, stale)
  const shares = contextShares(status, stale)
  const share = gauge.percent === null ? '—' : `${Math.round(gauge.percent)} %`
  const figures = `${gauge.used === null ? '—' : formatShort(gauge.used)} / ${gauge.total === null ? '—' : formatShort(gauge.total)}`

  /** What the input budget still has room for, once a breakdown is shown. */
  const free = shares && gauge.used !== null && gauge.total !== null ? Math.max(0, gauge.total - gauge.used) : null

  return (
    <SectionCard title={t('common.context')}>
      <div className="flex items-baseline justify-between gap-3 text-ui">
        <span
          className={cn(
            'font-medium tabular-nums',
            gauge.ratio !== null && gauge.ratio >= 0.9
              ? 'text-destructive'
              : gauge.ratio !== null && gauge.ratio >= 0.75
                ? 'text-warning'
                : 'text-foreground',
          )}
        >
          {t('context.used', { share })}
        </span>
        <span className="tabular-nums text-muted-foreground">{figures}</span>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
        role="meter"
        aria-label={t('context.contextUsed')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={gauge.percent === null ? undefined : Math.round(Math.min(100, gauge.percent))}
        aria-valuetext={gauge.percent === null ? t('common.unknownValue') : `${share} (${figures})`}
      >
        {gauge.ratio !== null &&
          (shares ? (
            <div className="flex h-full gap-px" style={{ width: `${gauge.ratio * 100}%` }}>
              {shares.map((part) => (
                <div
                  key={part.source}
                  className={cn('h-full first:rounded-l-full last:rounded-r-full', COLOR[part.source])}
                  style={{ flexGrow: part.share }}
                />
              ))}
            </div>
          ) : (
            <div
              className={cn(
                'h-full rounded-full',
                gauge.ratio >= 0.9 ? 'bg-destructive' : gauge.ratio >= 0.75 ? 'bg-warning' : 'bg-primary',
              )}
              style={{ width: `${gauge.ratio * 100}%` }}
            />
          ))}
      </div>
      {shares && (
        <ul className="mt-2.5 flex flex-col gap-1 text-xs" aria-label={t('context.contextBreakdown')}>
          {shares.map((part) => (
            <li key={part.source} className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-sm', COLOR[part.source])} />
              <span className="min-w-0 flex-1 truncate text-foreground" title={part.label}>
                {part.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatShort(part.tokens)}</span>
              <span className="w-11 shrink-0 text-right whitespace-nowrap tabular-nums text-foreground">
                {formatPercent(part.share * 100)}
              </span>
            </li>
          ))}
          {free !== null && (
            <li className="flex min-w-0 items-center gap-1.5">
              <span aria-hidden="true" className="size-2 shrink-0 rounded-sm border border-border bg-muted" />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{t('context.freeSpace')}</span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{formatShort(free)}</span>
              <span className="w-11 shrink-0" aria-hidden="true" />
            </li>
          )}
        </ul>
      )}
    </SectionCard>
  )
}

export default ContextCard
