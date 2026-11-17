// Static checks (sources read, not rendered) of the error banner's wiring: the banner sits above the
// editor card, « Configurer » opens the model settings, « Réessayer » runs the failed message again
// through app.reviseMessage, the close button hides the error, and the run-end card no longer prints
// the raw error. Also the catalogue keys of chat.error.* (same keys, same placeholders in both
// languages). Same approach as layout-structure.test.ts.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { en } from '../../src/lib/i18n/messages/en';
import { fr } from '../../src/lib/i18n/messages/fr';

const src = (path: string) => readFileSync(new URL(`../../src/${path}`, import.meta.url), 'utf8');

const COMPOSER = 'lib/features/composer/Composer.svelte';
const RUN_END = 'lib/features/conversation/timeline/RunEndCard.svelte';
const BANNER = 'lib/features/conversation/ChatErrorBanner.svelte';

describe('composer: the banner is placed above the editor card', () => {
	const composer = src(COMPOSER);

	it('renders the banner under the chatError condition, before the editor card', () => {
		const condition = composer.indexOf('{#if chatError}');
		const banner = composer.indexOf('<ChatErrorBanner');
		const editorCard = composer.indexOf('relative z-10 mx-1 mt-1 flex flex-col rounded-xl');
		expect(condition).toBeGreaterThan(-1);
		expect(banner).toBeGreaterThan(condition);
		expect(editorCard).toBeGreaterThan(banner);
	});

	it('imports the banner and the view resolver from the conversation feature', () => {
		expect(composer).toContain("import ChatErrorBanner from '$lib/features/conversation/ChatErrorBanner.svelte'");
		expect(composer).toContain("import { resolveChatError, type ChatErrorView } from '$lib/features/conversation/chat-error'");
	});

	it('« Configurer » opens the models section of the settings', () => {
		expect(composer).toContain("onOpenModelSettings={() => ui.openSettings('models')}");
	});

	it('« Réessayer » runs the failed user message again through app.reviseMessage', () => {
		expect(composer).toMatch(/onRetry=\{retryItem \? \(\) => void retryRun\(\) : undefined\}/);
		expect(composer).toContain('refusal = await app.reviseMessage(conversation, item, item.text)');
	});

	it('retry is disabled while a retry is in flight or a run is running', () => {
		expect(composer).toContain('retryDisabled={retrying || running}');
	});

	it('a refusal that repeats the engine refusal of the same command is shown once', () => {
		expect(composer).toContain('refusal !== conversation?.lastRejection?.reason');
		expect(composer).toContain('if (refusal === rejection.reason) refusal = null');
	});

	it('the close button hides the shown error through dismissChatError', () => {
		expect(composer).toContain('onDismiss={dismissChatError}');
		expect(composer).toMatch(/function dismissChatError\(\) \{/);
	});

	it('the failed run error is read from the last run_end item only while not running', () => {
		expect(composer).toContain("if (item.kind !== 'run_end') continue");
		expect(composer).toContain('if (!conv || running) return null');
	});
});

describe('run-end card: no raw error line', () => {
	const runEnd = src(RUN_END);

	it('does not read conversation.error', () => {
		expect(runEnd).not.toContain('conversation.error');
	});

	it('does not print the run error text', () => {
		expect(runEnd).not.toMatch(/summary\.error/);
		expect(runEnd).not.toMatch(/run\.error/);
		expect(runEnd).not.toMatch(/Error:\s*\{/);
	});

	it('still shows the incomplete reason from the run summary', () => {
		expect(runEnd).toContain("const reason = $derived(summary.outcome === 'incomplete' ? summary.reason : null)");
	});
});

describe('banner component: the test ids the render tests rely on', () => {
	const banner = src(BANNER);

	it('has the role, the slots and the aria labels', () => {
		expect(banner).toContain('role="alert"');
		expect(banner).toContain('data-slot="chat-error-banner"');
		expect(banner).toContain('data-slot="chat-error-hook-icon"');
		expect(banner).toContain('data-slot="chat-error-details-button"');
		expect(banner).toContain("aria-label={t('chat.error.dismiss')}");
	});
});

describe('chat.error.* catalogue keys', () => {
	const keys = (catalogue: Record<string, unknown>) => Object.keys(catalogue).filter((k) => k.startsWith('chat.error.')).sort();
	const placeholders = (text: unknown) => (typeof text === 'string' ? [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort() : null);

	it('has the same keys in English and French, and at least the ones the banner uses', () => {
		expect(keys(fr)).toEqual(keys(en));
		for (const key of [
			'chat.error.copy',
			'chat.error.copied',
			'chat.error.copyFailed',
			'chat.error.copyHeading',
			'chat.error.detailHeading',
			'chat.error.dismiss',
			'chat.error.hookBlocked',
			'chat.error.noApiKey',
			'chat.error.prefixed',
			'chat.error.providerStatus',
			'chat.error.rateLimited',
			'chat.error.retry',
			'chat.error.setModels',
			'chat.error.showDetails',
			'chat.error.summary',
			'chat.error.unknown',
			'chat.error.authentication',
			'chat.error.contextOverflow',
		]) {
			expect(en, key).toHaveProperty(key);
		}
	});

	it('has the same placeholders in each pair', () => {
		for (const key of keys(en)) {
			expect(placeholders(fr[key as keyof typeof fr]), key).toEqual(placeholders(en[key as keyof typeof en]));
		}
	});
});
