// The view of an engine error above the composer (chat-error.ts): every recognised engine string
// (no API key, hook, authentication, provider status, rate limit, context overflow), the unknown
// fallback, the refused-command prefix, and the clipboard text of « Copier ». The setup file has
// set French; the English cases switch and switch back.
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../src/lib/i18n/i18n';
import { chatErrorCopyText, resolveChatError, type ChatErrorView } from '../../src/lib/features/conversation/chat-error';

afterEach(() => setLanguage('fr'));

describe('resolveChatError (French)', () => {
	it('no API key: the model settings are the only way out, the message names the provider', () => {
		const view = resolveChatError('Authentication error: provider "ifm": no API key; add it in the Bricks settings');
		expect(view).toEqual({
			message: 'Aucune clé API pour « ifm » : ajoutez-la dans les réglages.',
			detail: null,
			modelConfigMissing: true,
			hookBlocked: false,
		});
	});

	it('no API key: the provider name is read from the quoted id, whatever it holds', () => {
		const view = resolveChatError('Authentication error: provider "my-provider.v2": no API key');
		expect(view.message).toContain('« my-provider.v2 »');
		expect(view.modelConfigMissing).toBe(true);
	});

	it('hook: the reason is the text after « Blocked by hook: », the detail is the whole text', () => {
		const view = resolveChatError('Blocked by hook: x');
		expect(view).toEqual({
			message: 'Bloqué par un hook : x',
			detail: 'Blocked by hook: x',
			modelConfigMissing: false,
			hookBlocked: true,
		});
	});

	it('hook wrapped in a provider error is still a hook block, with the wrapper kept in the details', () => {
		const view = resolveChatError('Provider error: Blocked by hook: x');
		expect(view.hookBlocked).toBe(true);
		expect(view.message).toBe('Bloqué par un hook : x');
		expect(view.detail).toBe('Provider error: Blocked by hook: x');
	});

	it('hook: the reason is trimmed', () => {
		expect(resolveChatError('Blocked by hook:    spaced reason   ').message).toBe('Bloqué par un hook : spaced reason');
	});

	it('other authentication errors: the authentication message, the raw text as details', () => {
		const raw = 'Authentication error: token expired';
		expect(resolveChatError(raw)).toEqual({
			message: 'Le fournisseur a refusé la clé API.',
			detail: raw,
			modelConfigMissing: false,
			hookBlocked: false,
		});
	});

	it('provider status with a body: the status is in the message, the raw text is the detail', () => {
		const raw = 'Provider error 400: invalid model';
		expect(resolveChatError(raw)).toEqual({
			message: 'Le fournisseur a renvoyé une erreur 400.',
			detail: raw,
			modelConfigMissing: false,
			hookBlocked: false,
		});
	});

	it('provider status without a body is still recognised', () => {
		const view = resolveChatError('Provider error 503');
		expect(view.message).toBe('Le fournisseur a renvoyé une erreur 503.');
		expect(view.detail).toBe('Provider error 503');
	});

	it('provider status keeps a multi-line body in the details', () => {
		const raw = 'Provider error 500: first line\nsecond line';
		const view = resolveChatError(raw);
		expect(view.message).toBe('Le fournisseur a renvoyé une erreur 500.');
		expect(view.detail).toBe(raw);
	});

	it('rate limit: its own message, the raw text as details', () => {
		const raw = 'Rate limit exceeded: 100 requests per minute';
		expect(resolveChatError(raw)).toEqual({
			message: 'Limite de requêtes atteinte : réessayez plus tard.',
			detail: raw,
			modelConfigMissing: false,
			hookBlocked: false,
		});
	});

	it('context overflow: its own message, the raw text as details', () => {
		const raw = 'Context overflow: 10/5 tokens';
		expect(resolveChatError(raw)).toEqual({
			message: 'Le contexte est plein : compactez ou ouvrez une nouvelle conversation.',
			detail: raw,
			modelConfigMissing: false,
			hookBlocked: false,
		});
	});

	it('unknown single line: the line is the message, no details', () => {
		expect(resolveChatError('  Something odd happened  ')).toEqual({
			message: 'Something odd happened',
			detail: null,
			modelConfigMissing: false,
			hookBlocked: false,
		});
	});

	it('unknown multi-line: the first line is the message, the whole text the details', () => {
		const raw = 'Disk full\nno space left on /dev/sda1';
		expect(resolveChatError(raw)).toEqual({
			message: 'Disk full',
			detail: raw,
			modelConfigMissing: false,
			hookBlocked: false,
		});
	});

	it('unknown: a leading blank line is trimmed before the first line is taken', () => {
		const view = resolveChatError('\n\nDisk full\nmore');
		expect(view.message).toBe('Disk full');
		expect(view.detail).toBe('Disk full\nmore');
	});

	it('empty input: the « unknown » message, no details', () => {
		expect(resolveChatError('')).toEqual({
			message: 'Erreur inconnue',
			detail: null,
			modelConfigMissing: false,
			hookBlocked: false,
		});
	});

	it('whitespace-only input is treated as empty', () => {
		expect(resolveChatError('   \n\t  ').message).toBe('Erreur inconnue');
	});

	it('a prefix (refused command) leads the message', () => {
		const view = resolveChatError('Rate limit exceeded', 'Changement de modèle refusé');
		expect(view.message).toBe('Changement de modèle refusé : Limite de requêtes atteinte : réessayez plus tard.');
		expect(view.detail).toBe('Rate limit exceeded');
	});

	it('a prefix leads the unknown message too', () => {
		expect(resolveChatError('Oops', 'Envoi refusé').message).toBe('Envoi refusé : Oops');
	});

	it('a prefix leads the no-API-key message and keeps the model-config flag', () => {
		const view = resolveChatError('Authentication error: provider "ifm": no API key', 'Envoi refusé');
		expect(view.message).toBe('Envoi refusé : Aucune clé API pour « ifm » : ajoutez-la dans les réglages.');
		expect(view.modelConfigMissing).toBe(true);
	});

	it('a null or empty prefix changes nothing', () => {
		const plain = resolveChatError('Oops');
		expect(resolveChatError('Oops', null)).toEqual(plain);
		expect(resolveChatError('Oops', '')).toEqual(plain);
	});

	it('a hook block with a prefix keeps the hook icon flag', () => {
		const view = resolveChatError('Blocked by hook: x', 'Envoi refusé');
		expect(view.message).toBe('Envoi refusé : Bloqué par un hook : x');
		expect(view.hookBlocked).toBe(true);
	});
});

