// @vitest-environment happy-dom
// The welcome's typed line (TypedLine.svelte): typed a third slower than before, and while
// `paused` (composer focused) the line in progress is finished and kept, even mid-erase.
// The cycle goes on once the pause ends. Mounted in happy-dom with fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import TypedLine from '../../src/lib/features/conversation/welcome/TypedLine.svelte';
import { t } from '../../src/lib/i18n/i18n.svelte';
import { typedLineProps } from './typed-line-props.svelte';

const LINE1 = t('welcome.line1');
/** With `Math.random` at 0: 35 ms a key, times the pace of 1.5. */
const KEY_MS = 52.5;

let target: HTMLDivElement;
let app: ReturnType<typeof mount> | null = null;

function typed(): string {
	return target.querySelector('[aria-hidden="true"]')?.textContent ?? '';
}
function caretStill(): boolean {
	return target.querySelector('.caret')?.classList.contains('still') ?? false;
}
async function advance(ms: number): Promise<void> {
	await vi.advanceTimersByTimeAsync(ms);
	flushSync();
}
function setPaused(paused: boolean): void {
	typedLineProps.paused = paused;
	flushSync();
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.spyOn(Math, 'random').mockReturnValue(0);
	typedLineProps.paused = false;
	target = document.createElement('div');
	document.body.append(target);
	app = mount(TypedLine, { target, props: typedLineProps });
	flushSync();
});

afterEach(() => {
	if (app) unmount(app);
	app = null;
	target.remove();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('TypedLine', () => {
	it('types a key every 52.5 ms instead of 35 ms', async () => {
		expect(typed()).toBe(LINE1.slice(0, 1));
		await advance(50);
		expect(typed()).toBe(LINE1.slice(0, 1));
		await advance(5);
		expect(typed()).toBe(LINE1.slice(0, 2));
	});

	it('finishes the line and keeps it while paused, then goes on', async () => {
		await advance(KEY_MS * 3);
		setPaused(true);
		await advance(60_000);
		expect(typed()).toBe(LINE1);
		expect(caretStill()).toBe(true);

		setPaused(false);
		expect(caretStill()).toBe(false);
		await advance(2600 + 33 * 3 + 10);
		expect(typed().length).toBeLessThan(LINE1.length);
	});

	it('types the line back when paused during the erase', async () => {
		await advance(60_000);
		// Somewhere in a cycle: wait until an erase is under way.
		let guard = 0;
		let prev = typed();
		for (;;) {
			await advance(33);
			const now = typed();
			if (now.length > 0 && now.length < prev.length) break;
			prev = now;
			if (++guard > 5000) throw new Error('no erase seen');
		}
		const full = target.querySelector('.sr-only')?.textContent ?? '';
		setPaused(true);
		await advance(60_000);
		expect(typed()).toBe(full);
		expect(caretStill()).toBe(true);
	});
});
