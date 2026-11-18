// @vitest-environment happy-dom
// Citations of the links in a reply (citations.ts) and the links they decorate (render.ts, through
// renderReference): the web searches of the conversation give a link its title and summary, the
// site of an address is its name, and only a web page gets a card. The sanitizer is the real one:
// the citation attribute must survive it, or the card would never show.
import { describe, expect, it } from 'vitest';
import { buttonVariants } from '../../src/lib/components/ui/button';
import { citationHost, citationKey, isCitable, webSearchSources } from '../../src/lib/features/conversation/markdown/citations';
import { renderReference } from '../../src/lib/features/conversation/markdown/document';
import type { RenderedBlock } from '../../src/lib/features/conversation/markdown/types';

/** The lines of a tool output, joined as the tool writes them. */
const output = (...lines: string[]) => lines.join('\n');

// A search as the WebSearch tool writes it: results with their summaries (indented by five spaces),
// a page that was read, and a page that could not be read.
const FIRST = output(
	'Search: client API retry policy',
	'Provider: answered by duckduckgo — duckduckgo: 5 result(s) (412 ms)',
	'',
	'Results:',
	'[S1] Client API — Retry policy — https://docs.example.com/api/retry',
	'     Requests are retried up to three times, with an exponential backoff from 200 ms.',
	'[S2] Rate limits — https://docs.example.com/api/limits/',
	'     The API answers 429 when a key sends too many requests in one minute.',
	'[S3] Changelog — https://example.org/changelog#2026-01',
	'[S4] Forum thread — https://forum.example.net/t/retries',
	'     Someone asks how to turn retries off.',
	'     The answer: set max_retries to 0 in the client options.',
	'[S5] News — https://news.example.com/retry',
	'',
	'Pages read:',
	'[S1 · D1] https://docs.example.com/api/retry — html, 4,210 characters (complete)',
	'     note: served from this session\'s store',
	'[S5] https://news.example.com/retry — not read: download failed: timed out',
);

// A later search of the same conversation: its first two results repeat pages of the first one
// (a trailing slash, a fragment), with other summaries, and it adds one page.
const SECOND = output(
	'Search: retry options',
	'Provider: answered by brave — brave: 2 result(s) (300 ms)',
	'',
	'Results:',
	'[S1] Retry policy, updated — https://docs.example.com/api/retry#backoff',
	'     An updated summary that must not replace the first one.',
	'[S2] Quotas — https://docs.example.com/api/limits',
	'[S3] Changelog — https://example.org/changelog/',
	'[S4] Pricing — https://www.example.io/pricing',
	'     Plans start at a low monthly price.',
);

const NO_RESULTS = output('Search: an empty query', 'Provider: answered by duckduckgo — duckduckgo: 0 result(s) (80 ms)', '', 'No results for this query.');
const FAILED = output('Search: a failing query', 'Provider: no provider answered — brave: timeout (9000 ms)', '', 'The search failed: timeout.');

describe('webSearchSources: the pages of the searches, by address', () => {
	const sources = webSearchSources([FIRST, SECOND]);

	it('keeps one source per address, in the order the searches listed them', () => {
		expect([...sources.keys()]).toEqual([
			'https://docs.example.com/api/retry',
			'https://docs.example.com/api/limits',
			'https://example.org/changelog',
			'https://forum.example.net/t/retries',
			'https://news.example.com/retry',
			'https://www.example.io/pricing',
		]);
	});

	it('gives a result its title, its url and its summary', () => {
		expect(sources.get('https://docs.example.com/api/retry')).toEqual({
			title: 'Client API — Retry policy',
			url: 'https://docs.example.com/api/retry',
			snippet: 'Requests are retried up to three times, with an exponential backoff from 200 ms.',
		});
	});

	it('joins a summary that runs over several indented lines', () => {
		expect(sources.get('https://forum.example.net/t/retries')?.snippet).toBe(
			'Someone asks how to turn retries off. The answer: set max_retries to 0 in the client options.',
		);
	});

	it('gives a result with no summary an empty one', () => {
		expect(sources.get('https://example.org/changelog')).toEqual({
			title: 'Changelog',
			url: 'https://example.org/changelog#2026-01',
			snippet: '',
		});
		expect(sources.get('https://news.example.com/retry')).toEqual({
			title: 'News',
			url: 'https://news.example.com/retry',
			snippet: '',
		});
	});

	it('keeps the first result of an address across two searches: its title and its summary', () => {
		expect(sources.get('https://docs.example.com/api/retry')?.title).toBe('Client API — Retry policy');
		expect(sources.get('https://docs.example.com/api/retry')?.snippet).not.toContain('updated summary');
		expect(sources.get('https://example.org/changelog')?.url).toBe('https://example.org/changelog#2026-01');
	});

	it('adds the pages of a later search that the first one did not list', () => {
		expect(sources.get('https://www.example.io/pricing')).toEqual({
			title: 'Pricing',
			url: 'https://www.example.io/pricing',
			snippet: 'Plans start at a low monthly price.',
		});
	});

	it('does not read the notes of the pages read, or a page that could not be read, as results', () => {
		expect(sources.get('https://news.example.com/retry')?.snippet).toBe('');
		expect(sources.get('https://docs.example.com/api/retry')?.snippet).not.toContain('served from');
		expect([...sources.values()].some((s) => s.snippet.includes('note:'))).toBe(false);
	});

	it('finds a link to a page by its address, without its fragment or its trailing slash', () => {
		expect(sources.get(citationKey('https://docs.example.com/api/limits#quotas'))?.title).toBe('Rate limits');
		expect(sources.get(citationKey('https://docs.example.com/api/limits/'))?.title).toBe('Rate limits');
		expect(sources.get(citationKey('https://example.org/changelog'))?.title).toBe('Changelog');
		expect(sources.get(citationKey('https://docs.example.com/api/retry#backoff'))?.title).toBe('Client API — Retry policy');
	});

	it('does not match a page with another query string', () => {
		expect(sources.get(citationKey('https://docs.example.com/api/retry?lang=fr'))).toBeUndefined();
	});

	it('gives nothing for a search with no result or a failed one, and for no output at all', () => {
		expect(webSearchSources([NO_RESULTS, FAILED]).size).toBe(0);
		expect(webSearchSources([]).size).toBe(0);
	});
});

