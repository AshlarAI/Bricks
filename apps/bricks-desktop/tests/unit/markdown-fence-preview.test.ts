// @vitest-environment happy-dom
// A ```markdown fence: its source by default (numbered lines, copy), and its rendering once the
// « Aperçu » switch is on (happy-dom's sanitizer pass drops heading and list tags, so the text is checked). Copy keeps the source.
import { afterEach, describe, expect, it } from 'vitest';
import { flushReact, mountReact, type MountedComponent } from './react-test-utils';
import MarkdownView, { type MarkdownViewProps } from '../../src/lib/features/conversation/markdown/MarkdownView';

const SOURCE = 'Voici le README :\n\n```markdown\n## Installation\n\n- **npm** install\n```\n';
let app: MountedComponent<MarkdownViewProps> | null = null;
let target: HTMLDivElement | null = null;
afterEach(() => {
	app?.unmount();
	app = null;
	target?.remove();
	target = null;
	document.body.innerHTML = '';
});

describe('markdown fence', () => {
	it('shows the source, then the rendering with Aperçu on', () => {
		target = document.createElement('div');
		document.body.appendChild(target);
		app = mountReact(MarkdownView, { target, props: { source: SOURCE, idPrefix: 'm1' } });
		const block = document.querySelector('[data-slot="code-block"]')!;
		expect(block.querySelector('[data-slot="code-block-title"]')?.textContent?.trim()).toBe('Markdown');
		expect(block.querySelectorAll('[data-slot="code-block-line"]')).toHaveLength(3);
		expect(block.textContent).toContain('## Installation');
		const toggle = block.querySelector<HTMLButtonElement>('[data-slot="switch"]')!;
		const actions = [...block.querySelectorAll('[data-slot="switch"], [data-slot="code-block-copy-button"]')];
		expect(actions.map((a) => a.getAttribute('data-slot'))).toEqual(['switch', 'code-block-copy-button']);
		expect(block.querySelector('label')?.textContent?.trim()).toBe('Aperçu');

		flushReact(() => {
			toggle.click();
		});
		expect(block.textContent).toContain('Installation');
		expect(block.textContent).not.toContain('## Installation');
		expect(block.querySelector('strong')?.textContent).toBe('npm');
		expect(block.querySelector('[data-slot="code-block-line"]')).toBeNull();

		flushReact(() => {
			toggle.click();
		});
		expect(block.querySelector('strong')).toBeNull();
		expect(block.textContent).toContain('## Installation');
	});
});
