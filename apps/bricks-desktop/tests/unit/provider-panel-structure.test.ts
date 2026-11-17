// Static checks of the provider settings (sources read, not rendered): the « Usage » section sits
// after « Models » in the settings dialog, the models section is built from the provider nav, the
// detail and the template picker (no more grouped list), and the provider logo follows the resolved
// theme. Same approach as config-view-structure.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const exists = (path: string) => existsSync(new URL(`../../src/${path}`, import.meta.url));

const DIALOG = 'lib/features/settings/SettingsDialog.svelte';
const MODELS = 'lib/features/settings/ModelSettings.svelte';
const GROUP = 'lib/features/settings/ProviderGroup.svelte';
const LOGO = 'lib/features/settings/ProviderLogo.svelte';

describe('the settings dialog: a usage section after models', () => {
	const dialog = src(DIALOG);

	it('declares the usage section with its label and the ChartColumn icon', () => {
		expect(dialog).toContain("id: 'usage'");
		expect(dialog).toContain("t('common.usage')");
		expect(dialog).toContain("import ChartColumn from '@lucide/svelte/icons/chart-column'");
		expect(dialog).toContain('<Tabs.Content value="usage"');
	});

	it('lists it after the models section', () => {
		expect(dialog.indexOf("id: 'models'")).toBeGreaterThan(-1);
		expect(dialog.indexOf("id: 'usage'")).toBeGreaterThan(dialog.indexOf("id: 'models'"));
	});
});

describe('the models section', () => {
	const models = src(MODELS);

	it('is built from the provider nav, the provider detail and the template picker', () => {
		expect(models).toContain("import ProviderNav from './ProviderNav.svelte'");
		expect(models).toContain("import ProviderDetail from './ProviderDetail.svelte'");
		expect(models).toContain("import ProviderTemplatePicker from './ProviderTemplatePicker.svelte'");
		expect(models).toContain('<ProviderNav');
		expect(models).toContain('<ProviderDetail');
		expect(models).toContain('<ProviderTemplatePicker');
	});

	it('no longer imports the grouped provider list', () => {
		expect(models).not.toContain('ProviderGroup');
	});
});

describe('the grouped provider list', () => {
	it('is gone: there is no ProviderGroup.svelte', () => {
		expect(exists(GROUP)).toBe(false);
	});
});

describe('the provider logo', () => {
	const logo = src(LOGO);

	it('imports the light and the dark OpenCode marks from the provider icons', () => {
		expect(logo).toMatch(/from '\.\.\/\.\.\/\.\.\/assets\/provider-icons\/opencode-light\.svg'/);
		expect(logo).toMatch(/from '\.\.\/\.\.\/\.\.\/assets\/provider-icons\/opencode-dark\.svg'/);
		expect(exists('assets/provider-icons/opencode-light.svg')).toBe(true);
		expect(exists('assets/provider-icons/opencode-dark.svg')).toBe(true);
	});

	it('switches the mark on the resolved theme', () => {
		expect(logo).toContain("import { theme } from '$lib/theme/theme.svelte'");
		expect(logo).toContain("theme.resolved === 'dark'");
	});
});
