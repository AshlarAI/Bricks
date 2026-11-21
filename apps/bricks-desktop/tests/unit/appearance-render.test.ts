// Appearance: the settings page shows two groups, the theme mode and the app icon, and no colour
// choice. The component is rendered as the app renders it, so the test reads the markup the user gets.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHtml } from './react-test-utils';
import AppearanceSettings from '../../src/lib/features/settings/AppearanceSettings';
import { DEFAULT_PREFERENCES, app } from '../../src/lib/state/app';

const ipc = vi.hoisted(() => ({
	prefsSet: vi.fn(),
	sessionDelete: vi.fn(),
	errorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));
vi.mock('$lib/ipc/client', () => ipc);

function page(): string {
	return renderHtml(AppearanceSettings);
}

/** The radio buttons of the page, as [group name, value, checked], in the order they are shown. */
function radios(html: string): [string, string, boolean][] {
	return (html.match(/<input\b[^>]*>/g) ?? []).map((tag) => {
		const name = /\bname="([^"]*)"/.exec(tag)?.[1] ?? '';
		const value = /\bvalue="([^"]*)"/.exec(tag)?.[1] ?? '';
		// The class names mention « :checked », so only the checked attribute itself is read.
		const checked = /\bchecked\b/.test(tag.replace(/\bclass="[^"]*"/, ''));
		return [name, value, checked];
	});
}

/** The values of one radio group, in the order they are shown. */
function values(group: string, html: string): string[] {
	return radios(html)
		.filter(([name]) => name === group)
		.map(([, value]) => value);
}

beforeEach(() => {
	app.prefs = { ...DEFAULT_PREFERENCES };
});

describe('appearance settings', () => {
	it('shows two groups, the theme mode and the app icon, and no other section', () => {
		const html = page();
		expect(html.match(/<section\b/g)).toHaveLength(2);
		expect(html.match(/<fieldset\b/g)).toHaveLength(2);
	});

	it('offers the light, dark and system theme modes', () => {
		expect(values('theme-mode', page())).toEqual(['light', 'dark', 'system']);
	});

	it('offers the light, dark and aligned app icons', () => {
		expect(values('app-icon', page())).toEqual(['light', 'dark', 'aligned']);
	});

	it('has no other control: six radio buttons and no colour picker', () => {
		const inputs = page().match(/<input\b[^>]*>/g) ?? [];
		expect(inputs).toHaveLength(6);
		expect(inputs.every((tag) => tag.includes('type="radio"'))).toBe(true);
	});

	it('marks the saved theme mode and app icon as checked', () => {
		app.prefs = { ...DEFAULT_PREFERENCES, theme: 'dark', app_icon: 'light' };
		const checked = radios(page())
			.filter(([, , isChecked]) => isChecked)
			.map(([name, value]) => `${name}=${value}`);
		expect(checked).toEqual(['theme-mode=dark', 'app-icon=light']);
	});
});
