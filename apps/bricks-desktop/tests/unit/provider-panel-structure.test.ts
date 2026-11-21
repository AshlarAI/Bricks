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

const PAGE = 'lib/features/settings/SettingsPage.tsx';
const APP = 'App.tsx';
const PROVIDER_FORM = 'lib/features/settings/ProviderFormDialog.tsx';
const MODEL_FORM = 'lib/features/settings/ModelFormDialog.tsx';
const USAGE = 'lib/features/settings/UsageSettings.tsx';
const MODELS = 'lib/features/settings/ModelSettings.tsx';
const GROUP = 'lib/features/settings/ProviderGroup.tsx';
const GROUP_SVELTE = 'lib/features/settings/ProviderGroup.svelte';
const LOGO = 'lib/features/settings/ProviderLogo.tsx';

describe('the settings page: a full-window sidebar', () => {
	const page = src(PAGE);

	it('is built on the shadcn sidebar', () => {
		expect(page).toContain("from '$lib/components/ui/sidebar'");
		expect(page).toContain('SidebarProvider');
	});

	it('is a provider around a root that never collapses', () => {
		expect(page).toContain('<SidebarProvider');
		expect(page).toContain('<Sidebar collapsible="none">');
	});

	it('has the way back to the workspace, under its label', () => {
		expect(page).toContain('<SidebarMenuButton');
		expect(page).toContain("t('settings.backToWorkspace')");
	});

	it('has the search field of the sections, on the input group', () => {
		expect(page).toContain("import { InputGroup, InputGroupAddon, InputGroupInput } from '$lib/components/ui/input-group'");
		expect(page).toContain('<InputGroup');
		expect(page).toContain('<InputGroupInput');
		expect(page).toContain("t('settings.searchSettings')");
	});

	it('renders the active section under its title, from its content component', () => {
		expect(page).toContain('<h1');
		expect(page).toContain('const CurrentContent = current.content');
		expect(page).toContain('<CurrentContent key={current.id} />');
	});
});

describe('the settings search', () => {
	const page = src(PAGE);

	it('shows the search icon in the addon of the field', () => {
		expect(page).toMatch(/import\s*\{[^}]*\bSearchIcon\b[^}]*\}\s*from 'lucide-react'/);
		expect(page).toContain('<InputGroupAddon>');
		expect(page).toMatch(/<InputGroupAddon>\s*<SearchIcon \/>\s*<\/InputGroupAddon>/);
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
			"{ id: 'usage', get label() { return t('common.usage') }, icon: ChartColumnIcon, content: UsageSettings }"
		);
		expect(page).toMatch(/import\s*\{[^}]*\bChartColumnIcon\b[^}]*\}\s*from 'lucide-react'/);
		expect(page).toContain("import UsageSettings from './UsageSettings'");
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
		expect(app).toContain("import SettingsPage from '$lib/features/settings/SettingsPage'");
	});

	it('mounts it while the settings are open', () => {
		expect(app).toContain('{settingsOpen && <SettingsPage systemButtons={systemButtons} />}');
	});

	it('makes the workspace inert while the settings are open', () => {
		expect(app).toContain('inert={settingsOpen}');
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
		expect(src(USAGE)).toContain("import { Separator } from '$lib/components/ui/separator'");
	});
});

describe('the models section', () => {
	const models = src(MODELS);

	it('is built from the provider nav, the provider detail and the template picker', () => {
		expect(models).toContain("import ProviderNav from './ProviderNav'");
		expect(models).toContain("import ProviderDetail from './ProviderDetail'");
		expect(models).toContain("import ProviderTemplatePicker from './ProviderTemplatePicker'");
		expect(models).toContain('<ProviderNav');
		expect(models).toContain('<ProviderDetail');
		expect(models).toContain('<ProviderTemplatePicker');
	});

	it('no longer imports the grouped provider list', () => {
		expect(models).not.toContain('ProviderGroup');
	});
});

describe('the grouped provider list', () => {
	it('is gone: there is no ProviderGroup', () => {
		expect(exists(GROUP)).toBe(false);
		expect(exists(GROUP_SVELTE)).toBe(false);
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
		expect(logo).toContain("import { useTheme } from '$lib/theme/theme'");
		expect(logo).toContain("resolved === 'dark'");
	});
});
