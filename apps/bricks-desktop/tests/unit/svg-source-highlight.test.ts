// @vitest-environment happy-dom
// The source of an ```svg fence while it streams: a CodeBlock with numbered lines, highlighted by
// shiki (xml) once the highlighter loads, with a copy button.
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mountReact, type MountedComponent } from './react-test-utils';
import SvgBlock, { type SvgBlockProps } from '../../src/lib/features/conversation/markdown/SvgBlock';

let app: MountedComponent<SvgBlockProps> | null = null;
let target: HTMLDivElement | null = null;
afterEach(() => {
	app?.unmount();
	app = null;
	target?.remove();
	target = null;
	document.body.innerHTML = '';
});

describe('SvgBlock source', () => {
	it('shows numbered, highlighted lines and a copy button while streaming', async () => {
		const source = '<svg viewBox="0 0 10 10">\n  <rect width="4" height="4"/>\n';
		target = document.createElement('div');
		document.body.appendChild(target);
		app = mountReact(SvgBlock, { target, props: { source, complete: false } });
		expect(document.querySelector('[data-slot="code-block"]')).not.toBeNull();
		expect(document.querySelectorAll('[data-slot="code-block-line"]')).toHaveLength(2);
		expect(document.querySelector('[data-slot="code-block-content"]')?.hasAttribute('data-numbered')).toBe(true);
		expect(document.querySelector('[data-slot="code-block-copy-button"]')?.getAttribute('aria-label')).toBe('Copier');

		for (let i = 0; i < 100 && !document.querySelector('[style*="--shiki-light"]'); i++) {
			await act(async () => {
				await new Promise((r) => setTimeout(r, 50));
			});
		}
		const tokens = document.querySelectorAll('[data-slot="code-block-line"] span[style*="--shiki-light"]');
		expect(tokens.length).toBeGreaterThan(3);
		expect(document.querySelector('[data-slot="code-block-line"]')?.textContent).toContain('<svg viewBox="0 0 10 10">');
	});
});
