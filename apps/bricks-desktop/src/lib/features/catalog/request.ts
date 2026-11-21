// Engine requests sent by the catalog views, and the answers they wait for.
//
// The engine answers a command later, as an event that replaces one field of
// the conversation with a new object. A request is answered once that field
// holds another object than when the command was sent (and, for
// `agent_control`, once the answer carries the expected action). A refusal
// comes either from the IPC call (`app.command` returns the message) or as a
// `command_rejected` event of the same command name. Nothing is faked: while
// neither has happened, the request is pending.

import { useCallback, useRef, useState, useSyncExternalStore } from 'react';
import type { Command } from '$lib/ipc/engine';
import { app } from '$lib/state/app';
import type { Conversation } from '$lib/state/conversation';
import { ObservableStore, useStoreVersion } from '$lib/state/observable';

export type ProfilesAnswer = NonNullable<Conversation['agentProfiles']>;
export type SkillsAnswer = NonNullable<Conversation['skillsListing']>;
export type ControlAnswer = NonNullable<Conversation['lastAgentControl']>;

/** The conversation fields the engine's answers replace. */
export const profilesSlot = (conv: Conversation) => conv.agentProfiles;
export const skillsSlot = (conv: Conversation) => conv.skillsListing;
export const controlSlot = (conv: Conversation) => conv.lastAgentControl;

interface Sent {
	conv: Conversation;
	/** Command name, as `command_rejected` names it. */
	command: string;
	/** Action the `agent_control` answer must carry, when there is one. */
	action: string | null;
	slot: (conv: Conversation) => unknown;
	/** The field as it was when the command was sent. */
	seen: unknown;
	/** The last rejection as it was when the command was sent. */
	rejection: unknown;
}

interface Subscribable {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => number;
}

function asSubscribable(value: unknown): Subscribable | null {
	if (typeof value !== 'object' || value === null) return null;
	const candidate = value as Partial<Subscribable>;
	if (typeof candidate.subscribe !== 'function' || typeof candidate.getSnapshot !== 'function') {
		return null;
	}
	return candidate as Subscribable;
}

interface RequestSnapshot {
	request: EngineRequest;
	target: Conversation | null;
	pending: boolean;
	refusal: string | null;
	answered: unknown;
}

const noopSubscribe = () => () => {};

/**
 * Tracks a single engine command sent to the active conversation along with its
 * pending state, IPC or engine refusal, and typed answer once received.
 */
export class EngineRequest extends ObservableStore {
	#sent: Sent | null = null;
	#refused: string | null = null;

	/** Conversation the active request was sent to, if any. */
	get target(): Conversation | null {
		return this.#sent?.conv ?? null;
	}

	/**
	 * Sends `command` to the open conversation. `slot` reads the field the
	 * answer replaces; `action` is the `agent_control` action the answer must
	 * carry. Does nothing when no conversation is open.
	 */
	async send(
		command: Command,
		slot: (conv: Conversation) => unknown,
		action: string | null = null
	): Promise<void> {
		const conv = app.current;
		if (!conv) return;
		const sent: Sent = {
			conv,
			command: command.type,
			action,
			slot,
			seen: slot(conv),
			rejection: conv.lastRejection
		};
		this.#sent = sent;
		this.#refused = null;
		this.emit();
		const error = await app.command(conv.sessionId, command);
		// A refused command gets no answer: show the refusal, stop waiting.
		if (error && this.#sent === sent) {
			this.#refused = error;
			this.#sent = null;
			this.emit();
		}
	}

	/** The answer, once it has arrived; otherwise null. */
	answered<T>(): T | null {
		const sent = this.#sent;
		if (!sent) return null;
		const value = sent.slot(sent.conv);
		if (value === null || value === undefined || value === sent.seen) return null;
		if (sent.action !== null && (value as { action?: unknown }).action !== sent.action) {
			return null;
		}
		return value as T;
	}

	/** Sent, not refused, not answered yet. */
	get pending(): boolean {
		return this.#sent !== null && this.refusal === null && this.answered() === null;
	}

	/** The IPC call or the engine refused the command. */
	get refusal(): string | null {
		if (this.#refused) return this.#refused;
		const sent = this.#sent;
		if (!sent) return null;
		const last = sent.conv.lastRejection;
		return last && last !== sent.rejection && last.command === sent.command ? last.reason : null;
	}
}

/**
 * Subscribes a React component to an existing `EngineRequest` and the target
 * conversation fields that resolve or refuse it.
 */
export function useRequest(request: EngineRequest): EngineRequest {
	useStoreVersion(request);
	const target = request.target;
	const subscribable = asSubscribable(target);
	const cacheRef = useRef<RequestSnapshot | null>(null);

	const subscribe = useCallback(
		(onStoreChange: () => void) =>
			subscribable ? subscribable.subscribe(onStoreChange) : noopSubscribe(),
		[subscribable]
	);

	const getSnapshot = useCallback((): RequestSnapshot => {
		const answered = request.answered();
		const pending = request.pending;
		const refusal = request.refusal;
		const prev = cacheRef.current;
		if (
			prev &&
			prev.request === request &&
			prev.target === target &&
			Object.is(prev.answered, answered) &&
			prev.pending === pending &&
			prev.refusal === refusal
		) {
			return prev;
		}
		const next: RequestSnapshot = { request, target, pending, refusal, answered };
		cacheRef.current = next;
		return next;
	}, [request, target]);

	useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
	return request;
}

/** Creates and subscribes to an `EngineRequest` scoped to the calling component. */
export function useEngineRequest(): EngineRequest {
	const [request] = useState(() => new EngineRequest());
	return useRequest(request);
}
