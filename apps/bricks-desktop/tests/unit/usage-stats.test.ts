// Unit tests for the pure helpers of the « Usage » settings: totals and streaks, the activity grid,
// the range charts and the provider choices. Each test fixes the day, so the clock never matters.
import { describe, expect, it } from 'vitest';
import type { UsageRow } from '../../src/lib/ipc/bindings/UsageRow';
import {
	ALL_PROVIDERS,
	MAX_SERIES,
	OTHER,
	activityGrid,
	dailySeries,
	dayKey,
	forProvider,
	fromKey,
	inRange,
	modelShares,
	providerChoices,
	rowTokens,
	totals,
	type GridCell,
	type GridMode
} from '../../src/lib/features/settings/usage';

/** Tuesday 17 November 2026, at local midnight. */
const TODAY = new Date(2026, 10, 17);

/** A row of `acme/alpha` on `date`, with every count at zero unless given. */
function usage(date: string, overrides: Partial<UsageRow> = {}): UsageRow {
	return {
		date,
		provider: 'acme',
		model: 'alpha',
		requests: 1,
		sessions: 1,
		input_tokens: 0,
		output_tokens: 0,
		cache_read_input_tokens: 0,
		cache_creation_input_tokens: 0,
		cost_usd: 0,
		unpriced_requests: 0,
		...overrides
	};
}

/** A row with one input token, so that its day counts as active. */
function spent(date: string): UsageRow {
	return usage(date, { input_tokens: 1 });
}

/** Seven models on one day: the first uses the most (`(count - i) * 100` tokens, `count - i` quarters of a dollar). */
function models(count: number, date: string): UsageRow[] {
	return Array.from({ length: count }, (_, i) =>
		usage(date, {
			model: `m${i}`,
			input_tokens: (count - i) * 100,
			cost_usd: (count - i) * 0.25,
			requests: i + 1
		})
	);
}

/** The grid cell of `day`. */
function cellOf(grid: GridCell[][], day: string): GridCell {
	const cell = grid.flat().find((c) => c.day === day);
	if (!cell) throw new Error(`no cell for ${day}`);
	return cell;
}

describe('rowTokens', () => {
	it('adds the input, output and both cache counts', () => {
		const row = usage('2026-11-17', {
			input_tokens: 10,
			output_tokens: 20,
			cache_read_input_tokens: 30,
			cache_creation_input_tokens: 40
		});
		expect(rowTokens(row)).toBe(100);
	});
});

describe('forProvider', () => {
	const rows = [
		usage('2026-11-17', { provider: 'acme' }),
		usage('2026-11-17', { provider: 'beta' }),
		usage('2026-11-16', { provider: 'acme' })
	];

	it('keeps every row for the empty id, which stands for all providers', () => {
		expect(ALL_PROVIDERS).toBe('');
		expect(forProvider(rows, ALL_PROVIDERS)).toEqual(rows);
	});

	it('keeps the rows of one provider, and none for an unknown one', () => {
		expect(forProvider(rows, 'acme').map((r) => r.date)).toEqual(['2026-11-17', '2026-11-16']);
		expect(forProvider(rows, 'missing')).toEqual([]);
	});
});

