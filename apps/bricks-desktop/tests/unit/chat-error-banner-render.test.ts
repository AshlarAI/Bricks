// @vitest-environment happy-dom
// The error banner above the composer (ChatErrorBanner.tsx), mounted in happy-dom: which
// buttons each kind of error shows, the callbacks, the hook icon, the details dialog, and « Copier »
// (the clipboard text, its success and its failure toasts). sonner is replaced so the
// toasts can be read.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushReact, mountReact, tickReact, type MountedComponent } from './react-test-utils';
import ChatErrorBanner from '../../src/lib/features/conversation/ChatErrorBanner';
import { chatErrorCopyText, resolveChatError, type ChatErrorView } from '../../src/lib/features/conversation/chat-error';
import { toast } from 'sonner';

vi.mock('sonner', () => ({ toast: vi.fn() }));

const PLAIN: ChatErrorView = {
	message: 'Le fournisseur a renvoyé une erreur 400.',
	detail: 'Provider error 400: bad request',
	modelConfigMissing: false,
	hookBlocked: false,
};
const NO_KEY: ChatErrorView = resolveChatError('Authentication error: provider "ifm": no API key');
const HOOK: ChatErrorView = resolveChatError('Blocked by hook: no rm -rf');
const UNKNOWN_ONE_LINE: ChatErrorView = { message: 'Erreur brute', detail: null, modelConfigMissing: false, hookBlocked: false };

let app: MountedComponent<object> | null = null;
let target: HTMLDivElement | null = null;
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function render(props: Record<string, unknown>) {
	target = document.createElement('div');
	document.body.append(target);
	app = mountReact(ChatErrorBanner, { target, props: props as never }) as MountedComponent<object>;
	return target;
}

/** The buttons of the banner by their visible text (or aria-label), in document order. */
function buttonLabels(): string[] {
	return Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="chat-error-banner"] button')).map(
		(b) => b.getAttribute('aria-label') ?? b.textContent?.trim() ?? '',
	);
}
function button(label: string): HTMLButtonElement | null {
	return (
		Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="chat-error-banner"] button')).find(
			(b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === label,
		) ?? null
	);
}
function banner(): HTMLElement {
	return document.querySelector<HTMLElement>('[data-slot="chat-error-banner"]')!;
}

beforeEach(() => {
	vi.mocked(toast).mockClear();
});

afterEach(() => {
	app?.unmount();
	app = null;
	target?.remove();
	target = null;
	document.body.innerHTML = '';
	if (originalClipboard) Object.defineProperty(navigator, 'clipboard', originalClipboard);
	else delete (navigator as { clipboard?: unknown }).clipboard;
	vi.restoreAllMocks();
});

describe('which buttons each error shows', () => {
	it('a missing API key shows only « Configurer » (no copy, details or retry)', () => {
		render({ error: NO_KEY, onRetry: () => {}, onDismiss: () => {}, onOpenModelSettings: () => {} });
		expect(buttonLabels()).toEqual(['Configurer', 'Masquer l’erreur']);
		expect(document.querySelector('[data-slot="chat-error-details-button"]')).toBeNull();
	});

	it('a missing API key without the settings callback shows no action button', () => {
		render({ error: NO_KEY, onRetry: () => {} });
		expect(buttonLabels()).toEqual([]);
	});

	it('a missing API key shows the message and no hook icon', () => {
		render({ error: NO_KEY });
		expect(banner().textContent).toContain('Aucune clé API pour « ifm »');
		expect(document.querySelector('[data-slot="chat-error-hook-icon"]')).toBeNull();
	});

	it('a plain error with details shows details, copy, retry, dismiss in that order', () => {
		render({ error: PLAIN, onRetry: () => {}, onDismiss: () => {}, onOpenModelSettings: () => {} });
		expect(buttonLabels()).toEqual(['Afficher les détails', 'Copier', 'Réessayer', 'Masquer l’erreur']);
		expect(button('Configurer')).toBeNull();
	});

	it('an error without details has no details button, but keeps copy', () => {
		render({ error: UNKNOWN_ONE_LINE });
		expect(document.querySelector('[data-slot="chat-error-details-button"]')).toBeNull();
		expect(buttonLabels()).toEqual(['Copier']);
	});

	it('without onRetry there is no retry button', () => {
		render({ error: PLAIN, onDismiss: () => {} });
		expect(button('Réessayer')).toBeNull();
		expect(button('Copier')).not.toBeNull();
	});

	it('without onDismiss there is no close button', () => {
		render({ error: PLAIN, onRetry: () => {} });
		expect(document.querySelector('[aria-label="Masquer l’erreur"]')).toBeNull();
	});

	it('a hook block with details keeps its details button and copy button', () => {
		render({ error: HOOK });
		expect(buttonLabels()).toEqual(['Afficher les détails', 'Copier']);
	});
});

