// Static checks of the « Configuration » view (sources read, not rendered): the model card has one
// « Effort » line, read from the effective effort (or « aucun »), and no longer the requested and
// applied efforts nor the default-of-the-model wording. The other settings come from the engine's
// rows, and the removed labels are gone. Same approach as context-card-structure.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { call } from './french-keys';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const CONFIG = 'lib/features/session-info/ConfigView.tsx';

describe('the model card: one effort line', () => {
	const config = src(CONFIG);

	it('shows one « Effort » line from the effective effort, or « aucun » when there is none', () => {
		expect(config).toContain(
			`<ConfigField label={${call('Effort')}} value={config.effective_reasoning ?? ${call('aucun')}} />`,
		);
	});

	it('no longer has « Effort demandé », « Effort appliqué » nor « par défaut du modèle »', () => {
		expect(config).not.toContain('Effort demandé');
		expect(config).not.toContain('Effort appliqué');
		expect(config).not.toContain('par défaut du modèle');
	});
});

describe('the other settings', () => {
	const config = src(CONFIG);

	it('come from the engine rows, one label and one value each', () => {
		expect(config).toContain('{config.settings.map((entry, i) => (');
		expect(config).toContain('<ConfigField key={i} label={entry.label} value={entry.value} />');
		expect(config).toContain('<dt className="text-muted-foreground">{label}</dt>');
		expect(config).toContain('<dd className="min-w-0 break-words">{value}</dd>');
	});

	it('the permissions card keeps the approval line and the policy editor, and no default-permissions line', () => {
		expect(config).toContain(`label={${call('Approbations')}}`);
		expect(config).toContain(`value={config.interactive ? ${call('demandées')} : ${call('refusées')}}`);
		expect(config).toContain('<PolicyEditor policy={policy} tools={toolNames} disabled={saving} onchange={change} />');
		expect(config).not.toMatch(/<ConfigField\b[\s\S]{0,80}common\.permissions/);
	});
});
