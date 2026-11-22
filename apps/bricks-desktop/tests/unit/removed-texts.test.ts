// Static checks of the.3 interface (validation, Haiku V): the texts that spec §6 removes
// are gone from the views that render them, the wording and structure the spec keeps are there,
// and no raw HTML is rendered outside the sanitised Markdown path. These read the source files;
// they do not render components. A `it.fails` documents a known open defect: it passes while the
// defect is present and must be turned into `it` once the product is fixed.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bound, call } from './french-keys';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const forbidden = (text: string, phrases: readonly string[]) => phrases.filter((p) => text.includes(p));

/** Texts of spec §6 for « Modifications → Historique ». */
const HISTORY_LEFTOVERS = [
	'Aucune modification enregistrée pour ce projet.',
	'Enregistrées',
	'Non attribuées',
	'Chiffres :',
	'somme des opérations',
	'Aucune modification',
	'Les modifications faites par les agents'
];

describe('Modifications → Historique has no leftover text (spec §6)', () => {
	it('the history tab renders none of the removed sentences, nor the edit-sum label', () => {
		const text = src('lib/features/changes/HistoryChanges.tsx');
		expect(forbidden(text, HISTORY_LEFTOVERS)).toEqual([]);
		expect(text).not.toContain('EDIT_SUM_LABEL');
	});

	it('an empty journal renders nothing under the tab (no title, no description)', () => {
		const text = src('lib/features/changes/HistoryChanges.tsx');
		expect(text).toContain("shown.view === 'entries'");
		expect(text).not.toMatch(/<EmptyState[^>]*title="Aucune/);
	});

		// Same family as spec §6: the Conversation tab of the same panel must not keep the removed
	// empty-state title or the permanent edit-sum sentence (the countLabel prop is gone with them).
	it('the Conversation tab does not keep the removed empty title or the permanent edit-sum sentence', () => {
		const text = src('lib/features/changes/ConversationChanges.tsx');
		expect(forbidden(text, ['title="Aucune modification"', 'Chiffres :'])).toEqual([]);
	});
});

describe('the run-end card and the composer keep only what the spec keeps', () => {
	it('RunEndCard has no « Durée : » prefix, no turn count and no model identifier in its markup', () => {
		const text = src('lib/features/conversation/timeline/RunEndCard.tsx');
		expect(text).not.toContain('Durée');
		expect(text).not.toMatch(/\bturns\b/);
		expect(text).not.toMatch(/\brun\.model\b|\bmodel\}/);
	});

	it('the composer no longer says a draft is kept while a run goes on', () => {
		const composer = src('lib/features/composer/Composer.tsx');
		expect(forbidden(composer, ['Une génération est en cours', 'le brouillon sera conservé'])).toEqual([]);
	});

	it('the send button tooltip is « Envoyer » and the placeholder « Quelque chose à dire ? » stays', () => {
		const composer = src('lib/features/composer/Composer.tsx');
		expect(composer).toContain(`<TooltipContent side="top">{${call('Envoyer')}}</TooltipContent>`);
		expect(composer).toContain(call('Quelque chose à dire ?'));
	});
});

describe('model form: two limits, no context window field', () => {
	it('the form says « Nom API » and keeps the two token limits, and no longer edits the window', () => {
		const text = src('lib/features/settings/ModelFormDialog.tsx');
		expect(text).toContain(call('Nom API'));
		expect(text).toContain(call('Entrée maximale (tokens)'));
		expect(text).toContain(call('Sortie maximale (tokens)'));
		expect(forbidden(text, ['Modèle de l’API', "Modèle de l'API", 'Fenêtre de contexte', 'context_window'])).toEqual([]);
	});

	it('the model card shows the two limits and no context window', () => {
		const text = src('lib/features/settings/ModelRow.tsx');
		expect(text).toContain(call('Entrée maximale'));
		expect(text).toContain(call('Sortie maximale'));
		expect(forbidden(text, ['Fenêtre de contexte', 'context_window'])).toEqual([]);
	});
});

