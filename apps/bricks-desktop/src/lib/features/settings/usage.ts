// Pure helpers of the « Usage » settings: daily rows from the usage ledger turned into totals,
// streaks, the activity grid, a daily series per model and model shares. No state, no IPC.

import type { UsageRow } from '$lib/ipc/bindings/UsageRow';

/** Every provider. */
export const ALL_PROVIDERS = '';

/** The tokens a row consumed: prompt (cache included) and output. */
export function rowTokens(row: UsageRow): number {
	return row.input_tokens + row.output_tokens + row.cache_read_input_tokens + row.cache_creation_input_tokens;
}

export function forProvider(rows: UsageRow[], provider: string): UsageRow[] {
	return provider === ALL_PROVIDERS ? rows : rows.filter((r) => r.provider === provider);
}

/** `YYYY-MM-DD` of a local date. */
export function dayKey(date: Date): string {
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${date.getFullYear()}-${m}-${d}`;
}

/** The local date of a `YYYY-MM-DD` key, at midnight. */
export function fromKey(key: string): Date {
	const [y, m, d] = key.split('-').map(Number);
	return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** Tokens per day. */
export function tokensByDay(rows: UsageRow[]): Map<string, number> {
	const out = new Map<string, number>();
	for (const row of rows) out.set(row.date, (out.get(row.date) ?? 0) + rowTokens(row));
	return out;
}

export interface UsageTotals {
	tokens: number;
	/** The busiest day's tokens, and that day. */
	peakTokens: number;
	peakDay: string | null;
	costUsd: number;
	/** Responses with no known price, left out of the cost. */
	unpriced: number;
	requests: number;
	/** Consecutive active days ending today (or yesterday, when today is still empty). */
	currentStreak: number;
	longestStreak: number;
	activeDays: number;
}

export function totals(rows: UsageRow[], today: Date = new Date()): UsageTotals {
	const days = tokensByDay(rows);
	let peakTokens = 0;
	let peakDay: string | null = null;
	for (const [day, tokens] of days) {
		if (tokens > peakTokens) {
			peakTokens = tokens;
			peakDay = day;
		}
	}
	const active = new Set([...days].filter(([, tokens]) => tokens > 0).map(([day]) => day));
	return {
		tokens: rows.reduce((sum, r) => sum + rowTokens(r), 0),
		peakTokens,
		peakDay,
		costUsd: rows.reduce((sum, r) => sum + r.cost_usd, 0),
		unpriced: rows.reduce((sum, r) => sum + r.unpriced_requests, 0),
		requests: rows.reduce((sum, r) => sum + r.requests, 0),
		currentStreak: currentStreak(active, today),
		longestStreak: longestStreak(active),
		activeDays: active.size
	};
}

function currentStreak(active: Set<string>, today: Date): number {
	let day = active.has(dayKey(today)) ? today : addDays(today, -1);
	let streak = 0;
	while (active.has(dayKey(day))) {
		streak += 1;
		day = addDays(day, -1);
	}
	return streak;
}

function longestStreak(active: Set<string>): number {
	let best = 0;
	for (const key of active) {
		// Count only from the first day of a run.
		if (active.has(dayKey(addDays(fromKey(key), -1)))) continue;
		let length = 0;
		let day = fromKey(key);
		while (active.has(dayKey(day))) {
			length += 1;
			day = addDays(day, 1);
		}
		best = Math.max(best, length);
	}
	return best;
}

// ─── Activity grid ───────────────────────────────────────────────────────────

export type GridMode = 'daily' | 'weekly' | 'cumulative';

export interface GridCell {
	day: string;
	/** The value the cell shows (the day's, its week's or the running total). */
	tokens: number;
	/** 0 (nothing) to 4 (the most). */
	level: number;
	/** After today: drawn empty. */
	future: boolean;
}

/** A column per week (Monday first), the last one holding today; `weeks` columns. */
export function activityGrid(rows: UsageRow[], mode: GridMode, today: Date = new Date(), weeks = 53): GridCell[][] {
	const days = tokensByDay(rows);
	const monday = addDays(today, -((today.getDay() + 6) % 7));
	const start = addDays(monday, -7 * (weeks - 1));
	const columns: GridCell[][] = [];
	let running = 0;
	for (const [day, tokens] of days) if (day < dayKey(start)) running += tokens;
	for (let w = 0; w < weeks; w++) {
		const column: GridCell[] = [];
		let week = 0;
		for (let d = 0; d < 7; d++) week += days.get(dayKey(addDays(start, w * 7 + d))) ?? 0;
		for (let d = 0; d < 7; d++) {
			const date = addDays(start, w * 7 + d);
			const key = dayKey(date);
			const own = days.get(key) ?? 0;
			running += own;
			const future = date > today;
			const tokens = future ? 0 : mode === 'daily' ? own : mode === 'weekly' ? week : running;
			column.push({ day: key, tokens, level: 0, future });
		}
		columns.push(column);
	}
	const max = Math.max(0, ...columns.flat().map((c) => c.tokens));
	for (const cell of columns.flat()) {
		cell.level = cell.tokens <= 0 || max === 0 ? 0 : Math.min(4, Math.ceil((cell.tokens / max) * 4));
	}
	return columns;
}

// ─── Range charts ────────────────────────────────────────────────────────────

/** Models past this many go into « other ». */
export const MAX_SERIES = 5;
export const OTHER = '__other__';

export interface ModelShare {
	/** `provider/model`, or `OTHER`. */
	key: string;
	model: string;
	provider: string;
	tokens: number;
	costUsd: number;
	requests: number;
}

export function inRange(rows: UsageRow[], days: number, today: Date = new Date()): UsageRow[] {
	const from = dayKey(addDays(today, -(days - 1)));
	const to = dayKey(today);
	return rows.filter((r) => r.date >= from && r.date <= to);
}

/** Models by tokens, the largest first; past `MAX_SERIES`, the rest are summed as `OTHER`. */
export function modelShares(rows: UsageRow[]): ModelShare[] {
	const by = new Map<string, ModelShare>();
	for (const row of rows) {
		const key = `${row.provider}/${row.model}`;
		const share = by.get(key) ?? { key, model: row.model, provider: row.provider, tokens: 0, costUsd: 0, requests: 0 };
		share.tokens += rowTokens(row);
		share.costUsd += row.cost_usd;
		share.requests += row.requests;
		by.set(key, share);
	}
	const sorted = [...by.values()].sort((a, b) => b.tokens - a.tokens);
	if (sorted.length <= MAX_SERIES) return sorted;
	const rest = sorted.slice(MAX_SERIES - 1);
	return [
		...sorted.slice(0, MAX_SERIES - 1),
		rest.reduce(
			(acc, s) => ({ ...acc, tokens: acc.tokens + s.tokens, costUsd: acc.costUsd + s.costUsd, requests: acc.requests + s.requests }),
			{ key: OTHER, model: OTHER, provider: '', tokens: 0, costUsd: 0, requests: 0 } as ModelShare
		)
	];
}

/** One point per day of the range (empty days included), tokens per series key. */
export function dailySeries(rows: UsageRow[], shares: ModelShare[], days: number, today: Date = new Date()): Record<string, string | number>[] {
	const keys = new Set(shares.map((s) => s.key));
	const points: Record<string, string | number>[] = [];
	for (let i = days - 1; i >= 0; i--) {
		const point: Record<string, string | number> = { date: dayKey(addDays(today, -i)) };
		for (const s of shares) point[s.key] = 0;
		points.push(point);
	}
	const index = new Map(points.map((p, i) => [p.date as string, i]));
	for (const row of rows) {
		const at = index.get(row.date);
		if (at === undefined) continue;
		const key = `${row.provider}/${row.model}`;
		const series = keys.has(key) ? key : OTHER;
		if (!keys.has(series)) continue;
		points[at][series] = (points[at][series] as number) + rowTokens(row);
	}
	return points;
}

/** Providers present in the ledger or configured, in that order, without repeats. */
export function providerChoices(rows: UsageRow[], configured: string[]): string[] {
	const out: string[] = [];
	for (const id of [...configured, ...rows.map((r) => r.provider)]) {
		if (id && !out.includes(id)) out.push(id);
	}
	return out;
}

/** 1.2K, 3.4M, 5.6B: a compact count. */
export function compactCount(n: number, locale: string): string {
	return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
