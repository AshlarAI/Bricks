export const FOCUS_REFRESH_COOLDOWN_MS = 2_000;

/**
 * Single-flight and cooldown gate for focus-triggered refreshes so window
 * activation bursts or OS dialog closes never re-trigger rapid subprocess calls.
 */
export class FocusGate {
	#inFlight = 0;
	#lastFinishedAt: number | null = null;
	readonly #cooldownMs: number;
	readonly #now: () => number;

	constructor(cooldownMs = FOCUS_REFRESH_COOLDOWN_MS, now: () => number = () => Date.now()) {
		this.#cooldownMs = cooldownMs;
		this.#now = now;
	}

	get busy(): boolean {
		return this.#inFlight > 0;
	}

	canRunOnFocus(): boolean {
		if (this.#inFlight > 0) return false;
		if (this.#lastFinishedAt !== null && this.#now() - this.#lastFinishedAt < this.#cooldownMs) {
			return false;
		}
		return true;
	}

	async track<T>(work: () => Promise<T>): Promise<T> {
		this.#inFlight += 1;
		try {
			return await work();
		} finally {
			this.#inFlight -= 1;
			this.#lastFinishedAt = this.#now();
		}
	}
}
