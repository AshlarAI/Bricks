// The composer's context ring, left of the model select: occupation of the
// next request over the input budget (the same figures as the context card).
// Hover or focus shows a small panel. Unknown or stale: a neutral ring.
import { t, useLanguage } from '$lib/i18n/i18n'
import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip'
import { useConversation, type Conversation } from '$lib/state/conversation'
import { cacheHitRate, contextGauge, formatPercent, gaugeLine } from './contextView'

// Circle of radius 6.5 in a 16×16 box drawn at 14 px, 2.2 stroke, in a 28 px
// button. The fill starts at noon, clockwise.
const R = 6.5
const CIRCUMFERENCE = 2 * Math.PI * R

export interface ContextGaugeProps {
  conversation: Conversation | null
}

export function ContextGauge({ conversation }: ContextGaugeProps) {
  useLanguage()
  const context = useConversation(conversation, (c) => c.context) ?? null
  const contextStale = useConversation(conversation, (c) => c.contextStale) ?? false

  const gauge = contextGauge(context, contextStale)
  const cache = cacheHitRate(context)
  const value = gaugeLine(gauge)
  const dash = gauge.ratio === null ? 0 : gauge.ratio * CIRCUMFERENCE
  const label =
    gauge.percent === null ? t('context.inputContextUnknown') : t('context.inputContext', { value })

  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger
        className="inline-flex size-control-md shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-element-hover hover:text-foreground data-[state=open]:border-border-strong data-[state=open]:bg-element-selected focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        aria-label={label}
      >
        <svg viewBox="0 0 16 16" className="size-3.5 -rotate-90" aria-hidden="true">
          <circle
            cx="8"
            cy="8"
            r={R}
            fill="none"
            strokeWidth="2.2"
            style={{ stroke: 'color-mix(in oklab, var(--muted-foreground) 38%, transparent)' }}
          />
          {dash > 0 && (
            <circle
              cx="8"
              cy="8"
              r={R}
              fill="none"
              strokeWidth="2.2"
              strokeDasharray={`${dash} ${CIRCUMFERENCE}`}
              style={{ stroke: 'var(--muted-foreground)' }}
            />
          )}
        </svg>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={2}
        hideArrow
        className="flex w-80 max-w-none flex-col items-stretch gap-2.5 rounded-xl border bg-popover p-3 text-popover-foreground shadow-float"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-sm font-medium">{t('context.inputContext2')}</span>
          <span className="shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            {value}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
          {gauge.ratio !== null && (
            <div className="h-full rounded-full bg-foreground" style={{ width: `${gauge.ratio * 100}%` }} />
          )}
        </div>
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <span className="text-muted-foreground">{t('context.averageCacheRate')}</span>
          <span className="font-mono tabular-nums">{cache === null ? '—' : formatPercent(cache)}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export default ContextGauge
