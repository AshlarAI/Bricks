// « Consommation »: what the model responses consumed, from the usage ledger, for every
// provider or one. Figures, a year of activity, tokens per day and per model over 7 or 30
// days, and for OpenCode Go the share of its limits the key has used.
import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { Bar, BarChart, CartesianGrid, Label, Pie, PieChart, XAxis } from 'recharts'
import { Alert, AlertDescription } from '$lib/components/ui/alert'
import { Button } from '$lib/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '$lib/components/ui/card'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '$lib/components/ui/chart'
import { Empty, EmptyHeader, EmptyTitle } from '$lib/components/ui/empty'
import { Progress } from '$lib/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select'
import { Separator } from '$lib/components/ui/separator'
import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group'
import { formatUsd } from '$lib/features/inspect/format'
import { dateTimeFormat, localeTag, numberFormat, t, useLanguage } from '$lib/i18n/i18n'
import type { GoQuota } from '$lib/ipc/bindings/GoQuota'
import type { ProviderView } from '$lib/ipc/bindings/ProviderView'
import type { UsageRow } from '$lib/ipc/bindings/UsageRow'
import { errorMessage, providersConfig, usageGoQuota, usageStats } from '$lib/ipc/client'
import { cn } from '$lib/utils'
import ProviderLogo from './ProviderLogo'
import { displayName } from './models'
import {
  ALL_PROVIDERS,
  OTHER,
  activityGrid,
  compactCount,
  dailySeries,
  forProvider,
  fromKey,
  inRange,
  modelShares,
  providerChoices,
  totals,
  type GridMode,
} from './usage'

const ALL_SENTINEL = '__all__'
const LEVELS = [
  'bg-muted-foreground/10',
  'bg-chart-1/25',
  'bg-chart-1/50',
  'bg-chart-1/75',
  'bg-chart-1',
]

const isGoProvider = (id: string, list: ProviderView[]) => {
  const p = list.find((x) => x.id === id)
  return !!p && /^https:\/\/opencode\.ai\/(inference|zen)\/go(\/|$)/i.test(p.endpoint.trim())
}

/** Space between two stacked segments of a day, in px. */
const STACK_GAP = 2

/** One segment of a day's stacked bar: rounded, a small gap above the one under it. */
function StackSegment(props: { x?: number; y?: number; width?: number; height?: number; fill?: string }) {
  const { x = 0, y = 0, width = 0, fill } = props
  const height = (props.height ?? 0) - STACK_GAP
  if (height <= 0 || width <= 0) return null
  return <rect x={x} y={y} width={width} height={height} rx={Math.min(3, width / 2, height / 2)} fill={fill} />
}