describe('resolveChatError (English)', () => {
	it('no API key in English', () => {
		setLanguage('en');
		expect(resolveChatError('Authentication error: provider "ifm": no API key; add it in the Bricks settings')).toEqual({
			message: 'No API key for “ifm”: add it in the settings.',
			detail: null,
			modelConfigMissing: true,
			hookBlocked: false,
		});
	});

	it('provider status in English, with the status and the raw detail', () => {
		setLanguage('en');
		expect(resolveChatError('Provider error 400: bad request')).toEqual({
			message: 'The provider returned error 400.',
			detail: 'Provider error 400: bad request',
			modelConfigMissing: false,
			hookBlocked: false,
		});
	});

	it('the unknown message and the prefix in English', () => {
		setLanguage('en');
		expect(resolveChatError('').message).toBe('Unknown error');
		expect(resolveChatError('Oops', 'Sending refused').message).toBe('Sending refused: Oops');
	});

	it('switching back to French gives French again', () => {
		setLanguage('en');
		expect(resolveChatError('Context overflow: 1/2').message).toBe('The context is full: compact it or start a new conversation.');
		setLanguage('fr');
		expect(resolveChatError('Context overflow: 1/2').message).toBe('Le contexte est plein : compactez ou ouvrez une nouvelle conversation.');
	});
});

describe('chatErrorCopyText', () => {
	it('without details: the heading, the summary and the message only', () => {
		const view: ChatErrorView = { message: 'Erreur brute', detail: null, modelConfigMissing: false, hookBlocked: false };
		expect(chatErrorCopyText(view)).toBe('Erreur Bricks\n\nRésumé de l’erreur\nErreur brute');
	});

	it('with details: a details heading and the detail follow the summary, after a blank line', () => {
		const view: ChatErrorView = {
			message: 'Le fournisseur a renvoyé une erreur 400.',
			detail: 'Provider error 400: bad\nbody',
			modelConfigMissing: false,
			hookBlocked: false,
		};
		expect(chatErrorCopyText(view)).toBe(
			'Erreur Bricks\n\nRésumé de l’erreur\nLe fournisseur a renvoyé une erreur 400.\n\nDétails de l’erreur\nProvider error 400: bad\nbody',
		);
	});

	it('the copied text follows the language of the moment', () => {
		setLanguage('en');
		const view = resolveChatError('Provider error 500: boom');
		expect(chatErrorCopyText(view)).toBe(
			'Bricks error\n\nError summary\nThe provider returned error 500.\n\nError details\nProvider error 500: boom',
		);
	});

	it('is built from a resolved view: a hook block copies its reason and the engine text', () => {
		const view = resolveChatError('Blocked by hook: no rm -rf');
		expect(chatErrorCopyText(view)).toBe(
			'Erreur Bricks\n\nRésumé de l’erreur\nBloqué par un hook : no rm -rf\n\nDétails de l’erreur\nBlocked by hook: no rm -rf',
		);
	});
});

describe('one-line messages', () => {
	// The banner is one line: a multi-line hook reason is joined, and stays whole in the details.
	it('a multi-line hook reason still gives a one-line message', () => {
		const view = resolveChatError('Blocked by hook: first\nsecond');
		expect(view.message).not.toContain('\n');
		expect(view.message).toContain('first second');
		expect(view.detail).toBe('Blocked by hook: first\nsecond');
	});
});
