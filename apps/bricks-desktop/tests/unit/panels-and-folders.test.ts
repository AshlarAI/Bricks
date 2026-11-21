// The side panels share the main area's background in both themes, the dark
// theme sits on a neutral charcoal (ZCode neutral-900, not black), a folder
// lists three conversations before « Afficher plus », and a folder without Git
// says so without a final period.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tokens from '../../src/lib/theme/tokens.json';
import { bound, call } from './french-keys';

const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

describe('theme: light and dark surface hierarchy', () => {
	// Light mode frames a pure white chat (#ffffff) with a soft #fafafa sidebar and top bar.
	it('the light frame (top bar and left panel) is one step darker than the pure-white surface', () => {
		const [frame] = tokens.colors.light.sidebar as number[];
		const [surface] = tokens.colors.light.background as number[];
		expect(surface).toBe(1);
		expect(surface - frame).toBeGreaterThanOrEqual(0.015);
		expect(surface - frame).toBeLessThanOrEqual(0.08);
	});

	// Dark mode sets the deep obsidian chat (#070708) below the raised sidebar (#111114) and
	// composer (#15151a), keeping high contrast under light text.
	it('the dark chat background sits below the sidebar and composer under light text', () => {
		const [frame] = tokens.colors.dark.sidebar as number[];
		const [background] = tokens.colors.dark.background as number[];
		const [card] = tokens.colors.dark.card as number[];
		const [foreground] = tokens.colors.dark.foreground as number[];
		expect(background).toBeLessThan(0.15);
		expect(frame - background).toBeGreaterThanOrEqual(0.03);
		expect(card).toBeGreaterThan(frame);
		expect(foreground - background).toBeGreaterThanOrEqual(0.75);
	});
});

describe('folders and Git', () => {
	it('lists three conversations per folder before « Afficher plus »', () => {
		expect(source('lib/features/navigation/ProjectList.tsx')).toContain('const SHOWN_PER_PROJECT = 3');
	});

	it('says Git is not installed in the folder, without a final period', () => {
		const env = source('lib/features/context/ProjectEnvironment.tsx');
		expect(env).toContain(`{${call('Git n’est pas installé dans ce dossier')}}</span>`);
		expect(env).not.toContain('n’est pas un dépôt Git');
		expect(source('lib/features/changes/GitChanges.tsx')).toContain(
			bound('title', 'Git n’est pas installé dans ce dossier')
		);
	});
});
