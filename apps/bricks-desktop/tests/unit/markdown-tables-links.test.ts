// @vitest-environment happy-dom
// Tables keep their native layout inside a scrolling wrapper and their Markdown
// alignment; a link keeps the bold or code of its text. Sanitizing is mocked, as in the
// other Markdown tests.
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MarkdownDocument } from '../../src/lib/features/conversation/markdown/document';

vi.mock('../../src/lib/features/conversation/markdown/sanitize', () => ({
	sanitizeMarkdown: (html: string) => html,
	sanitizeSvg: (svg: string) => svg
}));

function html(source: string): string {
	const blocks = new MarkdownDocument({ idPrefix: 't' }).update(source, true);
	return blocks.map((b) => (b.kind === 'html' ? b.html : '')).join('');
}

describe('tables', () => {
	const table = html('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |');

	it('sit in a scrolling wrapper, and stay tables', () => {
		expect(table).toMatch(/<div class="md-table"><table>/);
		expect(table).toMatch(/<\/table>\s*<\/div>/);
	});

	it('keep the alignment of each column', () => {
		expect(table).toContain('<th align="left">a</th>');
		expect(table).toContain('<th align="center">b</th>');
		expect(table).toContain('<td align="center">2</td>');
		expect(table).toContain('<td align="right">3</td>');
	});
});

describe('links', () => {
	it('keep bold and code in their text', () => {
		const link = html('[**bold** and `code`](https://example.com)');
		expect(link).toContain('<strong>bold</strong> and <code>code</code></a>');
	});

	it('stay escaped', () => {
		expect(html('[<b>x</b>](https://example.com)')).not.toContain('<b>');
	});

	it('keep bold in a link to a file', () => {
		expect(html('[**main**](src/main.rs)')).toMatch(/<button[^>]*class="file-ref"[^>]*><img class="file-icon" src="\/file-icons\/svg\/rust\.svg"[^>]*><span class="file-ref-label"><strong>main<\/strong><\/span><\/button>/);
	});
});

describe('the styles of an answer', () => {
	const view = readFileSync('src/lib/features/conversation/markdown/MarkdownView.tsx', 'utf8');
	const css = readFileSync('src/lib/features/conversation/markdown/markdown-view.css', 'utf8');

	it('imports the markdown-view stylesheet', () => {
		expect(view).toContain("import './markdown-view.css'");
	});

	it('no longer override the alignment or turn tables into blocks', () => {
		expect(css).not.toContain('text-align: left');
		expect(css).not.toMatch(/\.md table\s*\{\s*display:\s*block/);
	});

	it('keep words whole in table cells', () => {
		expect(css).toMatch(/\.md th,\s*\.md td\s*\{[^}]*overflow-wrap:\s*normal/);
	});
});
