// Session consumption and cost (`/cost`, `/usage`, `details`). Figures come from
// the engine's usage events; nothing is priced or counted again here.
import { useEffect, useId, useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { InspectorState } from '$lib/state/ui'
import type { Usage } from '$lib/ipc/engine'
import * as ipc from '$lib/ipc/client'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import { Button } from '$lib/components/ui/button'
import { Skeleton } from '$lib/components/ui/skeleton'
import {
  consumedTokens,
  costCell,
  costOf,
  formatClock,
  formatInt,
  formatUsd,
  shortText,
} from './format'

export function CostView({ args }: { args: InspectorState['args'] }) {
  useLanguage()
  const uid = useId()
  const conv = useApp((s) => s.current)
  useConversation(conv)
  const sessionId = conv?.sessionId ?? null

  const [showDetails, setShowDetails] = useState(() => args.details === true || args.details === 'true')

  /** Totals read from the snapshot when the view opens (used until a live usage arrives). */
  const [openedUsage, setOpenedUsage] = useState<Usage | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setOpenedUsage(null)
      setLoadError(null)
      setLoaded(true)
      return
    }
    let cancelled = false
    setLoaded(false)
    setLoadError(null)
    ipc
      .sessionSnapshot(sessionId)
      .then(
        (snap) => {
          if (cancelled) return
          setOpenedUsage(snap.usage)
        },
        (e: unknown) => {
          if (cancelled) return
          setLoadError(ipc.errorMessage(e))
        },
      )
      .finally(() => {
        if (!cancelled) setLoaded(true)
      })
    return () => {
      cancelled = true
    }
  }, [sessionId])

  const live = Boolean(conv?.usageTotalFull)
  const total: Usage | null = conv?.usageTotalFull ?? openedUsage
  const consumed = consumedTokens(total) > 0
  const cost = costOf(total)
  const requests = conv?.context?.totals ?? null
  const runRows = conv ? [...conv.runUsages.entries()] : []
  const turns = conv?.turnUsages ?? []

  function runPrompt(runId: string | undefined): string {
    if (!runId) return '—'
    const prompt = conv?.runs.get(runId)?.prompt
    return prompt ? shortText(prompt, 60) : t('inspect.questionUnavailable')
  }

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={showDetails}
          onClick={() => setShowDetails((prev) => !prev)}
        >
          {showDetails ? t('inspect.hideTheDetails') : t('inspect.viewTheDetailsPerAnswer')}
        </Button>
      </div>

      <section className="flex flex-col gap-2" aria-labelledby={`${uid}-session`}>
        <h3 id={`${uid}-session`} className="text-sm font-medium">
          {t('common.session')}
        </h3>
        {!loaded && !live ? (
          <Skeleton className="h-24 w-full" />
        ) : !total || !consumed ? (
          <p className="text-sm text-muted-foreground">{t('inspect.noUsageObserved')}</p>
        ) : (
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t('inspect.requests')}</dt>
            <dd className="tabular-nums">
              {requests ? formatInt(requests.requests) : '—'}
              {requests && requests.compaction_requests > 0 && (
                <>
                  {' '}
                  <span className="text-muted-foreground">
                    {t('inspect.includingForCompaction', {
                      compactionRequests: formatInt(requests.compaction_requests),
                    })}
                  </span>
                </>
              )}
              {requests && requests.requests_without_usage > 0 && (
                <>
                  {' '}
                  <span className="text-muted-foreground">
                    {t('inspect.withoutTokenCount', {
                      requestsWithoutUsage: formatInt(requests.requests_without_usage),
                    })}
                  </span>
                </>
              )}
            </dd>

            <dt className="text-muted-foreground">{t('common.enter')}</dt>
            <dd className="tabular-nums">{t('common.tokens', { tokens: formatInt(total.input_tokens) })}</dd>

            <dt className="text-muted-foreground">{t('common.output')}</dt>
            <dd className="tabular-nums">{t('common.tokens', { tokens: formatInt(total.output_tokens) })}</dd>

            <dt className="text-muted-foreground">{t('inspect.includingReasoning')}</dt>
            <dd className="tabular-nums">{t('common.tokens', { tokens: formatInt(total.reasoning_tokens) })}</dd>

            <dt className="text-muted-foreground">{t('inspect.cacheRead')}</dt>
            <dd className="tabular-nums">
              {t('common.tokens', { tokens: formatInt(total.cache_read_input_tokens) })}
            </dd>

            <dt className="text-muted-foreground">{t('inspect.cacheWrite')}</dt>
            <dd className="tabular-nums">
              {t('common.tokens', { tokens: formatInt(total.cache_creation_input_tokens) })}
            </dd>

            <dt className="text-muted-foreground">{t('inspect.total')}</dt>
            <dd className="tabular-nums">{t('common.tokens', { tokens: formatInt(total.total_tokens) })}</dd>

            <dt className="text-muted-foreground">{t('inspect.cost')}</dt>
            <dd>
              {cost.kind === 'exact' ? (
                <span className="tabular-nums">{formatUsd(cost.usd)}</span>
              ) : cost.kind === 'partial' ? (
                <span className="tabular-nums">{t('inspect.atLeast', { usd: formatUsd(cost.usd) })}</span>
              ) : (
                <span>{t('inspect.unknownCostNoPricingConfigured')}</span>
              )}
            </dd>
          </dl>
        )}
        {loadError && !total && (
          <p role="alert" className="text-sm text-destructive">
            {t('inspect.couldNotReloadTheTotals', { loadError })}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby={`${uid}-runs`}>
        <h3 id={`${uid}-runs`} className="text-sm font-medium">
          {t('inspect.perTurnRootRun')}
        </h3>
        {runRows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('inspect.noTurnCounted')}</p>
        ) : (
          runRows.map(([rootId, ru]) => (
            <div key={rootId} className="flex min-w-0 flex-col gap-2 rounded-md border border-border p-3">
              <p className="text-sm text-pretty">
                <span className="text-muted-foreground">{t('inspect.turn')}</span> {runPrompt(rootId)}
              </p>
              <ScrollArea orientation="horizontal">
                <table className="w-full min-w-[22rem] text-xs tabular-nums">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th scope="col" className="py-1 text-left font-normal">
                        <span className="sr-only">{t('inspect.measure')}</span>
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        {t('inspect.own')}
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        {t('common.subAgents')}
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        {t('inspect.turnTotal')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border">
                      <th scope="row" className="py-1 text-left font-normal text-muted-foreground">
                        {t('common.enter')}
                      </th>
                      <td className="py-1 text-right">{formatInt(ru.own.input_tokens)}</td>
                      <td className="py-1 text-right">{formatInt(ru.descendants.input_tokens)}</td>
                      <td className="py-1 text-right">{formatInt(ru.total.input_tokens)}</td>
                    </tr>
                    <tr className="border-t border-border">
                      <th scope="row" className="py-1 text-left font-normal text-muted-foreground">
                        {t('common.output')}
                      </th>
                      <td className="py-1 text-right">{formatInt(ru.own.output_tokens)}</td>
                      <td className="py-1 text-right">{formatInt(ru.descendants.output_tokens)}</td>
                      <td className="py-1 text-right">{formatInt(ru.total.output_tokens)}</td>
                    </tr>
                    <tr className="border-t border-border">
                      <th scope="row" className="py-1 text-left font-normal text-muted-foreground">
                        {t('inspect.total')}
                      </th>
                      <td className="py-1 text-right">{formatInt(ru.own.total_tokens)}</td>
                      <td className="py-1 text-right">{formatInt(ru.descendants.total_tokens)}</td>
                      <td className="py-1 text-right">{formatInt(ru.total.total_tokens)}</td>
                    </tr>
                    <tr className="border-t border-border">
                      <th scope="row" className="py-1 text-left font-normal text-muted-foreground">
                        {t('inspect.cost')}
                      </th>
                      <td className="py-1 text-right">{costCell(costOf(ru.own))}</td>
                      <td className="py-1 text-right">{costCell(costOf(ru.descendants))}</td>
                      <td className="py-1 text-right">{costCell(costOf(ru.total))}</td>
                    </tr>
                  </tbody>
                </table>
              </ScrollArea>
              {!ru.final_total && (
                <p className="text-xs text-pretty text-warning">
                  {t('inspect.provisionalTotal', { count: ru.pending_agents })}
                </p>
              )}
            </div>
          ))
        )}
      </section>

      {showDetails && (
        <section className="flex flex-col gap-2" aria-labelledby={`${uid}-turns`}>
          <h3 id={`${uid}-turns`} className="text-sm font-medium">
            {t('inspect.perAnswer')}
          </h3>
          {turns.length === 0 ? (
            <p className="text-sm text-pretty text-muted-foreground">
              {t('inspect.noAnswerReceivedSinceTheSession')}
            </p>
          ) : (
            <>
              <ScrollArea orientation="horizontal">
                <table className="w-full min-w-[32rem] text-xs tabular-nums">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th scope="col" className="py-1 text-left font-normal">
                        #
                      </th>
                      <th scope="col" className="py-1 text-left font-normal">
                        {t('inspect.time')}
                      </th>
                      <th scope="col" className="py-1 text-left font-normal">
                        {t('inspect.turn2')}
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        {t('common.enter')}
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        {t('common.output')}
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        {t('inspect.cacheRead2')}
                      </th>
                      <th scope="col" className="py-1 text-right font-normal">
                        {t('inspect.cost')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {turns.map((turn, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="py-1 text-muted-foreground">{i + 1}</td>
                        <td className="py-1">{formatClock(turn.at)}</td>
                        <td className="max-w-[12rem] truncate py-1" title={runPrompt(turn.runId)}>
                          {runPrompt(turn.runId)}
                        </td>
                        <td className="py-1 text-right">{formatInt(turn.usage.input_tokens)}</td>
                        <td className="py-1 text-right">{formatInt(turn.usage.output_tokens)}</td>
                        <td className="py-1 text-right">{formatInt(turn.usage.cache_read_input_tokens)}</td>
                        <td className="py-1 text-right">{costCell(costOf(turn.usage))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
              <p className="text-xs text-pretty text-muted-foreground">
                {t('inspect.answersShown', { count: turns.length })}
              </p>
            </>
          )}
        </section>
      )}
    </div>
  )
}

export default CostView
