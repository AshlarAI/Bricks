<script lang="ts">
	// « Consommation »: what the model responses consumed, from the usage ledger, for every
	// provider or one. Figures, a year of activity, tokens per day and per model over 7 or 30
	// days, and for OpenCode Go the share of its limits the key has used.
	import { dateTimeFormat, localeTag, numberFormat, t } from '$lib/i18n/i18n.svelte';
	import { onMount } from 'svelte';
	import { scaleBand } from 'd3-scale';
	import { BarChart, PieChart, Text } from 'layerchart';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import * as Alert from '$lib/components/ui/alert';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as Chart from '$lib/components/ui/chart';
	import * as Empty from '$lib/components/ui/empty';
	import { Progress } from '$lib/components/ui/progress';
	import * as Select from '$lib/components/ui/select';
	import * as ToggleGroup from '$lib/components/ui/toggle-group';
	import { errorMessage, providersConfig, usageGoQuota, usageStats } from '$lib/ipc/client';
	import type { GoQuota } from '$lib/ipc/bindings/GoQuota';
	import type { ProviderView } from '$lib/ipc/bindings/ProviderView';
	import type { UsageRow } from '$lib/ipc/bindings/UsageRow';
	import { formatUsd } from '$lib/features/inspect/format';
	import { cn } from '$lib/utils';
	import ProviderLogo from './ProviderLogo.svelte';
	import { displayName } from './models';
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
		type GridMode
	} from './usage';

	let rows = $state<UsageRow[] | null>(null);
	let providers = $state<ProviderView[]>([]);
	let error = $state<string | null>(null);
	let loading = $state(false);
	let provider = $state(ALL_PROVIDERS);
	let mode = $state<GridMode>('daily');
	let range = $state('7');
	let quota = $state<GoQuota | null>(null);

	async function load() {
		loading = true;
		try {
			const [stats, file] = await Promise.all([usageStats(), providersConfig().catch(() => null)]);
			rows = stats.rows;
			providers = file?.providers ?? [];
			error = null;
			void pick(provider);
		} catch (e) {
			error = errorMessage(e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		void load();
	});

	const locale = $derived(localeTag());
	const count = (n: number) => compactCount(n, locale);
	const choices = $derived(providerChoices(rows ?? [], providers.map((p) => p.id)));
	const nameOf = (id: string) => {
		const p = providers.find((x) => x.id === id);
		return p ? displayName(p.name, p.id) : id;
	};
	const logoOf = (id: string) => providers.find((p) => p.id === id)?.logo ?? null;

	const mine = $derived(forProvider(rows ?? [], provider));
	const sums = $derived(totals(mine));
	const grid = $derived(activityGrid(mine, mode));
	const days = $derived(Number(range));
	const ranged = $derived(inRange(mine, days));
	const shares = $derived(modelShares(ranged));
	const points = $derived(dailySeries(ranged, shares, days));
	const rangeTokens = $derived(shares.reduce((sum, s) => sum + s.tokens, 0));

	/** Series keys safe in CSS variable names. */
	const series = $derived(
		shares.map((s, i) => ({
			key: `m${i}`,
			share: s,
			label: s.key === OTHER ? t('usage.other') : s.model,
			color: `var(--chart-${i + 1})`
		}))
	);
	const chartConfig = $derived(
		Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies Chart.ChartConfig
	);
	const chartData = $derived(
		points.map((p) => {
			const out: Record<string, string | number> = { date: p.date };
			for (const s of series) out[s.key] = p[s.share.key] ?? 0;
			return out;
		})
	);
	const pieData = $derived(series.map((s) => ({ key: s.key, tokens: s.share.tokens, color: s.color })));

	const isGoProvider = (id: string) => {
		const p = providers.find((x) => x.id === id);
		return !!p && /^https:\/\/opencode\.ai\/(inference|zen)\/go(\/|$)/i.test(p.endpoint.trim());
	};
	const isGo = $derived(isGoProvider(provider));

	/** The Go limits of the chosen provider; a late answer for another one is dropped. */
	async function pick(id: string) {
		quota = null;
		if (!isGoProvider(id)) return;
		const answer = await usageGoQuota(id).catch(() => null);
		if (provider === id) quota = answer;
	}

	const dayLabel = (key: string) => dateTimeFormat({ day: 'numeric', month: 'short' }).format(fromKey(key));
	const monthLabel = (key: string) => dateTimeFormat({ month: 'short' }).format(fromKey(key));
	/** A month label above the first column of each month. */
	const months = $derived.by(() => {
		let last = -3;
		return grid.map((column, i) => {
			const first = column[0].day.slice(0, 7);
			const previous = i > 0 ? grid[i - 1][0].day.slice(0, 7) : null;
			// A month starting less than three columns after the last label stays unnamed.
			if (first === previous || i - last < 3) return '';
			last = i;
			return monthLabel(column[0].day);
		});
	});
	const percent = $derived(numberFormat({ style: 'percent', maximumFractionDigits: 0 }));
	const LEVELS = ['bg-muted-foreground/10', 'bg-chart-1/25', 'bg-chart-1/50', 'bg-chart-1/75', 'bg-chart-1'];
	const resets = (iso: string | null) =>
		iso ? dateTimeFormat({ weekday: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : null;
</script>

<div class="flex w-full min-w-0 flex-col gap-4">
	<div class="flex flex-wrap items-center justify-between gap-2">
		<h3 class="text-ui font-semibold text-foreground">{t('common.usage')}</h3>
		<div class="flex items-center gap-1.5">
			<Select.Root type="single" bind:value={provider} onValueChange={(id) => void pick(id)}>
				<Select.Trigger size="sm" class="min-w-44">
					{#if provider === ALL_PROVIDERS}
						{t('usage.allProviders')}
					{:else}
						<ProviderLogo logo={logoOf(provider)} class="size-4" />
						<span class="truncate">{nameOf(provider)}</span>
					{/if}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value={ALL_PROVIDERS}>{t('usage.allProviders')}</Select.Item>
					{#each choices as id (id)}
						<Select.Item value={id}>
							<ProviderLogo logo={logoOf(id)} class="size-4" />
							{nameOf(id)}
						</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
			<Button variant="outline" size="icon-sm" aria-label={t('common.refresh')} onclick={load} disabled={loading}>
				<RefreshCw class={cn(loading && 'animate-spin')} />
			</Button>
		</div>
	</div>

	{#if error}
		<Alert.Root variant="destructive">
			<TriangleAlert aria-hidden="true" />
			<Alert.Description>{t('usage.couldNotRead', { error })}</Alert.Description>
		</Alert.Root>
	{/if}

	{#if rows}
		<dl class="grid grid-cols-2 gap-y-3 rounded-xl bg-muted/50 py-4 sm:grid-cols-5 sm:divide-x sm:divide-border">
			<div class="flex flex-col items-center gap-1 px-2">
				<dd class="text-lg font-semibold text-foreground tabular-nums">{count(sums.tokens)}</dd>
				<dt class="text-xs text-muted-foreground">{t('usage.totalTokens')}</dt>
			</div>
			<div class="flex flex-col items-center gap-1 px-2" title={sums.peakDay ? dayLabel(sums.peakDay) : undefined}>
				<dd class="text-lg font-semibold text-foreground tabular-nums">{count(sums.peakTokens)}</dd>
				<dt class="text-xs text-muted-foreground">{t('usage.peakDay')}</dt>
			</div>
			<div
				class="flex flex-col items-center gap-1 px-2"
				title={sums.unpriced > 0 ? t('usage.unpriced', { count: sums.unpriced }) : undefined}
			>
				<dd class="text-lg font-semibold text-foreground tabular-nums">
					{formatUsd(sums.costUsd)}{sums.unpriced > 0 ? '+' : ''}
				</dd>
				<dt class="text-xs text-muted-foreground">{t('usage.cost')}</dt>
			</div>
			<div class="flex flex-col items-center gap-1 px-2">
				<dd class="text-lg font-semibold text-foreground tabular-nums">{t('usage.days', { count: sums.currentStreak })}</dd>
				<dt class="text-xs text-muted-foreground">{t('usage.currentStreak')}</dt>
			</div>
			<div class="flex flex-col items-center gap-1 px-2">
				<dd class="text-lg font-semibold text-foreground tabular-nums">{t('usage.days', { count: sums.longestStreak })}</dd>
				<dt class="text-xs text-muted-foreground">{t('usage.longestStreak')}</dt>
			</div>
		</dl>

		{#if isGo && quota}
			<Card.Root class="gap-3 py-4">
				<Card.Header class="px-4">
					<Card.Title class="text-ui">{t('usage.goLimits')}</Card.Title>
				</Card.Header>
				<Card.Content class="grid gap-4 px-4 sm:grid-cols-3">
					{#each quota.windows as w (w.id)}
						<div class="flex flex-col gap-1.5">
							<div class="flex items-baseline justify-between gap-2 text-xs">
								<span class="text-foreground">
									{w.id === 'rolling' ? t('usage.window.rolling') : w.id === 'weekly' ? t('usage.window.weekly') : t('usage.window.monthly')}
								</span>
								<span class="text-muted-foreground tabular-nums">{percent.format(w.percent / 100)}</span>
							</div>
							<Progress value={w.percent} max={100} />
							{#if resets(w.resets_at)}
								<span class="text-xs text-muted-foreground">{t('usage.resetsAt', { when: resets(w.resets_at) ?? '' })}</span>
							{/if}
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root class="gap-3 py-4">
			<Card.Header class="flex flex-row items-center justify-between gap-2 px-4">
				<Card.Title class="text-ui">{t('usage.activity')}</Card.Title>
				<ToggleGroup.Root type="single" size="sm" variant="outline" bind:value={() => mode, (v) => v && (mode = v as GridMode)}>
					<ToggleGroup.Item value="daily">{t('usage.daily')}</ToggleGroup.Item>
					<ToggleGroup.Item value="weekly">{t('usage.weekly')}</ToggleGroup.Item>
					<ToggleGroup.Item value="cumulative">{t('usage.cumulative')}</ToggleGroup.Item>
				</ToggleGroup.Root>
			</Card.Header>
			<Card.Content class="px-4">
				<div class="flex w-full min-w-0 flex-col gap-1">
					<div class="grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[2px] text-caption text-muted-foreground" aria-hidden="true">
						{#each months as label, i (i)}
							<span class="overflow-visible whitespace-nowrap">{label}</span>
						{/each}
					</div>
					<div class="grid grid-cols-[repeat(53,minmax(0,1fr))] gap-[2px]" role="img" aria-label={t('usage.activity')}>
						{#each grid as column, i (i)}
							<div class="flex flex-col gap-[2px]">
								{#each column as cell (cell.day)}
									<div
										class={cn('aspect-square w-full rounded-[2px]', cell.future ? 'bg-transparent' : LEVELS[cell.level])}
										title={cell.future ? undefined : t('usage.cellTitle', { day: dayLabel(cell.day), tokens: count(cell.tokens) })}
									></div>
								{/each}
							</div>
						{/each}
					</div>
				</div>
			</Card.Content>
		</Card.Root>

		<div class="flex items-center justify-between gap-2">
			<h4 class="text-ui text-foreground">{t('usage.range')}</h4>
			<ToggleGroup.Root type="single" size="sm" variant="outline" bind:value={() => range, (v) => v && (range = v)}>
				<ToggleGroup.Item value="7">{t('usage.last7')}</ToggleGroup.Item>
				<ToggleGroup.Item value="30">{t('usage.last30')}</ToggleGroup.Item>
			</ToggleGroup.Root>
		</div>

		<Card.Root class="gap-3 py-4">
			<Card.Header class="px-4">
				<Card.Title class="text-ui">{t('usage.dailyTokens')}</Card.Title>
			</Card.Header>
			<Card.Content class="px-4">
				{#if rangeTokens === 0}
					<Empty.Root class="h-40 border border-dashed">
						<Empty.Header>
							<Empty.Title>{t('usage.noData')}</Empty.Title>
						</Empty.Header>
					</Empty.Root>
				{:else}
					<Chart.Container config={chartConfig} class="aspect-auto h-56 w-full">
						<BarChart
							data={chartData}
							xScale={scaleBand().padding(0.25)}
							x="date"
							axis="x"
							rule={false}
							series={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))}
							seriesLayout="stack"
							props={{
								bars: { stroke: 'none' },
								highlight: { area: false },
								xAxis: {
									format: (d: string) => {
										const i = chartData.findIndex((p) => p.date === d);
										return days <= 7 || i % 5 === 0 ? dayLabel(d) : '';
									}
								}
							}}
						>
							{#snippet tooltip()}
								<Chart.Tooltip labelFormatter={(d: string) => dayLabel(d)} />
							{/snippet}
						</BarChart>
					</Chart.Container>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="gap-3 py-4">
			<Card.Header class="px-4">
				<Card.Title class="text-ui">{t('usage.byModel')}</Card.Title>
			</Card.Header>
			<Card.Content class="px-4">
				{#if rangeTokens === 0}
					<Empty.Root class="h-40 border border-dashed">
						<Empty.Header>
							<Empty.Title>{t('usage.noData')}</Empty.Title>
						</Empty.Header>
					</Empty.Root>
				{:else}
					<div class="grid items-center gap-4 sm:grid-cols-[12rem_minmax(0,1fr)]">
						<Chart.Container config={chartConfig} class="mx-auto aspect-square h-48">
							<PieChart data={pieData} key="key" value="tokens" c="color" innerRadius={56} padding={8}>
								{#snippet aboveMarks()}
									<Text
										value={count(rangeTokens)}
										textAnchor="middle"
										verticalAnchor="middle"
										class="fill-foreground text-lg! font-semibold"
									/>
								{/snippet}
								{#snippet tooltip()}
									<Chart.Tooltip hideLabel />
								{/snippet}
							</PieChart>
						</Chart.Container>
						<ul class="flex flex-col gap-2 text-ui">
							{#each series as s (s.key)}
								<li class="flex items-center gap-2">
									<span class="size-2.5 shrink-0 rounded-[3px]" style:background-color={s.color} aria-hidden="true"></span>
									<span class="min-w-0 flex-1 truncate text-foreground" title={s.share.key === OTHER ? undefined : s.share.key}>{s.label}</span>
									<span class="text-xs text-muted-foreground tabular-nums">{t('usage.requests', { count: s.share.requests })}</span>
									<span class="w-14 text-right text-xs text-foreground tabular-nums">{count(s.share.tokens)}</span>
									<span class="w-16 text-right text-xs text-muted-foreground tabular-nums">{formatUsd(s.share.costUsd)}</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}
</div>