export function UsageSettings() {
  useLanguage()
  const [rows, setRows] = useState<UsageRow[] | null>(null)
  const [providers, setProviders] = useState<ProviderView[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [provider, setProvider] = useState(ALL_PROVIDERS)
  const [mode, setMode] = useState<GridMode>('daily')
  const [range, setRange] = useState('7')
  const [quota, setQuota] = useState<GoQuota | null>(null)

  const providerRef = useRef(provider)
  providerRef.current = provider
  const providersRef = useRef(providers)
  providersRef.current = providers

  /** The Go limits of the chosen provider; a late answer for another one is dropped. */
  const pick = useCallback(async (id: string, list: ProviderView[] = providersRef.current) => {
    setQuota(null)
    if (!isGoProvider(id, list)) return
    const answer = await usageGoQuota(id).catch(() => null)
    if (providerRef.current === id) setQuota(answer)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [stats, file] = await Promise.all([
        usageStats(),
        providersConfig().catch(() => null),
      ])
      const nextProviders = file?.providers ?? []
      setRows(stats.rows)
      setProviders(nextProviders)
      providersRef.current = nextProviders
      setError(null)
      void pick(providerRef.current, nextProviders)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [pick])

  useEffect(() => {
    void load()
  }, [load])

  const locale = localeTag()
  const count = (n: number) => compactCount(n, locale)
  const choices = providerChoices(
    rows ?? [],
    providers.map((p) => p.id),
  )
  const nameOf = (id: string) => {
    const p = providers.find((x) => x.id === id)
    return p ? displayName(p.name, p.id) : id
  }
  const logoOf = (id: string) => providers.find((p) => p.id === id)?.logo ?? null

  const mine = forProvider(rows ?? [], provider)
  const sums = totals(mine)
  const grid = activityGrid(mine, mode)
  const days = Number(range)
  const ranged = inRange(mine, days)
  const shares = modelShares(ranged)
  const points = dailySeries(ranged, shares, days)
  const rangeTokens = shares.reduce((sum, s) => sum + s.tokens, 0)

  /** Series keys safe in CSS variable names. */
  const series = shares.map((s, i) => ({
    key: `m${i}`,
    share: s,
    label: s.key === OTHER ? t('usage.other') : s.model,
    color: `var(--chart-${i + 1})`,
  }))
  const chartConfig = Object.fromEntries(
    series.map((s) => [s.key, { label: s.label, color: s.color }]),
  ) satisfies ChartConfig
  const chartData = points.map((p) => {
    // A model unused that day has no segment and no line in the tooltip.
    const out: Record<string, string | number | null> = { date: p.date }
    for (const s of series) out[s.key] = p[s.share.key] || null
    return out
  })
  const pieData = series.map((s) => ({
    key: s.key,
    tokens: s.share.tokens,
    fill: `var(--color-${s.key})`,
  }))

  const isGo = isGoProvider(provider, providers)
  const rangeLabel = range === '7' ? t('usage.last7') : t('usage.last30')

  const dayLabel = (key: string) =>
    dateTimeFormat({ day: 'numeric', month: 'short' }).format(fromKey(key))
  const monthLabel = (key: string) => dateTimeFormat({ month: 'short' }).format(fromKey(key))

  /** A month label above the first column of each month. */
  let lastMonth = -3
  const months = grid.map((column, i) => {
    const first = column[0].day.slice(0, 7)
    const previous = i > 0 ? grid[i - 1][0].day.slice(0, 7) : null
    // A month starting less than three columns after the last label stays unnamed.
    if (first === previous || i - lastMonth < 3) return ''
    lastMonth = i
    return monthLabel(column[0].day)
  })

  const percent = numberFormat({ style: 'percent', maximumFractionDigits: 0 })
  const share = numberFormat({ style: 'percent', maximumFractionDigits: 1 })

  /** The figures row, left to right. */
  const figures = [
    { label: t('usage.totalTokens'), value: count(sums.tokens), title: undefined },
    {
      label: t('usage.peakDay'),
      value: count(sums.peakTokens),
      title: sums.peakDay ? dayLabel(sums.peakDay) : undefined,
    },
    {
      label: t('usage.cost'),
      value: `${formatUsd(sums.costUsd)}${sums.unpriced > 0 ? '+' : ''}`,
      title: sums.unpriced > 0 ? t('usage.unpriced', { count: sums.unpriced }) : undefined,
    },
    {
      label: t('usage.currentStreak'),
      value: t('usage.days', { count: sums.currentStreak }),
      title: undefined,
    },
    {
      label: t('usage.longestStreak'),
      value: t('usage.days', { count: sums.longestStreak }),
      title: undefined,
    },
  ]

  const resets = (iso: string | null) =>
    iso
      ? dateTimeFormat({ weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(
          new Date(iso),
        )
      : null

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="flex items-center gap-1.5">
          <Select
            value={provider === ALL_PROVIDERS ? ALL_SENTINEL : provider}
            onValueChange={(value) => {
              const id = value === ALL_SENTINEL ? ALL_PROVIDERS : value
              setProvider(id)
              providerRef.current = id
              void pick(id)
            }}
          >
            <SelectTrigger size="sm" className="min-w-44">
              {provider === ALL_PROVIDERS ? (
                t('usage.allProviders')
              ) : (
                <span className="flex min-w-0 items-center gap-2">
                  <ProviderLogo logo={logoOf(provider)} className="size-4" />
                  <span className="truncate">{nameOf(provider)}</span>
                </span>
              )}
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_SENTINEL}>{t('usage.allProviders')}</SelectItem>
              {choices.map((id) => (
                <SelectItem key={id} value={id}>
                  <ProviderLogo logo={logoOf(id)} className="size-4" />
                  {nameOf(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t('common.refresh')}
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCwIcon className={cn(loading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden="true" />
          <AlertDescription>{t('usage.couldNotRead', { error })}</AlertDescription>
        </Alert>
      )}

      {rows && (
        <>
          <div className="flex rounded-xl bg-muted/50 py-4">
            {figures.map((figure, index) => (
              <Fragment key={figure.label}>
                {index > 0 && <Separator orientation="vertical" className="h-auto self-stretch" />}
                <div
                  className="flex min-w-0 flex-1 flex-col items-center gap-1 px-2 text-center"
                  title={figure.title}
                >
                  <span className="text-lg font-semibold text-foreground tabular-nums">
                    {figure.value}
                  </span>
                  <span className="text-xs text-muted-foreground">{figure.label}</span>
                </div>
              </Fragment>
            ))}
          </div>

          {isGo && quota && (
            <Card className="gap-3 py-4">
              <CardHeader className="px-4">
                <CardTitle className="text-ui">{t('usage.goLimits')}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 px-4 sm:grid-cols-3">
                {quota.windows.map((w) => {
                  const resetLabel = resets(w.resets_at)
                  return (
                    <div key={w.id} className="flex flex-col gap-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-foreground">
                          {w.id === 'rolling'
                            ? t('usage.window.rolling')
                            : w.id === 'weekly'
                              ? t('usage.window.weekly')
                              : t('usage.window.monthly')}
                        </span>
                        <span className="text-muted-foreground tabular-nums">
                          {percent.format(w.percent / 100)}
                        </span>
                      </div>
                      <Progress value={w.percent} max={100} />
                      {resetLabel && (
                        <span className="text-xs text-muted-foreground">
                          {t('usage.resetsAt', { when: resetLabel })}
                        </span>
                      )}
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          )}

          <Card className="gap-3 py-4">
            <CardHeader className="flex flex-row items-center justify-between gap-2 px-4">
              <CardTitle className="text-ui">{t('usage.activity')}</CardTitle>
              <ToggleGroup
                type="single"
                size="sm"
                variant="outline"
                value={mode}
                onValueChange={(v) => {
                  if (v) setMode(v as GridMode)
                }}
              >
                <ToggleGroupItem value="daily">{t('usage.daily')}</ToggleGroupItem>
                <ToggleGroupItem value="weekly">{t('usage.weekly')}</ToggleGroupItem>
                <ToggleGroupItem value="cumulative">{t('usage.cumulative')}</ToggleGroupItem>
              </ToggleGroup>
            </CardHeader>
            <CardContent className="px-4">
              <div className="flex w-full min-w-0 flex-col gap-1">
                <div
                  className="grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[2px] text-caption text-muted-foreground"
                  aria-hidden="true"
                >
                  {months.map((label, i) => (
                    <span key={i} className="overflow-visible whitespace-nowrap">
                      {label}
                    </span>
                  ))}
                </div>
                <div
                  className="grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[2px]"
                  role="img"
                  aria-label={t('usage.activity')}
                >
                  {grid.map((column, i) => (
                    <div key={i} className="flex flex-col gap-[2px]">
                      {column.map((cell) => (
                        <div
                          key={cell.day}
                          className={cn(
                            'aspect-square w-full rounded-[2px]',
                            cell.future ? 'bg-transparent' : LEVELS[cell.level],
                          )}
                          title={
                            cell.future
                              ? undefined
                              : t('usage.cellTitle', {
                                  day: dayLabel(cell.day),
                                  tokens: count(cell.tokens),
                                })
                          }
                        />
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center justify-between gap-2">
            <h4 className="text-ui text-foreground">{t('usage.range')}</h4>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={range}
              onValueChange={(v) => {
                if (v) setRange(v)
              }}
            >
              <ToggleGroupItem value="7">{t('usage.last7')}</ToggleGroupItem>
              <ToggleGroupItem value="30">{t('usage.last30')}</ToggleGroupItem>
            </ToggleGroup>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('usage.dailyTokens')}</CardTitle>
              <CardDescription>{rangeLabel}</CardDescription>
            </CardHeader>
            <CardContent>
              {rangeTokens === 0 ? (
                <Empty className="h-40 border border-dashed">
                  <EmptyHeader>
                    <EmptyTitle>{t('usage.noData')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              ) : (
                <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
                  <BarChart accessibilityLayer data={chartData}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      interval={0}
                      tickFormatter={(value: string, index: number) =>
                        days <= 7 || index % 5 === 0 ? dayLabel(value) : ''
                      }
                    />
                    <ChartTooltip
                      cursor={false}
                      content={
                        <ChartTooltipContent
                          indicator="dot"
                          labelFormatter={(value) =>
                            typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
                              ? dayLabel(value)
                              : String(value ?? '')
                          }
                        />
                      }
                    />
                    {series.map((s) => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        stackId="tokens"
                        fill={`var(--color-${s.key})`}
                        shape={<StackSegment />}
                        maxBarSize={56}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                </ChartContainer>
              )}
            </CardContent>
          </Card>

          <Card className="flex flex-col">
            <CardHeader className="items-center pb-0 text-center">
              <CardTitle>{t('usage.byModel')}</CardTitle>
              <CardDescription>{rangeLabel}</CardDescription>
            </CardHeader>
            {rangeTokens === 0 ? (
              <CardContent>
                <Empty className="h-40 border border-dashed">
                  <EmptyHeader>
                    <EmptyTitle>{t('usage.noData')}</EmptyTitle>
                  </EmptyHeader>
                </Empty>
              </CardContent>
            ) : (
              <>
                <CardContent className="flex-1 pb-0">
                  <ChartContainer config={chartConfig} className="mx-auto aspect-square max-h-[250px]">
                    <PieChart>
                      <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
                      <Pie
                        data={pieData}
                        dataKey="tokens"
                        nameKey="key"
                        innerRadius={60}
                        strokeWidth={5}
                        isAnimationActive={false}
                      >
                        <Label
                          content={({ viewBox }) => {
                            if (viewBox && 'cx' in viewBox && 'cy' in viewBox) {
                              return (
                                <text
                                  x={viewBox.cx}
                                  y={viewBox.cy}
                                  textAnchor="middle"
                                  dominantBaseline="middle"
                                >
                                  <tspan
                                    x={viewBox.cx}
                                    y={viewBox.cy}
                                    className="fill-foreground text-3xl font-bold"
                                  >
                                    {count(rangeTokens)}
                                  </tspan>
                                  <tspan
                                    x={viewBox.cx}
                                    y={(viewBox.cy ?? 0) + 24}
                                    className="fill-muted-foreground"
                                  >
                                    {t('usage.tokensUnit')}
                                  </tspan>
                                </text>
                              )
                            }
                            return null
                          }}
                        />
                      </Pie>
                    </PieChart>
                  </ChartContainer>
                </CardContent>
                <CardFooter className="flex-col items-stretch gap-2 text-sm">
                  {series.map((s) => (
                    <div
                      key={s.key}
                      className="flex items-center gap-2 leading-none"
                      title={t('usage.requests', { count: s.share.requests })}
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-[2px]"
                        style={{ backgroundColor: s.color }}
                        aria-hidden="true"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium">{s.label}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {count(s.share.tokens)}
                      </span>
                      <span className="w-12 text-right text-muted-foreground tabular-nums">
                        {share.format(s.share.tokens / rangeTokens)}
                      </span>
                    </div>
                  ))}
                </CardFooter>
              </>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

export default UsageSettings
