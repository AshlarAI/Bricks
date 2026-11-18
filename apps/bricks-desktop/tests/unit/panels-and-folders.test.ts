// The side panels share the main area's background in both themes, the dark
// theme sits on a neutral charcoal (ZCode neutral-900, not black), a folder
// lists three conversations before « Afficher plus », and a folder without Git
// says so without a final period.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import tokens from '../../src/lib/theme/tokens.json';
import { bound, call } from './french-keys';

const source = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

describe('theme: a frame around one inset surface', () => {
	// One step darker than the surface: neutral-50 over neutral-100 in light (0.015), neutral-900
	// over neutral-950 in dark (0.06). The ceiling of 0.08 stops short of neutral-800 over
	// neutral-950 (0.124), the next step of the scale.
	it.each(['light', 'dark'] as const)('the %s frame (top bar and left panel) is darker than the surface', (mode) => {
		const [frame] = tokens.colors[mode].sidebar as number[];
		const [surface] = tokens.colors[mode].background as number[];
		expect(surface - frame).toBeGreaterThanOrEqual(0.015);
		expect(surface - frame).toBeLessThanOrEqual(0.08);
	});

	// neutral-900 (0.205) sits between neutral-950 (0.145) and neutral-800 (0.269): the
	// midpoints of those steps bound it. neutral-200 text (0.922) is a lightness step of
	// 0.717 above it, about 14:1 in contrast, so light text on dark still reads well.
	it('the dark background is a neutral charcoal (neutral-900), not black, under a light text', () => {
		const [background] = tokens.colors.dark.background as number[];
		const [foreground] = tokens.colors.dark.foreground as number[];
		expect(background).toBeGreaterThan(0.175);
		expect(background).toBeLessThan(0.237);
		expect(foreground - background).toBeGreaterThanOrEqual(0.7);
	});
});

describe('folders and Git', () => {
	it('lists three conversations per folder before « Afficher plus »', () => {
		expect(source('lib/features/navigation/ProjectList.svelte')).toContain('const SHOWN_PER_PROJECT = 3;');
	});

	it('says Git is not installed in the folder, without a final period', () => {
		const env = source('lib/features/context/ProjectEnvironment.svelte');
		expect(env).toContain(`{${call('Git n’est pas installé dans ce dossier')}}</span>`);
		expect(env).not.toContain('n’est pas un dépôt Git');
		expect(source('lib/features/changes/GitChanges.svelte')).toContain(
			bound('title', 'Git n’est pas installé dans ce dossier')
		);
	});
});
