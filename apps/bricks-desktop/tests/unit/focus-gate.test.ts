// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { FOCUS_REFRESH_COOLDOWN_MS, FocusGate } from '../../src/lib/state/focus-gate';
import { GitState } from '../../src/lib/features/changes/git.svelte';
import ProjectEnvironment from '../../src/lib/features/context/ProjectEnvironment.svelte';
import * as ipc from '../../src/lib/ipc/client';
import type { GitStatus, Project } from '../../src/lib/ipc/client';

vi.mock('@tauri-apps/api/core', () => {
	class Channel {
		onmessage: ((event: unknown) => void) | null = null;
	}
	return { Channel, invoke: vi.fn() };
});
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('$lib/ipc/client', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../src/lib/ipc/client')>()),
	gitStatus: vi.fn()
}));

const EMPTY_STATUS: GitStatus = {
	is_repo: true,
	branch: 'main',
	detached: false,
	head: 'abc1234',
	ahead: 0,
	behind: 0,
	entries: []
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

async function settle() {
	await new Promise((resolve) => setTimeout(resolve, 0));
	flushSync();
}

describe('FocusGate', () => {
	it('blocks focus runs while in-flight and during the cooldown window', async () => {
		let now = 1_000;
		const gate = new FocusGate(2_000, () => now);
		expect(gate.canRunOnFocus()).toBe(true);

		const d = deferred<void>();
		const pending = gate.track(() => d.promise);
		expect(gate.busy).toBe(true);
		expect(gate.canRunOnFocus()).toBe(false);

		now = 1_500;
		d.resolve();
		await pending;

		expect(gate.busy).toBe(false);
		expect(gate.canRunOnFocus()).toBe(false);

		now = 1_500 + 1_999;
		expect(gate.canRunOnFocus()).toBe(false);

		now = 1_500 + 2_000;
		expect(gate.canRunOnFocus()).toBe(true);
	});

	it('releases in-flight state even when the tracked task fails', async () => {
		let now = 10_000;
		const gate = new FocusGate(1_000, () => now);
		await expect(
			gate.track(async () => {
				throw new Error('boom');
			})
		).rejects.toThrow('boom');

		expect(gate.busy).toBe(false);
		expect(gate.canRunOnFocus()).toBe(false);
		now += 1_000;
		expect(gate.canRunOnFocus()).toBe(true);
	});
});

describe('GitState focus and concurrency guards', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-15T12:00:00Z'));
		vi.mocked(ipc.gitStatus).mockReset();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('coalesces overlapping refreshes and ignores rapid focus bursts', async () => {
		const pending = deferred<GitStatus>();
		vi.mocked(ipc.gitStatus).mockReturnValueOnce(pending.promise);

		const state = new GitState('p1');
		const first = state.refresh();
		const second = state.refresh();
		const focusWhileBusy = state.refreshOnFocus();
		expect(ipc.gitStatus).toHaveBeenCalledTimes(1);

		pending.resolve(EMPTY_STATUS);
		await Promise.all([first, second, focusWhileBusy]);

		// Immediate focus after completion is suppressed within cooldown.
		await state.refreshOnFocus();
		expect(ipc.gitStatus).toHaveBeenCalledTimes(1);

		// Once cooldown elapses, focus triggers a fresh read.
		vi.advanceTimersByTime(FOCUS_REFRESH_COOLDOWN_MS);
		vi.mocked(ipc.gitStatus).mockResolvedValueOnce(EMPTY_STATUS);
		await state.refreshOnFocus();
		expect(ipc.gitStatus).toHaveBeenCalledTimes(2);
	});

	it('queues one trailing refresh when requested with queueIfBusy while busy', async () => {
		const firstPending = deferred<GitStatus>();
		const secondPending = deferred<GitStatus>();
		vi.mocked(ipc.gitStatus)
			.mockReturnValueOnce(firstPending.promise)
			.mockReturnValueOnce(secondPending.promise);

		const state = new GitState('p2');
		const focusRun = state.refreshOnFocus();
		// Post-run refresh arrives mid-flight while an earlier read is still pending.
		const postRun = state.refresh(true);
		expect(ipc.gitStatus).toHaveBeenCalledTimes(1);

		firstPending.resolve(EMPTY_STATUS);
		await vi.advanceTimersByTimeAsync(0);
		expect(ipc.gitStatus).toHaveBeenCalledTimes(2);

		secondPending.resolve(EMPTY_STATUS);
		await Promise.all([focusRun, postRun]);
		expect(ipc.gitStatus).toHaveBeenCalledTimes(2);
	});
});

describe('ProjectEnvironment focus gating', () => {
	let target: HTMLDivElement;
	let component: ReturnType<typeof mount> | null = null;

	beforeEach(() => {
		vi.mocked(ipc.gitStatus).mockReset();
		target = document.createElement('div');
		document.body.appendChild(target);
	});

	afterEach(() => {
		if (component) void unmount(component);
		component = null;
		target.remove();
	});

	it('suppresses rapid focus storms after opening a project', async () => {
		vi.mocked(ipc.gitStatus).mockResolvedValue(EMPTY_STATUS);
		const project: Project = {
			id: 'proj-1',
			name: 'Demo',
			path: 'C:\\Users\\demo\\project',
			added_at: 1,
			last_opened_at: 1,
			missing: false,
			chats: false
		};

		component = mount(ProjectEnvironment, { target, props: { project } });
		await settle();
		expect(ipc.gitStatus).toHaveBeenCalledTimes(1);

		// Simulate a focus bounce loop on Windows right after opening/picker close.
		for (let i = 0; i < 5; i++) {
			window.dispatchEvent(new Event('focus'));
		}
		await settle();
		expect(ipc.gitStatus).toHaveBeenCalledTimes(1);
	});
});
