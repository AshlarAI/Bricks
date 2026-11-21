// The sentence of the empty composer (hints.ts): a stable pick per conversation among three
// sentences, spread over the conversations, with its French and English texts in the catalogue.
// The composer reads it from the conversation id; the source check keeps that wiring.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/lib/i18n/messages/en';
import { fr } from '../../src/lib/i18n/messages/fr';
import { HINT_COUNT, hintIndex } from '../../src/lib/features/composer/hints';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const KEYS = ['composer.anythingToSay', 'composer.eagerForYourMind', 'composer.askBricksAnything'] as const;

describe('hintIndex: a stable pick for each conversation', () => {
	it('gives the same pick for the same seed, every time', () => {
		for (const seed of ['conv-1', 'conv-2', 'conv-3', 'a-longer-session-identifier']) {
			expect(hintIndex(seed)).toBe(hintIndex(seed));
		}
	});

	it('keeps the pick of a seed (the hash is fixed)', () => {
		expect(hintIndex('conv-1')).toBe(1);
		expect(hintIndex('conv-2')).toBe(2);
		expect(hintIndex('conv-3')).toBe(0);
		expect(hintIndex('ab')).toBe(0);
	});

	it('always gives an index within the sentences', () => {
		const seeds = ['', 'x', 'conv-1', 'é', '会話-1', '8f3c2a10-0000-4000-8000-000000000001', 'x'.repeat(500)];
		for (const seed of seeds) {
			const index = hintIndex(seed);
			expect(Number.isInteger(index), seed).toBe(true);
			expect(index, seed).toBeGreaterThanOrEqual(0);
			expect(index, seed).toBeLessThan(HINT_COUNT);
		}
	});

	it('spreads different conversations over all three sentences', () => {
		const sessionIds = ['conv-1', 'conv-2', 'conv-3', 'conv-4', 'conv-5', 'conv-6'];
		const uuidLike = [1, 2, 3, 4, 5, 6].map((n) => `8f3c2a10-0000-4000-8000-00000000000${n}`);
		for (const ids of [sessionIds, uuidLike]) {
			const picks = new Set(ids.map((id) => hintIndex(id)));
			expect([...picks].sort()).toEqual([0, 1, 2]);
		}
	});

	it('gives the first sentence to a new conversation, with no id yet', () => {
		expect(hintIndex('')).toBe(0);
	});

	it('gives 0 when there is nothing to pick from', () => {
		expect(hintIndex('conv-1', 0)).toBe(0);
		expect(hintIndex('', 0)).toBe(0);
	});

	it('picks among HINT_COUNT sentences by default, and there are three', () => {
		expect(HINT_COUNT).toBe(3);
		expect(hintIndex('conv-1')).toBe(hintIndex('conv-1', HINT_COUNT));
	});
});

describe('the composer sentences in the catalogue', () => {
	it('has the three French sentences', () => {
		expect(fr['composer.anythingToSay']).toBe('Quelque chose à dire ?');
		expect(fr['composer.eagerForYourMind']).toBe('Hâte de subir la force de votre esprit et de vos doigts !');
		expect(fr['composer.askBricksAnything']).toBe('Demandez tout à Bricks, avec / pour une commande et @ pour un dossier');
	});

	it('has the same three keys in English', () => {
		expect(en['composer.anythingToSay']).toBe('Anything to say?');
		expect(en['composer.eagerForYourMind']).toBe('Eager to feel the force of your mind and your fingers!');
		expect(en['composer.askBricksAnything']).toBe('Ask Bricks anything, with / for a command and @ for a folder');
	});

	it('no longer has composer.prepareTheNextMessage, in either language', () => {
		expect('composer.prepareTheNextMessage' in fr).toBe(false);
		expect('composer.prepareTheNextMessage' in en).toBe(false);
	});
});

describe('the composer shows the sentence picked from the conversation', () => {
	const composer = src('lib/features/composer/Composer.tsx');

	it('imports hintIndex from the hints module', () => {
		expect(composer).toContain("import { hintIndex } from './hints'");
	});

	it('lists the three sentences and picks one by the conversation id', () => {
		for (const key of KEYS) expect(composer).toContain(`t('${key}')`);
		expect(composer).toContain("hintIndex(conversation?.sessionId ?? '', hints.length)");
	});
});
