// A reactive "now" that refreshes periodically, so relative dates and timers stay current.

import { useEffect, useState } from 'react';
import { ObservableStore, useStoreSelector } from '$lib/state/observable';

/** Observable timestamp store that ticks on an interval while started. */
export class Clock extends ObservableStore {
	#now = Date.now();
	#intervalMs: number;
	#timer: ReturnType<typeof setInterval> | null = null;

	constructor(intervalMs = 60_000) {
		super();
		this.#intervalMs = intervalMs;
	}

	get now(): number {
		return this.#now;
	}

	get intervalMs(): number {
		return this.#intervalMs;
	}

	start(intervalMs = this.#intervalMs): () => void {
		this.stop();
		this.#intervalMs = intervalMs;
		const now = Date.now();
		if (now - this.#now >= Math.max(1, intervalMs)) {
			this.#now = now;
			this.emit();
		}
		this.#timer = setInterval(() => {
			this.#now = Date.now();
			this.emit();
		}, intervalMs);
		return () => this.stop();
	}

	stop(): void {
		if (this.#timer !== null) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}
}

/**
 * Creates a `Clock` store that refreshes every `intervalMs` milliseconds when started.
 * In React components, prefer `useClock(intervalMs)`.
 */
export function createClock(intervalMs = 60_000): Clock {
	return new Clock(intervalMs);
}

/** Subscribes a React component to a reactive `Date.now()` refreshed every `intervalMs`. */
export function useClock(intervalMs = 60_000): number {
	const [clock] = useState(() => new Clock(intervalMs));

	useEffect(() => clock.start(intervalMs), [clock, intervalMs]);

	return useStoreSelector(clock, (c) => c.now);
}
