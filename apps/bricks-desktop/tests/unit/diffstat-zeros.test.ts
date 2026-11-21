// The change counts (layout/DiffStat.tsx, and the counts of a proposed diff in
// markdown/DiffBlock.tsx): a zero is not written beside a real count. « +12 », « −3 », « +2 −1 »,
// and « +0 » only when there is neither addition nor removal. Rendered on the server, like the
// other count tests; the spoken form (sr-only) is checked too.
import { describe, expect, it } from 'vitest';
import { renderHtml } from './react-test-utils';
import DiffStat from '../../src/lib/layout/DiffStat';
import DiffBlock from '../../src/lib/features/conversation/markdown/DiffBlock';

/** The text a sighted reader sees: comments, the spoken form (sr-only) and tags left out. */
function visible(html: string): string {
	return html
		.replace(/<!--[^]*?-->/g, '')
		.replace(/<span class="sr-only">[^]*?<\/span>/g, '')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();
}

/** The spoken form of the counts: what a screen reader announces. */
function spoken(html: string): string {
	return [...html.matchAll(/<span class="sr-only">([^]*?)<\/span>/g)].map((m) => m[1].trim()).join(' ');
}

describe('DiffStat: no zero beside a real count', () => {
	it.each([
		[12, 0, '+12'],
		[0, 3, '−3'],
		[2, 1, '+2 −1'],
		[0, 0, '+0'],
		// Negative and fractional counts are clamped to whole numbers, here 0 and 2.
		[-4, 2.7, '−2'],
	])('additions %s, deletions %s read « %s »', (additions, deletions, expected) => {
		const html = renderHtml(DiffStat, { additions, deletions });
		expect(visible(html)).toBe(expected);
	});

	it('speaks the counts in full, with the singular for one and no « 0 ajouts »', () => {
		expect(spoken(renderHtml(DiffStat, { additions: 12, deletions: 0 }))).toBe('12 ajouts, 0 suppression');
		expect(spoken(renderHtml(DiffStat, { additions: 0, deletions: 3 }))).toBe('0 ajout, 3 suppressions');
		expect(spoken(renderHtml(DiffStat, { additions: 1, deletions: 1 }))).toBe('1 ajout, 1 suppression');
	});

	it('shows the unit after the figures when one is given', () => {
		const html = renderHtml(DiffStat, { additions: 12, deletions: 0, label: 'lignes' });
		expect(visible(html)).toBe('+12 lignes');
	});
});

describe('DiffBlock: the counts of a proposed diff', () => {
	const patch = [
		'```diff',
		'diff --git a/src/a.ts b/src/a.ts',
		'--- a/src/a.ts',
		'+++ b/src/a.ts',
		'@@ -1,1 +1,3 @@',
		' const a = 1;',
		'+const b = 2;',
		'+const c = 3;',
		'diff --git a/src/old.ts b/src/old.ts',
		'--- a/src/old.ts',
		'+++ b/src/old.ts',
		'@@ -1,3 +1,1 @@',
		'-const x = 1;',
		'-const y = 2;',
		' const z = 3;',
		'```',
	].join('\n');

	it('a file that only adds shows its additions, and no removal count', () => {
		const html = renderHtml(DiffBlock, { source: patch.replace(/```diff\n|```$/g, ''), complete: true });
		const row = html.indexOf('src/a.ts');
		expect(row).toBeGreaterThan(-1);
		const adds = html.slice(row, row + 1200);
		expect(visible(adds)).toMatch(/\+2\b/);
		expect(adds).not.toMatch(/−0/);
	});

	it('a file that only removes shows its removals, and no addition count', () => {
		const html = renderHtml(DiffBlock, { source: patch.replace(/```diff\n|```$/g, ''), complete: true });
		const row = html.indexOf('src/old.ts');
		expect(row).toBeGreaterThan(-1);
		const removes = html.slice(row, row + 1200);
		expect(visible(removes)).toMatch(/−2\b/);
		expect(removes).not.toMatch(/\+0\b/);
	});
});
