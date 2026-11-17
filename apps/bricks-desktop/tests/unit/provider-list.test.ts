// Unit tests for the provider helpers of the models settings: readiness, the label of the status dot,
// and the grouping of the provider list (known brands first, custom providers last).
import { describe, expect, it } from 'vitest';
import { fr } from '../../src/lib/i18n/messages/fr';
import type { ModelView } from '../../src/lib/ipc/bindings/ModelView';
import type { ProviderView } from '../../src/lib/ipc/bindings/ProviderView';
import { providerGroups, providerReady, providerStatusLabel } from '../../src/lib/features/settings/models';

const MODEL: ModelView = {
	id: 'alpha',
	selection: 'acme/alpha',
	name: 'Alpha',
	api_model: 'alpha',
	protocol: null,
	endpoint: null,
	input_modalities: ['text'],
	output_modalities: ['text'],
	streaming: true,
	async_tool_calls: false,
	enabled: true,
	max_input_tokens: 1000,
	max_output_tokens: 100,
	profiles: [],
	priced: false,
	document_mime_types: [],
	pricing: null
};

/** A provider with credentials and one model, unless the overrides say otherwise. */
function provider(id: string, overrides: Partial<ProviderView> = {}): ProviderView {
	return {
		id,
		name: id,
		endpoint: `https://${id}.test/v1`,
		protocol: 'chat_completions',
		auth: 'bearer',
		auth_header: null,
		api_key: null,
		has_credentials: true,
		path: null,
		header_names: [],
		logo: null,
		models: [MODEL],
		...overrides
	};
}

const ids = (providers: ProviderView[]): string[] => providers.map((p) => p.id);

describe('providerReady', () => {
	it('is ready with credentials and at least one model', () => {
		expect(providerReady(provider('a'))).toBe(true);
	});

	it('is not ready without credentials', () => {
		expect(providerReady(provider('a', { has_credentials: false }))).toBe(false);
	});

	it('is not ready without a model', () => {
		expect(providerReady(provider('a', { models: [] }))).toBe(false);
	});
});

describe('providerStatusLabel', () => {
	it('reports missing credentials first, even when there is no model either', () => {
		const label = providerStatusLabel(provider('a', { has_credentials: false, models: [] }));
		expect(label).toBe(fr['settings.credentialsMissing']);
	});

	it('reports a provider with credentials but no model', () => {
		expect(providerStatusLabel(provider('a', { models: [] }))).toBe(fr['settings.noModelForThisProvider']);
	});

	it('reports a ready provider', () => {
		expect(providerStatusLabel(provider('a'))).toBe(fr['settings.providerReady']);
	});
});

describe('providerGroups', () => {
	it('puts the opencode providers first, under the OpenCode title, then the custom ones', () => {
		const groups = providerGroups([
			provider('mine'),
			provider('oc-a', { logo: 'opencode' }),
			provider('other'),
			provider('oc-b', { logo: 'opencode' })
		]);
		expect(groups.map((g) => g.id)).toEqual(['opencode', 'custom']);
		expect(groups[0].title).toBe('OpenCode');
		expect(ids(groups[0].providers)).toEqual(['oc-a', 'oc-b']);
		expect(ids(groups[1].providers)).toEqual(['mine', 'other']);
	});

	it('keeps the custom group last when it comes first in the list', () => {
		const groups = providerGroups([provider('mine'), provider('oc', { logo: 'opencode' })]);
		expect(groups.map((g) => g.id)).toEqual(['opencode', 'custom']);
		expect(ids(groups[1].providers)).toEqual(['mine']);
	});

	it('keeps the file order inside each group', () => {
		const groups = providerGroups([
			provider('z-custom'),
			provider('b-oc', { logo: 'opencode' }),
			provider('a-custom'),
			provider('a-oc', { logo: 'opencode' })
		]);
		expect(ids(groups[0].providers)).toEqual(['b-oc', 'a-oc']);
		expect(ids(groups[1].providers)).toEqual(['z-custom', 'a-custom']);
	});

	it('treats a logo that is not a known brand as a custom provider', () => {
		const groups = providerGroups([provider('x', { logo: 'unknown' })]);
		expect(groups.map((g) => g.id)).toEqual(['custom']);
	});

	it('has no brand group when no provider carries a brand', () => {
		expect(providerGroups([provider('a')]).map((g) => g.id)).toEqual(['custom']);
	});

	it('returns no groups for no providers', () => {
		expect(providerGroups([])).toEqual([]);
	});
});
