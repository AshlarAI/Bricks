// @vitest-environment happy-dom
// The API key field of the provider form: masked by default (muted, spaced), and the lock toggle
// shows it in clear and back. Mounted in happy-dom.
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ProviderFormDialog from '../../src/lib/features/settings/ProviderFormDialog.svelte';
import type { ProviderView } from '../../src/lib/ipc/bindings/ProviderView';

const PROVIDER: ProviderView = {
	id: 'acme',
	name: 'Acme',
	endpoint: 'https://api.acme.test/v1',
	protocol: 'chat_completions',
	auth: 'bearer',
	auth_header: null,
	api_key: 'sk-test-1234',
	has_credentials: true,
	path: null,
	header_names: [],
	logo: null,
	models: []
};

let app: ReturnType<typeof mount> | null = null;
afterEach(() => {
	if (app) unmount(app);
	app = null;
	document.body.innerHTML = '';
});

describe('provider key toggle', () => {
	it('masks the key, then shows it in clear', async () => {
		app = mount(ProviderFormDialog, {
			target: document.body,
			props: { provider: PROVIDER, onSave: async () => ({ ok: true }) as never, onClose: () => {} }
		});
		flushSync();
		await tick();
		const input = document.querySelector<HTMLInputElement>('input[id$="-key"]')!;
		const toggle = document.querySelector<HTMLButtonElement>('[data-slot="toggle"]')!;
		expect(input.type).toBe('password');
		expect(input.value).toBe('sk-test-1234');
		expect(input.className).toContain('text-muted-foreground');
		expect(toggle.getAttribute('aria-label')).toBe('Afficher la clé');
		expect(toggle.querySelector('.lucide-lock-keyhole')).not.toBeNull();

		toggle.click();
		flushSync();
		expect(input.type).toBe('text');
		expect(input.className).toContain('text-foreground');
		expect(input.className).not.toContain('tracking-');
		expect(toggle.getAttribute('data-state')).toBe('on');
		expect(toggle.querySelector('.lucide-lock-keyhole-open')).not.toBeNull();

		toggle.click();
		flushSync();
		expect(input.type).toBe('password');
	});
});
