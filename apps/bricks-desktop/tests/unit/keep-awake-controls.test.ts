// Static checks of the two « Maintenir l’ordinateur actif » controls and of their wiring (sources
// read, not rendered). The menu Plus sets the open conversation only, with the sub-text « Uniquement
// pour cette session » and no full stop. Paramètres › Général is one switch on the saved preference,
// with its title alone. App.tsx asks the host to keep awake from both. Same approach as
// context-card-structure.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { call } from './french-keys';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const PLUS = 'lib/features/context/PlusMenu.tsx';
const GENERAL = 'lib/features/settings/GeneralSettings.tsx';
const APP = 'App.tsx';

describe('menu Plus: the item is for this conversation only', () => {
	const plus = src(PLUS);

	it('is a checkbox item that stays open when chosen', () => {
		expect(plus).toContain('<DropdownMenuPrimitive.CheckboxItem');
		expect(plus).toContain('onSelect={(e) => e.preventDefault()}');
	});

	it('reads and sets the open conversation, never the saved preference', () => {
		expect(plus).toContain('const keepAwake = useConversation(current, (c) => c.keepAwake) ?? false');
		expect(plus).toContain('current?.setKeepAwake(on)');
		expect(plus).not.toContain('setPrefs');
		expect(plus).not.toContain('keep_awake');
	});

	it('is titled « Maintenir l’ordinateur actif », with the sub-text « Uniquement pour cette session » and no full stop', () => {
		expect(plus).toContain(`<span className="text-sm">{${call('Maintenir l’ordinateur actif')}}</span>`);
		expect(plus).toContain(`<span className="text-xs text-muted-foreground">{${call('Uniquement pour cette session')}}</span>`);
		expect(plus).not.toContain('Uniquement pour cette session.');
	});
});

describe('Paramètres › Général: one switch, no sub-text', () => {
	const general = src(GENERAL);

	it('is one switch on the saved preference', () => {
		expect(general).toContain('const keepAwake = useApp((s) => s.prefs.keep_awake)');
		expect(general).toContain(
			'<Switch checked={keepAwake} onCheckedChange={(on) => app.setPrefs({ keep_awake: on })} />'
		);
	});

	it('its label is the title alone, the switch inside it', () => {
		expect(general).toMatch(/<label className="[^"]*">\s*\{t\('common\.keepTheComputerAwake'\)\}\s*<Switch/);
	});

	it('has no sub-text: nothing about the session, and no description line', () => {
		expect(general).not.toContain('Uniquement pour cette session');
		expect(general).not.toMatch(/Maintenir l’ordinateur actif\s*<\/span>\s*<span/);
	});
});

describe('App: the host keeps awake from either wish', () => {
	it('asks for the preference or a running conversation that asked for it', () => {
		const app = src(APP);
		expect(app).toContain("import { keepAwakeWanted } from '$lib/state/keepAwake'");
		expect(app).toContain('const keepAwakePref = useApp((s) => s.prefs.keep_awake)');
		expect(app).toContain('keepAwakeWanted(keepAwakePref, app.conversations.values())');
		expect(app).toContain('keepAwakeSet(wanted)');
	});
});