describe('dayKey and fromKey', () => {
	it('writes a local date as YYYY-MM-DD, with the month and day padded', () => {
		expect(dayKey(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
	});

	it('reads a key as local midnight of that day', () => {
		const date = fromKey('2026-11-17');
		expect([date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()]).toEqual([2026, 10, 17, 0]);
	});

	it.each(['2025-12-31', '2026-02-28', '2026-03-01', '2026-11-17'])('round-trips %s', (key) => {
		expect(dayKey(fromKey(key))).toBe(key);
	});
});

describe('totals', () => {
	const rows = [
		usage('2026-11-16', {
			input_tokens: 100,
			output_tokens: 50,
			cache_read_input_tokens: 20,
			cache_creation_input_tokens: 30,
			requests: 3,
			cost_usd: 0.5,
			unpriced_requests: 1
		}),
		usage('2026-11-17', { input_tokens: 10, output_tokens: 5, requests: 2, cost_usd: 0.25 })
	];

	it('adds up the tokens, the costs, the requests and the unpriced responses', () => {
		expect(totals(rows, TODAY)).toMatchObject({
			tokens: 215,
			costUsd: 0.75,
			unpriced: 1,
			requests: 5
		});
	});

	it('names the busiest day and its tokens', () => {
		expect(totals(rows, TODAY)).toMatchObject({ peakTokens: 200, peakDay: '2026-11-16' });
	});

	it('is empty for no rows', () => {
		expect(totals([], TODAY)).toEqual({
			tokens: 0,
			peakTokens: 0,
			peakDay: null,
			costUsd: 0,
			unpriced: 0,
			requests: 0,
			currentStreak: 0,
			longestStreak: 0,
			activeDays: 0
		});
	});

	it('counts only the days with tokens as active, though requests still add up', () => {
		const result = totals([...rows, usage('2026-11-10', { requests: 4 })], TODAY);
		expect(result.activeDays).toBe(2);
		expect(result.requests).toBe(9);
	});

	it('counts a current streak that ends today', () => {
		const result = totals([spent('2026-11-15'), spent('2026-11-16'), spent('2026-11-17')], TODAY);
		expect(result).toMatchObject({ currentStreak: 3, longestStreak: 3 });
	});

	it('starts the current streak yesterday when today is still empty', () => {
		const result = totals([spent('2026-11-14'), spent('2026-11-15'), spent('2026-11-16')], TODAY);
		expect(result).toMatchObject({ currentStreak: 3 });
	});

	it('has no current streak when neither today nor yesterday is active', () => {
		expect(totals([spent('2026-11-15')], TODAY)).toMatchObject({ currentStreak: 0, longestStreak: 1 });
	});

	it('keeps the longest run across a gap, and the current run apart', () => {
		const days = [
			'2026-11-01',
			'2026-11-02',
			'2026-11-03',
			'2026-11-04',
			'2026-11-10',
			'2026-11-11',
			'2026-11-16',
			'2026-11-17'
		];
		expect(totals(days.map((d) => spent(d)), TODAY)).toMatchObject({
			currentStreak: 2,
			longestStreak: 4,
			activeDays: 8
		});
	});
});

describe('activityGrid', () => {
	it('has 53 columns of seven days by default', () => {
		const grid = activityGrid([], 'daily', TODAY);
		expect(grid).toHaveLength(53);
		expect(grid.every((column) => column.length === 7)).toBe(true);
	});

	it('takes another number of weeks', () => {
		expect(activityGrid([], 'daily', TODAY, 10)).toHaveLength(10);
	});

	it('starts every column on a Monday and runs its days in order', () => {
		const grid = activityGrid([], 'daily', TODAY);
		for (const column of grid) {
			expect(column.map((cell) => fromKey(cell.day).getDay())).toEqual([1, 2, 3, 4, 5, 6, 0]);
		}
	});

	it('starts the first column 52 weeks before this week, and holds today in the last one', () => {
		const grid = activityGrid([], 'daily', TODAY);
		expect(grid[0][0].day).toBe('2025-11-17');
		expect(grid[52][1].day).toBe('2026-11-17');
	});

	it('draws the days after today as future, with no tokens', () => {
		const grid = activityGrid([usage('2026-11-20', { input_tokens: 1000 }), spent('2026-11-16')], 'daily', TODAY);
		for (const cell of grid.flat()) {
			expect(cell.future).toBe(cell.day > '2026-11-17');
		}
		expect(cellOf(grid, '2026-11-20')).toMatchObject({ future: true, tokens: 0, level: 0 });
		expect(cellOf(grid, '2026-11-17').future).toBe(false);
	});

	it('scales the levels from 0 to 4, with the busiest day at 4', () => {
		const grid = activityGrid(
			[
				usage('2026-11-16', { input_tokens: 400 }),
				usage('2026-11-15', { input_tokens: 300 }),
				usage('2026-11-14', { input_tokens: 200 }),
				usage('2026-11-13', { input_tokens: 100 }),
				usage('2026-11-12', { input_tokens: 10 })
			],
			'daily',
			TODAY
		);
		expect(cellOf(grid, '2026-11-16').level).toBe(4);
		expect(cellOf(grid, '2026-11-15').level).toBe(3);
		expect(cellOf(grid, '2026-11-14').level).toBe(2);
		expect(cellOf(grid, '2026-11-13').level).toBe(1);
		expect(cellOf(grid, '2026-11-12').level).toBe(1);
		expect(cellOf(grid, '2026-11-11').level).toBe(0);
		const levels = grid.flat().map((c) => c.level);
		expect(Math.min(...levels)).toBe(0);
		expect(Math.max(...levels)).toBe(4);
	});

	it('gives every day of a week the week total in weekly mode', () => {
		const grid = activityGrid(
			[
				usage('2026-11-09', { input_tokens: 100 }),
				usage('2026-11-12', { input_tokens: 50 }),
				usage('2026-11-16', { input_tokens: 20 }),
				usage('2026-11-17', { input_tokens: 30 })
			],
			'weekly',
			TODAY
		);
		const week = grid.find((column) => column.some((c) => c.day === '2026-11-12'));
		expect(week?.map((c) => c.tokens)).toEqual([150, 150, 150, 150, 150, 150, 150]);
		expect(cellOf(grid, '2026-11-16').tokens).toBe(50);
		expect(cellOf(grid, '2026-11-17').tokens).toBe(50);
		expect(cellOf(grid, '2026-11-18').tokens).toBe(0);
	});

	it('runs the total in cumulative mode, carrying earlier rows in, and never goes down', () => {
		const grid = activityGrid(
			[usage('2025-11-01', { input_tokens: 5 }), usage('2026-11-09', { input_tokens: 100 }), usage('2026-11-17', { input_tokens: 50 })],
			'cumulative',
			TODAY
		);
		const shown = grid.flat().filter((c) => !c.future).map((c) => c.tokens);
		expect(grid[0][0].tokens).toBe(5);
		expect(shown.every((value, i) => i === 0 || value >= shown[i - 1])).toBe(true);
		expect(shown.at(-1)).toBe(155);
	});
});

describe('inRange', () => {
	const rows = [usage('2026-11-10'), usage('2026-11-11'), usage('2026-11-17'), usage('2026-11-18')];

	it('keeps the rows of the last N days, today included', () => {
		expect(inRange(rows, 7, TODAY).map((r) => r.date)).toEqual(['2026-11-11', '2026-11-17']);
	});

	it('keeps only today for a range of one day', () => {
		expect(inRange(rows, 1, TODAY).map((r) => r.date)).toEqual(['2026-11-17']);
	});
});

describe('modelShares', () => {
	it('sorts the models by tokens, the largest first, and adds up the rows of each', () => {
		const shares = modelShares([
			usage('2026-11-16', { model: 'alpha', input_tokens: 100, cost_usd: 0.5 }),
			usage('2026-11-17', { model: 'alpha', input_tokens: 50, cost_usd: 0.25 }),
			usage('2026-11-17', { model: 'gamma', input_tokens: 10 }),
			usage('2026-11-17', { model: 'beta', input_tokens: 300 })
		]);
		expect(shares.map((s) => s.model)).toEqual(['beta', 'alpha', 'gamma']);
		expect(shares[1]).toEqual({
			key: 'acme/alpha',
			model: 'alpha',
			provider: 'acme',
			tokens: 150,
			costUsd: 0.75,
			requests: 2
		});
	});

	it('keeps the same model name apart across providers', () => {
		const shares = modelShares([
			usage('2026-11-17', { input_tokens: 10 }),
			usage('2026-11-17', { provider: 'beta', input_tokens: 20 })
		]);
		expect(shares.map((s) => s.key)).toEqual(['beta/alpha', 'acme/alpha']);
	});

	it('keeps every model when there are at most MAX_SERIES', () => {
		const shares = modelShares(models(MAX_SERIES, '2026-11-17'));
		expect(shares).toHaveLength(MAX_SERIES);
		expect(shares.map((s) => s.key)).not.toContain(OTHER);
	});

	it('collapses the models past MAX_SERIES into one OTHER entry', () => {
		const shares = modelShares(models(7, '2026-11-17'));
		expect(shares).toHaveLength(MAX_SERIES);
		expect(shares.slice(0, MAX_SERIES - 1).map((s) => s.model)).toEqual(['m0', 'm1', 'm2', 'm3']);
		// The last three models (300, 200 and 100 tokens) are summed.
		expect(shares[MAX_SERIES - 1]).toMatchObject({ key: OTHER, tokens: 600, costUsd: 1.5, requests: 18 });
	});
});

describe('dailySeries', () => {
	it('has one point per day of the range, the last one today, empty days included', () => {
		const points = dailySeries([], [], 3, TODAY);
		expect(points.map((p) => p.date)).toEqual(['2026-11-15', '2026-11-16', '2026-11-17']);
	});

	it('adds each row to its day and model, and zero-fills the rest', () => {
		const rows = [
			usage('2026-11-16', { input_tokens: 100 }),
			usage('2026-11-17', { input_tokens: 10 }),
			usage('2026-11-17', { model: 'beta', input_tokens: 40 })
		];
		const points = dailySeries(rows, modelShares(rows), 3, TODAY);
		expect(points).toEqual([
			{ date: '2026-11-15', 'acme/alpha': 0, 'acme/beta': 0 },
			{ date: '2026-11-16', 'acme/alpha': 100, 'acme/beta': 0 },
			{ date: '2026-11-17', 'acme/alpha': 10, 'acme/beta': 40 }
		]);
	});

	it('leaves out the rows outside the range', () => {
		const rows = [usage('2026-11-01', { input_tokens: 999 }), spent('2026-11-17')];
		const points = dailySeries(rows, modelShares(rows), 3, TODAY);
		const total = points.reduce((sum, p) => sum + (p['acme/alpha'] as number), 0);
		expect(total).toBe(1);
	});

	it('counts the models past MAX_SERIES under OTHER', () => {
		const rows = models(7, '2026-11-17');
		const points = dailySeries(rows, modelShares(rows), 1, TODAY);
		expect(points).toHaveLength(1);
		expect(points[0][OTHER]).toBe(600);
	});
});

describe('providerChoices', () => {
	it('lists the configured providers first, then those of the ledger, without repeats', () => {
		const rows = [
			usage('2026-11-17', { provider: 'beta' }),
			usage('2026-11-17', { provider: 'gamma' }),
			usage('2026-11-16', { provider: 'beta' })
		];
		expect(providerChoices(rows, ['acme', 'beta'])).toEqual(['acme', 'beta', 'gamma']);
	});

	it('leaves out empty ids', () => {
		expect(providerChoices([usage('2026-11-17', { provider: '' })], ['', 'acme'])).toEqual(['acme']);
	});
});