describe('citationKey: the address a link and a result share', () => {
	it('drops the fragment and the trailing slash', () => {
		expect(citationKey('https://docs.example.com/api/limits/#quotas')).toBe('https://docs.example.com/api/limits');
		expect(citationKey('https://example.org/changelog#2026-01')).toBe('https://example.org/changelog');
	});

	it('keeps the query string, and the www. of the host', () => {
		expect(citationKey('https://www.example.io/pricing?plan=pro')).toBe('https://www.example.io/pricing?plan=pro');
	});

	it('gives a site the same key with or without its final slash', () => {
		expect(citationKey('https://example.com')).toBe(citationKey('https://example.com/'));
		expect(citationKey('https://example.com/')).toBe('https://example.com');
	});

	it('returns text that is not an address unchanged', () => {
		expect(citationKey('not an address')).toBe('not an address');
	});
});

describe('citationHost: the name of a site', () => {
	it('drops www. and keeps the other subdomains', () => {
		expect(citationHost('https://www.example.com/a')).toBe('example.com');
		expect(citationHost('https://docs.example.com/api')).toBe('docs.example.com');
	});

	it('is the host in lower case', () => {
		expect(citationHost('https://WWW.Example.COM/')).toBe('example.com');
	});

	it('returns text that is not an address unchanged', () => {
		expect(citationHost('not an address')).toBe('not an address');
		expect(citationHost('')).toBe('');
	});
});

describe('isCitable: only a web page gets a card', () => {
	it('accepts https and http addresses', () => {
		expect(isCitable('https://react.dev/x')).toBe(true);
		expect(isCitable('http://example.org/page')).toBe(true);
	});

	it('refuses mail, files, scripts and text that is not an address', () => {
		expect(isCitable('mailto:support@example.org')).toBe(false);
		expect(isCitable('file:///etc/hosts')).toBe(false);
		expect(isCitable('javascript:alert(1)')).toBe(false);
		expect(isCitable('garbage')).toBe(false);
		expect(isCitable('')).toBe(false);
	});
});

// ─── The links of a reply, as rendered (real sanitizer) ─────────────────────

function htmlOf(blocks: RenderedBlock[]): string {
	return blocks.map((block) => (block.kind === 'html' ? block.html : '')).join('');
}

/** The markup of a reply, as a DOM the test can read. */
function replyDom(source: string): HTMLElement {
	const root = document.createElement('div');
	root.innerHTML = htmlOf(renderReference(source, { idPrefix: 'c' }));
	return root;
}

const visibleText = (root: HTMLElement) => root.textContent?.replace(/\s+/g, ' ').trim() ?? '';

describe('links in a reply: a web page is a citation', () => {
	it('keeps the text of the link, marks it as a citation, and shows no address after it', () => {
		const root = replyDom('[React](https://react.dev/x)');
		const anchors = root.querySelectorAll('a');
		expect(anchors).toHaveLength(1);
		expect(anchors[0].getAttribute('href')).toBe('https://react.dev/x');
		expect(anchors[0].hasAttribute('data-citation')).toBe(true);
		expect(anchors[0].textContent).toBe('React');
		expect(visibleText(root)).toBe('React');
	});

	it('names a bare address after its site, with the official secondary extra-small button classes', () => {
		const root = replyDom('https://www.example.com/a');
		const anchor = root.querySelector('a');
		expect(anchor?.getAttribute('href')).toBe('https://www.example.com/a');
		expect(anchor?.hasAttribute('data-citation')).toBe(true);
		expect(anchor?.textContent).toBe('example.com');
		expect(visibleText(root)).toBe('example.com');
		expect(anchor?.getAttribute('class')).toBe(
			`${buttonVariants({ variant: 'secondary', size: 'xs' })} no-underline align-baseline`,
		);
	});

	it('keeps a mail link a plain link, with no citation', () => {
		const root = replyDom('[écrire](mailto:support@example.org)');
		const anchor = root.querySelector('a');
		expect(anchor?.getAttribute('href')).toBe('mailto:support@example.org');
		expect(anchor?.textContent).toBe('écrire');
		expect(anchor?.hasAttribute('data-citation')).toBe(false);
		expect(anchor?.getAttribute('title')).toBe('mailto:support@example.org');
	});
});
