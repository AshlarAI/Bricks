// The copy button of a Markdown code block follows the interface language (it was hard-coded
// « Copier »), and the label changes when the language does.
import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage } from '../../src/lib/i18n/i18n.svelte';
import { codeBlockHtml } from '../../src/lib/features/conversation/markdown/render';

afterEach(() => setLanguage('fr'));

describe('code block copy label', () => {
	it('is translated', () => {
		setLanguage('en');
		expect(codeBlockHtml('ls', 'bash')).toContain('data-copy');
		expect(codeBlockHtml('ls', 'bash')).toMatch(/data-copy[^>]*>Copy<\/button>/);
		setLanguage('fr');
		expect(codeBlockHtml('ls', 'bash')).toMatch(/data-copy[^>]*>Copier<\/button>/);
	});
});
