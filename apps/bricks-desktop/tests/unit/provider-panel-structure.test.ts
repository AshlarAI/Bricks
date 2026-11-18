// Static checks of the provider settings (sources read, not rendered): the settings are a full-window
// page with a sidebar, the « Usage » section is in the data group after « Models », the App mounts that
// page and makes the workspace inert meanwhile, the models section is built from the provider nav, the
// detail and the template picker (no more grouped list), the provider forms ask for no identifier, and
// the provider logo follows the resolved theme. Same approach as config-view-structure.test.ts.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fr } from '../../src/lib/i18n/messages/fr';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');
const exists = (path: string) => existsSync(new URL(`../../src/${path}`, import.meta.url));

const PAGE = 'lib/features/settings/SettingsPage.svelte';
const APP = 'App.svelte';
const PROVIDER_FORM = 'lib/features/settings/ProviderFormDialog.svelte';
const MODEL_FORM = 'lib/features/settings/ModelFormDialog.svelte';
const USAGE = 'lib/features/settings/UsageSettings.svelte';
const MODELS = 'lib/features/settings/ModelSettings.svelte';
const GROUP = 'lib/features/settings/ProviderGroup.svelte';
const LOGO = 'lib/features/settings/ProviderLogo.svelte';

describe('the settings page: a full-window sidebar', () => {
	const page = src(PAGE);

	it('is built on the shadcn sidebar, imported as Sidebar', () => {
		expect(page).toContain("import * as Sidebar from '$lib/components/ui/sidebar';");
	});

	it('is a provider around a root that never collapses', () => {
		expect(page).toContain('<Sidebar.Provider');
		expect(page).toContain('<Sidebar.Root collapsible="none">');
	});

	it('has the way back to the workspace, under its label', () => {
		expect(page).toContain('<Sidebar.MenuButton');
		expect(page).toContain("t('settings.backToWorkspace')");
	});

	it('has the search field of the sections, on the input group', () => {
		expect(page).toContain("import * as InputGroup from '$lib/components/ui/input-group';");
		expect(page).toContain('<InputGroup.Root');
		expect(page).toContain('<InputGroup.Input');
		expect(page).toContain("t('settings.searchSettings')");
	});

	it('renders the active section under its title, from its content component', () => {
		expect(page).toContain('<h1');
		expect(page).toContain('<current.content />');
	});
});

describe('the settings search', () => {
	const page = src(PAGE);

	it('shows the search icon in the addon of the field', () => {
		expect(page).toContain("import Search from '@lucide/svelte/icons/search';");
		expect(page).toContain('<InputGroup.Addon>');
		expect(page).toMatch(/<InputGroup\.Addon>\s*<Search \/>\s*<\/InputGroup\.Addon>/);
	});

	it('is labelled « Rechercher » in French', () => {
		expect(fr['settings.searchSettings']).toBe('Rechercher');
	});
});

describe('the settings page: a usage section after models', () => {
	const page = src(PAGE);
	const dataGroup = page.slice(page.indexOf("t('settings.groupData')"));

	it('declares the usage section with its label, the ChartColumn icon and the UsageSettings content', () => {
		expect(page).toContain(
			"{ id: 'usage', get label() { return t('common.usage') }, icon: ChartColumn, content: UsageSettings }"
		);
		expect(page).toContain("import ChartColumn from '@lucide/svelte/icons/chart-column'");
		expect(page).toContain("import UsageSettings from './UsageSettings.svelte'");
	});

	it('sits in the data group, which comes after the basics and agent groups', () => {
		expect(dataGroup).toContain("id: 'usage'");
		expect(page.indexOf("t('settings.groupAgent')")).toBeLessThan(page.indexOf("t('settings.groupData')"));
	});

	it('lists it after the models section', () => {
		expect(page.indexOf("id: 'models'")).toBeGreaterThan(-1);
		expect(page.indexOf("id: 'usage'")).toBeGreaterThan(page.indexOf("id: 'models'"));
	});
});

describe('the App: the settings page replaces the dialog', () => {
	const app = src(APP);

	it('imports the settings page', () => {
		expect(app).toContain("import SettingsPage from '$lib/features/settings/SettingsPage.svelte'");
	});

	it('mounts it while the settings are open', () => {
		expect(app).toContain('{#if ui.settingsOpen}');
		expect(app).toContain('<SettingsPage {systemButtons} />');
	});

	it('makes the workspace inert while the settings are open', () => {
		expect(app).toContain('inert={ui.settingsOpen}');
	});

	it('no longer mentions the settings dialog', () => {
		expect(app).not.toContain('SettingsDialog');
	});
});

describe('the provider and model forms: no identifier field', () => {
	it.each([PROVIDER_FORM, MODEL_FORM])('%s neither shows the identifier label nor validates an identifier', (file) => {
		const form = src(file);
		expect(form).not.toContain('common.identifier');
		expect(form).not.toContain('validateNewId');
	});
});

describe('the usage settings', () => {
	it('imports the Separator of the UI kit for the figures row and the legend', () => {
		expect(src(USAGE)).toContain("import { Separator } from '$lib/components/ui/separator';");
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