describe('appearance: bundled Google Sans fonts', () => {
	it('uses the Google families without old font declarations or network imports', () => {
		const css = ['app.css', 'styles/fonts.css', 'styles/tokens.generated.css']
			.map((path) => src(path)).join('\n');
		const main = src('main.tsx');
		expect(css).not.toMatch(/font-family:\s*['"]?Inter\b/);
		expect(css).not.toMatch(/--font-sans:[^;]*Inter/);
		expect(main).not.toContain('fontsource');
		expect(css).not.toMatch(/Geist/i);
		expect(css).toContain("--ui-font-family: 'Google Sans Flex'");
		expect(css).toContain("--code-font-family: 'Google Sans Code'");
	});
});

describe('header: controls, then the title, then the actions', () => {
	it('TopBar is one draggable row: fixed controls, a title that takes the rest, fixed actions', () => {
		const text = src('lib/layout/TopBar.tsx');
		const left = text.indexOf('<div data-tauri-drag-region className="flex shrink-0 items-center gap-0.5">');
		const centre = text.indexOf('<div data-tauri-drag-region className="ml-3 flex min-w-0 flex-1 items-center">');
		const right = text.indexOf(`<div data-tauri-drag-region role="group" aria-label={t('layout.view')} className="flex shrink-0 items-center gap-1">`);
		expect(left).toBeGreaterThan(0);
		expect(centre).toBeGreaterThan(left);
		expect(right).toBeGreaterThan(centre);
	});

	it('the title sits in the middle group, the view toggles and the trailing menu in the last, one evenly spaced row', () => {
		const text = src('lib/layout/TopBar.tsx');
		const centre = text.indexOf('flex min-w-0 flex-1 items-center');
		expect(text.indexOf('{title}', centre)).toBeGreaterThan(centre);
		const right = text.indexOf(`<div data-tauri-drag-region role="group" aria-label={t('layout.view')} className="flex shrink-0 items-center gap-1">`);
		expect(right).toBeGreaterThan(centre);
		expect(text.indexOf('{onToggleRight && (', right)).toBeGreaterThan(right);
		expect(text.indexOf('{trailing}', right)).toBeGreaterThan(right);
	});
});

describe('text direction and links', () => {
	it('the composer textarea and the user bubble are automatic-direction and logical-aligned', () => {
		for (const path of ['lib/features/composer/Composer.tsx', 'lib/features/conversation/timeline/UserMessage.tsx']) {
			const text = src(path);
			expect(text, path).toContain('dir="auto"');
			expect(text, path).toContain('text-start');
		}
	});

	it('raw HTML is rendered only by the sanitised Markdown path, escaped code highlighting, and chart CSS', () => {
		const files: string[] = [];
		const walk = (dir: string) => {
			for (const entry of readdirSync(new URL(`../../src/${dir}`, import.meta.url), { withFileTypes: true })) {
				const rel = `${dir}/${entry.name}`;
				if (entry.isDirectory()) walk(rel);
				// Local « … 2 » copies of the user are not sources.
				else if (entry.name.endsWith('.tsx') && !/ \d+\.tsx$/.test(entry.name)) files.push(rel);
			}
		};
		walk('lib');
		const withHtml = files
			.filter((f) => readFileSync(new URL(`../../src/${f}`, import.meta.url), 'utf8').includes('dangerouslySetInnerHTML'))
			.sort();
		// Message blocks come from the Markdown document (sanitizeMarkdown/sanitizeKatex);
		// highlighted source lines escape every character with escapeHtml;
		// shadcn ChartStyle renders CSS variables inside <style>;
		// diagrams use a sanitized SVG inside an opaque, scriptless iframe.
		expect(withHtml).toEqual([
			'lib/components/ui/chart.tsx',
			'lib/features/conversation/markdown/MarkdownView.tsx',
			'lib/features/inspect/FileView.tsx',
			'lib/features/reader/ReaderPanel.tsx',
		]);
		expect(src('lib/features/conversation/markdown/MarkdownView.tsx')).toContain('MarkdownDocument');
		expect(src('lib/features/conversation/timeline/AssistantMessage.tsx')).toContain('MarkdownView');
		expect(src('lib/features/conversation/markdown/sanitize.ts')).toContain('DOMPurify.sanitize');
		expect(src('lib/features/conversation/markdown/svg-viewer.ts')).toContain('sanitizeSvg');
		expect(src('lib/features/conversation/markdown/SvgViewer.tsx')).toContain('sandbox=""');
		expect(src('lib/features/conversation/markdown/svg-viewer.ts')).toContain("script-src 'none'");
		expect(src('lib/code-highlight.ts')).toContain('escapeHtml(');
		expect(src('lib/features/inspect/FileView.tsx')).toContain('highlightedLines(');
		expect(src('lib/features/reader/ReaderPanel.tsx')).toContain('highlightLines(');
		expect(src('lib/components/ui/chart.tsx')).toMatch(/<style\s+dangerouslySetInnerHTML=/);
	});

	it('user messages never go through Markdown or HTML: they are built from text parts', () => {
		const text = src('lib/features/conversation/timeline/UserMessage.tsx');
		expect(text).not.toContain('renderMarkdown');
		expect(text).toContain('messageParts');
	});
});