describe('the retry button', () => {
	it('is enabled by default and calls onRetry once per click', () => {
		const onRetry = vi.fn();
		render({ error: PLAIN, onRetry });
		const retry = button('Réessayer')!;
		expect(retry.disabled).toBe(false);
		retry.click();
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it('is disabled while retryDisabled, and a click does nothing', () => {
		const onRetry = vi.fn();
		render({ error: PLAIN, onRetry, retryDisabled: true });
		const retry = button('Réessayer')!;
		expect(retry.disabled).toBe(true);
		retry.click();
		expect(onRetry).not.toHaveBeenCalled();
	});
});

describe('the other callbacks', () => {
	it('« Configurer » calls onOpenModelSettings once', () => {
		const onOpenModelSettings = vi.fn();
		render({ error: NO_KEY, onOpenModelSettings });
		button('Configurer')!.click();
		expect(onOpenModelSettings).toHaveBeenCalledTimes(1);
	});

	it('the close button calls onDismiss once, with its accessible name', () => {
		const onDismiss = vi.fn();
		render({ error: PLAIN, onDismiss });
		const close = document.querySelector<HTMLButtonElement>('[aria-label="Masquer l’erreur"]')!;
		expect(close.getAttribute('title')).toBe('Masquer l’erreur');
		close.click();
		expect(onDismiss).toHaveBeenCalledTimes(1);
	});
});

describe('the hook icon and the message', () => {
	it('a hook block shows the anchor icon, not the info icon', () => {
		render({ error: HOOK });
		expect(document.querySelector('[data-slot="chat-error-hook-icon"]')).not.toBeNull();
		expect(document.querySelector('[data-slot="chat-error-hook-icon"]')!.classList.contains('lucide-anchor')).toBe(true);
	});

	it('any other error shows the info icon', () => {
		render({ error: PLAIN });
		expect(document.querySelector('[data-slot="chat-error-hook-icon"]')).toBeNull();
		expect(banner().querySelector('.lucide-info')).not.toBeNull();
	});

	it('the message is shown with its full text as the title', () => {
		render({ error: PLAIN });
		const message = banner().querySelector<HTMLElement>('[title]')!;
		expect(message.textContent).toBe(PLAIN.message);
		expect(message.getAttribute('title')).toBe(PLAIN.message);
	});

	it('the banner is an alert region', () => {
		render({ error: PLAIN });
		expect(banner().getAttribute('role')).toBe('alert');
	});
});

describe('the details dialog', () => {
	it('opens on « Afficher les détails » and shows the message as title and the detail in a pre', async () => {
		render({ error: PLAIN });
		expect(document.querySelector('pre')).toBeNull();
		flushReact(() => button('Afficher les détails')!.click());
		await tickReact();
		await vi.waitFor(() => expect(document.querySelector('[role="dialog"] pre')).not.toBeNull());
		const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
		expect(dialog.querySelector('pre')!.textContent).toBe(PLAIN.detail);
		expect(dialog.textContent).toContain(PLAIN.message);
	});

	it('shows the whole multi-line detail in the pre', async () => {
		const raw = 'Provider error 500: first\nsecond line';
		render({ error: resolveChatError(raw) });
		flushReact(() => button('Afficher les détails')!.click());
		await tickReact();
		await vi.waitFor(() => expect(document.querySelector('[role="dialog"] pre')).not.toBeNull());
		expect(document.querySelector('[role="dialog"] pre')!.textContent).toBe(raw);
	});
});

describe('« Copier »', () => {
	it('writes the clipboard text of the view and confirms with a toast', async () => {
		const writeText = vi.fn(async (_text: string) => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		render({ error: PLAIN });
		flushReact(() => button('Copier')!.click());
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		expect(writeText).toHaveBeenCalledWith(chatErrorCopyText(PLAIN));
		expect(writeText.mock.calls[0]![0]).toContain('Provider error 400: bad request');
		await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Détails de l’erreur copiés'));
	});

	it('copies the summary only when there are no details', async () => {
		const writeText = vi.fn(async (_text: string) => undefined);
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		render({ error: UNKNOWN_ONE_LINE });
		flushReact(() => button('Copier')!.click());
		await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
		expect(writeText).toHaveBeenCalledWith('Erreur Bricks\n\nRésumé de l’erreur\nErreur brute');
	});

	it('a refused clipboard write shows the failure toast with the reason', async () => {
		const writeText = vi.fn(async (_text: string) => {
			throw new Error('permission denied');
		});
		Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
		render({ error: PLAIN });
		flushReact(() => button('Copier')!.click());
		await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Copie impossible : permission denied'));
		expect(toast).not.toHaveBeenCalledWith('Détails de l’erreur copiés');
	});

	it('without a clipboard API the failure toast names the missing clipboard', async () => {
		Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
		render({ error: PLAIN });
		flushReact(() => button('Copier')!.click());
		await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Copie impossible : clipboard-unavailable'));
	});
});
