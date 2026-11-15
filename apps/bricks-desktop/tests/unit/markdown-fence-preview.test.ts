// @vitest-environment happy-dom
// A ```markdown fence: its source by default (numbered lines, copy), and its rendering once the
// « Aperçu » switch is on (happy-dom's sanitizer pass drops heading and list tags, so the text is checked). Copy keeps the source.
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MarkdownView from '../../src/lib/features/conversation/markdown/MarkdownView.svelte';

const SOURCE = 'Voici le README :\n\n```markdown\n## Installation\n\n- **npm** install\n```\n';
let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('markdown fence', () => {
	it('shows the source, then the rendering with Aperçu on', () => {
		app = mount(MarkdownView, { target: document.body, props: { source: SOURCE, idPrefix: 'm1' } });
		flushSync();
		const block = document.querySelector('[data-slot="code-block"]')!;
		expect(block.querySelector('[data-slot="code-block-title"]')?.textContent?.trim()).toBe('Markdown');
		expect(block.querySelectorAll('[data-slot="code-block-line"]')).toHaveLength(3);
		expect(block.textContent).toContain('## Installation');
		const toggle = block.querySelector<HTMLButtonElement>('[data-slot="switch"]')!;
		const actions = [...block.querySelectorAll('[data-slot="switch"], [data-slot="code-block-copy-button"]')];
		expect(actions.map((a) => a.getAttribute('data-slot'))).toEqual(['switch', 'code-block-copy-button']);
		expect(block.querySelector('label')?.textContent?.trim()).toBe('Aperçu');

		toggle.click();
		flushSync();
		expect(block.textContent).toContain('Installation');
		expect(block.textContent).not.toContain('## Installation');
		expect(block.querySelector('strong')?.textContent).toBe('npm');
		expect(block.querySelector('[data-slot="code-block-line"]')).toBeNull();

		toggle.click();
		flushSync();
		expect(block.querySelector('strong')).toBeNull();
		expect(block.textContent).toContain('## Installation');
	});
});
