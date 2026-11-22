// @vitest-environment happy-dom
// The Artifact frame and the web preview (components/ui): the preview keeps a history of the
// addresses typed (about: ones here, so no page is fetched), its back, forward and reload buttons
// follow it, and generated HTML (srcDoc) runs in a sandbox without the app's origin. Mounted in
// happy-dom.
import { afterEach, describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { flushReact, mountReact, type MountedComponent } from './react-test-utils';
import { TooltipProvider } from '../../src/lib/components/ui/tooltip';
import {
	WebPreview,
	WebPreviewBody,
	WebPreviewConsole,
	WebPreviewNavigation,
	WebPreviewNavigationButton,
	WebPreviewUrl
} from '../../src/lib/components/ui/web-preview';
import { Artifact, ArtifactAction, ArtifactActions, ArtifactHeader, ArtifactTitle } from '../../src/lib/components/ui/artifact';

let app: MountedComponent<object> | null = null;
let target: HTMLDivElement | null = null;
let urls: string[] = [];

function Preview({ srcDoc }: { srcDoc?: string }) {
	return h(
		TooltipProvider,
		null,
		h(
			WebPreview,
			{ defaultUrl: 'about:blank?home', onUrlChange: (u: string) => urls.push(u) },
			h(
				WebPreviewNavigation,
				null,
				h(WebPreviewNavigationButton, { action: 'back', tooltip: 'Back' }, 'B'),
				h(WebPreviewNavigationButton, { action: 'forward', tooltip: 'Forward' }, 'F'),
				h(WebPreviewNavigationButton, { action: 'reload', tooltip: 'Reload' }, 'R'),
				h(WebPreviewUrl)
			),
			h(WebPreviewBody, srcDoc === undefined ? {} : { srcDoc }),
			h(WebPreviewConsole, { logs: [{ level: 'error', message: 'boom', timestamp: new Date(2026, 9, 22, 9, 41, 12) }] })
		)
	);
}

function show(component: () => ReturnType<typeof h>): HTMLElement {
	target = document.createElement('div');
	document.body.appendChild(target);
	app = mountReact(component as never, { target });
	return target;
}

const button = (root: HTMLElement, label: string) => root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;

function type(root: HTMLElement, value: string) {
	const input = root.querySelector<HTMLInputElement>('[data-slot="web-preview-url"]')!;
	flushReact(() => {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
		setter.call(input, value);
		input.dispatchEvent(new Event('input', { bubbles: true }));
	});
	flushReact(() => {
		input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
	});
}

afterEach(() => {
	app?.unmount();
	app = null;
	target?.remove();
	target = null;
	urls = [];
});

describe('WebPreview', () => {
	it('opens a typed address, and back and forward walk the history', () => {
		const root = show(() => h(Preview));
		const frame = () => root.querySelector('iframe')!;
		expect(frame().getAttribute('src')).toBe('about:blank?home');
		expect(button(root, 'Back').disabled).toBe(true);
		expect(button(root, 'Forward').disabled).toBe(true);

		type(root, 'about:blank?pricing');
		expect(frame().getAttribute('src')).toBe('about:blank?pricing');
		expect(button(root, 'Back').disabled).toBe(false);

		flushReact(() => button(root, 'Back').click());
		expect(frame().getAttribute('src')).toBe('about:blank?home');
		expect(button(root, 'Forward').disabled).toBe(false);

		flushReact(() => button(root, 'Forward').click());
		expect(frame().getAttribute('src')).toBe('about:blank?pricing');
		expect(urls).toEqual(['about:blank?pricing', 'about:blank?home', 'about:blank?pricing']);
	});

	it('reload mounts a new frame', () => {
		const root = show(() => h(Preview));
		const first = root.querySelector('iframe');
		flushReact(() => button(root, 'Reload').click());
		expect(root.querySelector('iframe')).not.toBe(first);
	});

	it('generated HTML runs without the app origin; an address keeps its own', () => {
		let root = show(() => h(Preview, { srcDoc: '<h1>Hi</h1>' }));
		const sandbox = root.querySelector('iframe')!.getAttribute('sandbox')!;
		expect(sandbox).toContain('allow-scripts');
		expect(sandbox).not.toContain('allow-same-origin');
		expect(root.querySelector('iframe')!.hasAttribute('src')).toBe(false);
		app?.unmount();
		target?.remove();
		root = show(() => h(Preview));
		expect(root.querySelector('iframe')!.getAttribute('sandbox')).toContain('allow-same-origin');
	});

	it('the console opens on its trigger and shows the logs', () => {
		const root = show(() => h(Preview));
		const trigger = root.querySelector<HTMLButtonElement>('[data-slot="web-preview-console"] button')!;
		expect(trigger.textContent).toContain('Console');
		flushReact(() => trigger.click());
		expect(root.querySelector('[data-level="error"]')?.textContent).toContain('boom');
	});
});

describe('Artifact', () => {
	it('names each action by its tooltip', () => {
		const root = show(() =>
			h(
				TooltipProvider,
				null,
				h(
					Artifact,
					null,
					h(ArtifactHeader, null, h(ArtifactTitle, null, 'Dijkstra'), h(ArtifactActions, null, h(ArtifactAction, { tooltip: 'Copy' }, 'c')))
				)
			)
		);
		expect(root.querySelector('[data-slot="artifact-title"]')?.textContent).toBe('Dijkstra');
		expect(button(root, 'Copy')).not.toBeNull();
	});
});
