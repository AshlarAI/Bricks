// Unit tests for the patch helpers of the models settings: the patch that only switches a model
// offered or hidden, the patch that changes one provider field, and the key page of a known brand.
import { describe, expect, it } from 'vitest';
import { KEY_URLS, enabledPatch, providerFieldPatch } from '../../src/lib/features/settings/models';

describe('enabledPatch', () => {
	it('sends only enabled as true when the model is offered', () => {
		expect(enabledPatch(true)).toEqual({
			name: null,
			api_model: null,
			max_input_tokens: null,
			max_output_tokens: null,
			input_modalities: null,
			pricing: null,
			profiles: null,
			async_tool_calls: null,
			enabled: true
		});
	});

	it('sends only enabled as false when the model is hidden', () => {
		expect(enabledPatch(false)).toEqual({
			name: null,
			api_model: null,
			max_input_tokens: null,
			max_output_tokens: null,
			input_modalities: null,
			pricing: null,
			profiles: null,
			async_tool_calls: null,
			enabled: false
		});
	});
});

describe('providerFieldPatch', () => {
	it('sends the one given field and null for every other provider field', () => {
		expect(providerFieldPatch({ endpoint: 'x' })).toEqual({
			name: null,
			endpoint: 'x',
			protocol: null,
			auth: null,
			auth_header: null,
			api_key: null
		});
	});
});

describe('KEY_URLS', () => {
	it('points the OpenCode brand to its key page', () => {
		expect(KEY_URLS.opencode).toBe('https://opencode.ai/auth');
	});
});

describe('keyProblem', () => {
	it('accepts a key alone and refuses one with spaces or line breaks', async () => {
		const { keyProblem } = await import('../../src/lib/features/settings/models');
		expect(keyProblem('  sk-abc123  ')).toBeNull();
		expect(keyProblem('Bearer sk-abc123')).toContain('espace');
		expect(keyProblem('sk-abc\n123')).toContain('espace');
	});
});
