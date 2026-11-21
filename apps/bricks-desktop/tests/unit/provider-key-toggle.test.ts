// @vitest-environment happy-dom
// The API key field of the provider form: masked by default (muted, spaced), and the lock toggle
// shows it in clear and back. Mounted in happy-dom.
import { afterEach, describe, expect, it } from 'vitest';
import { flushReact, mountReact, tickReact, type MountedComponent } from './react-test-utils';
import ProviderFormDialog, { type ProviderFormDialogProps } from '../../src/lib/features/settings/ProviderFormDialog';
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

let app: MountedComponent<ProviderFormDialogProps> | null = null;
let target: HTMLDivElement | null = null;
afterEach(() => {
	app?.unmount();
	app = null;
	target?.remove();
	target = null;
	document.body.innerHTML = '';
});

describe('provider key toggle', () => {
	it('masks the key, then shows it in clear', async () => {
		target = document.createElement('div');
		document.body.appendChild(target);
		app = mountReact(ProviderFormDialog, {
			target,
			props: { provider: PROVIDER, onSave: async () => ({ ok: true }) as never, onClose: () => {} }
		});
		await tickReact();
		const input = document.querySelector<HTMLInputElement>('input[id$="-key"]')!;
		const toggle = document.querySelector<HTMLButtonElement>('[data-slot="toggle"]')!;
		expect(input.type).toBe('password');
		expect(input.value).toBe('sk-test-1234');
		expect(input.className).toContain('text-muted-foreground');
		expect(toggle.getAttribute('aria-label')).toBe('Afficher la clé');
		expect(toggle.querySelector('.lucide-lock-keyhole')).not.toBeNull();

		flushReact(() => {
			toggle.click();
		});
		expect(input.type).toBe('text');
		expect(input.className).toContain('text-foreground');
		expect(input.className).not.toContain('tracking-');
		expect(toggle.getAttribute('data-state')).toBe('on');
		expect(toggle.querySelector('.lucide-lock-keyhole-open')).not.toBeNull();

		flushReact(() => {
			toggle.click();
		});
		expect(input.type).toBe('password');
	});
});
