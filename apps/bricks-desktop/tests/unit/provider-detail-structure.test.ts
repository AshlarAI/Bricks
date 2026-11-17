// Static checks of the provider detail, the model row, the usage section and the template picker
// (sources read, not rendered): the shared UI parts they import, the helpers the detail calls, the
// translation keys of the model row, the icon sizes inside its buttons, the type scale of the usage
// section, and the labels of the template picker. Same approach as provider-panel-structure.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const DETAIL = 'lib/features/settings/ProviderDetail.svelte';
const ROW = 'lib/features/settings/ModelRow.svelte';
const USAGE = 'lib/features/settings/UsageSettings.svelte';
const PICKER = 'lib/features/settings/ProviderTemplatePicker.svelte';

describe('provider detail: shared UI parts, the model test and the field patch', () => {
	const detail = src(DETAIL);

	it('imports the shared UI parts as namespaces or named components', () => {
		expect(detail).toContain("import * as Field from '$lib/components/ui/field'");
		expect(detail).toContain("import * as InputGroup from '$lib/components/ui/input-group'");
		expect(detail).toContain("import * as Select from '$lib/components/ui/select'");
		expect(detail).toContain("import * as DropdownMenu from '$lib/components/ui/dropdown-menu'");
		expect(detail).toContain("import { Toggle } from '$lib/components/ui/toggle'");
		expect(detail).toContain("import * as Item from '$lib/components/ui/item'");
	});

	it('tests a model and saves a single field through the field patch', () => {
		expect(detail).toContain('modelTest(');
		expect(detail).toContain('providerFieldPatch(');
	});

	it('spaces its blocks with gaps, not space-y classes', () => {
		expect(detail).not.toContain('space-y-');
	});
});

describe('model row: shared parts, catalogue labels and icon sizes', () => {
	const row = src(ROW);

	it('imports the Switch and Badge components and the Item parts', () => {
		expect(row).toContain("import { Switch } from '$lib/components/ui/switch'");
		expect(row).toContain("import { Badge } from '$lib/components/ui/badge'");
		expect(row).toContain("import * as Item from '$lib/components/ui/item'");
	});

	it('labels the vision badge and the token limits with catalogue keys', () => {
		expect(row).toContain("t('settings.vision')");
		expect(row).toContain("t('settings.maximumInput')");
		expect(row).toContain("t('settings.maximumOutput')");
	});

	it('gives no icon of its buttons a size class', () => {
		const icons = ['<Pencil', '<Trash', '<Plug', '<CircleCheck', '<CircleX'];
		const lines = row.split('\n').filter((line) => icons.some((icon) => line.includes(icon)));
		expect(lines.length).toBeGreaterThan(0);
		for (const line of lines) expect(line).not.toContain('size-');
	});
});

describe('usage section: the empty state and the type scale', () => {
	const usage = src(USAGE);

	it('imports the empty state as a namespace', () => {
		expect(usage).toContain("import * as Empty from '$lib/components/ui/empty'");
	});

	it('has no 10px or 11px text class', () => {
		expect(usage).not.toContain('text-[10px]');
		expect(usage).not.toContain('text-[11px]');
	});
});

describe('template picker: the key label comes from Field', () => {
	const picker = src(PICKER);

	it('labels its key field with Field.Label', () => {
		expect(picker).toContain("import * as Field from '$lib/components/ui/field'");
		expect(picker).toContain('Field.Label');
	});

	it('no longer imports the plain label component', () => {
		expect(picker).not.toContain('$lib/components/ui/label');
	});
});
