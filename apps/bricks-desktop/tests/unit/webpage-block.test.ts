// @vitest-environment happy-dom
// A top-level ```html fence (markdown/WebPageBlock.tsx): a `webpage` block of the document, shown
// as its source while it streams and as a sandboxed page once closed, with a console bridge that
// keeps the page in standards mode. Mounted in happy-dom; the frame loads nothing here.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement as h } from 'react';
import { flushReact, mountReact, type MountedComponent } from './react-test-utils';
import { TooltipProvider } from '../../src/lib/components/ui/tooltip';
import { renderReference } from '../../src/lib/features/conversation/markdown/document';
import WebPageBlock, { withBridge, type WebPageBlockProps } from '../../src/lib/features/conversation/markdown/WebPageBlock';

vi.mock('@tauri-apps/api/core', () => {
	class Channel {
		onmessage: ((event: unknown) => void) | null = null;
	}
	return { Channel, invoke: vi.fn() };
});

let app: MountedComponent<WebPageBlockProps> | null = null;

/** The app mounts one tooltip provider at its root. */
function Provided(props: WebPageBlockProps) {
	return h(TooltipProvider, null, h(WebPageBlock, props));
}
let target: HTMLDivElement | null = null;

function show(props: WebPageBlockProps): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	app = mountReact(Provided, { target, props });
	return target;
}

afterEach(() => {
	app?.unmount();
	app = null;
	target?.remove();
	target = null;
});

const PAGE = '<!doctype html><html><head><title>Acme</title></head><body><h1>Hi</h1></body></html>';

describe('an html fence', () => {
	it('is a webpage block, open while it streams', () => {
		expect(renderReference('```html\n<p>x</p>\n```\n', { idPrefix: 'w' })).toEqual([
			{ key: 'b0', kind: 'webpage', source: '<p>x</p>', complete: true },
		]);
		expect(renderReference('```htm\n<p>x', { idPrefix: 'w' }).at(-1)).toMatchObject({ kind: 'webpage', complete: false });
	});
});

describe('withBridge', () => {
	it('goes first in the head, after the doctype, or first of all', () => {
		const bridged = withBridge(PAGE);
		expect(bridged.startsWith('<!doctype html><html><head><script>')).toBe(true);
		expect(withBridge('<!DOCTYPE html><p>x</p>').startsWith('<!DOCTYPE html><script>')).toBe(true);
		expect(withBridge('<p>x</p>').startsWith('<script>')).toBe(true);
		expect(bridged).toContain('<h1>Hi</h1>');
	});
});

describe('WebPageBlock', () => {
	it('shows the source while the fence streams', () => {
		const root = show({ source: '<p>x', complete: false });
		expect(root.querySelector('iframe')).toBeNull();
		expect(root.querySelector('[data-slot="code-block-line"]')).not.toBeNull();
	});

	it('shows the page once closed, sandboxed without the app origin, titled from the page', () => {
		const root = show({ source: PAGE, complete: true });
		const frame = root.querySelector('iframe')!;
		expect(frame.getAttribute('sandbox')).not.toContain('allow-same-origin');
		expect(frame.getAttribute('srcdoc')).toContain('<h1>Hi</h1>');
		expect(root.querySelector('[data-slot="artifact-title"]')?.textContent).toBe('Acme');

		flushReact(() => root.querySelector<HTMLButtonElement>('button[aria-label="Source"]')!.click());
		expect(root.querySelector('iframe')).toBeNull();
		flushReact(() => root.querySelector<HTMLButtonElement>('button[aria-label="Aperçu"]')!.click());
		expect(root.querySelector('iframe')).not.toBeNull();
	});
});
