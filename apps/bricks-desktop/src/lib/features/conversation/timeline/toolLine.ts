// One trace line per tool call (its title says what it does or did), and the
// one-line trace of a resolved approval. Shared by the timeline and the
// sub-agent lines. Pure functions only.

import { t } from '$lib/i18n/i18n';
import { DECIDED_BY_LABEL, DECISION_LABEL, formatDuration, formatToolName } from '../format';
import type { DecidedBy, Decision } from '$lib/ipc/engine';
import type { MessageKey } from '$lib/i18n/messages/en';

/** What the line says about a call. */
export type ToolLineState = 'running' | 'done' | 'failed' | 'interrupted';

export const TOOL_LINE_LABEL: Record<ToolLineState, string> = {
	get running() { return t('common.running') },
	get done() { return t('common.finished') },
	get failed() { return t('common.failed') },
	get interrupted() { return t('common.interrupted') }
};

/** The facts of a call that the line depends on (a timeline tool or a sub-agent tool). */
export interface ToolCallFacts {
	status: 'running' | 'ok' | 'error';
	durationMs?: number;
	output?: string;
}

/**
 * State of a call. `interrupted` is true when the run (or sub-agent) that made the
 * call ended by cancellation or interruption. The reducer marks the calls still
 * running at the end of a run as errors without a result: under such a run, those
 * calls are interruptions, not failures. A call with a result stays done or failed.
 */
export function toolLineState(call: ToolCallFacts, interrupted: boolean): ToolLineState {
	if (call.status === 'ok') return 'done';
	if (call.status === 'running') return interrupted ? 'interrupted' : 'running';
	if (interrupted && call.durationMs === undefined && call.output === undefined) {
		return 'interrupted';
	}
	return 'failed';
}

type Verb = 'read' | 'edit' | 'search' | 'run' | 'fetch';

const VERB_OF: Record<string, Verb> = {
	Read: 'read', ViewImage: 'read',
	Write: 'edit', Edit: 'edit', MultiEdit: 'edit', ApplyPatch: 'edit', NotebookEdit: 'edit',
	Grep: 'search', Glob: 'search', Search: 'search',
	Bash: 'run', bash: 'run', Shell: 'run', PowerShell: 'run',
	WebFetch: 'fetch', WebSearch: 'fetch'
};

const VERB_KEY: Record<Verb, { now: MessageKey; past: MessageKey }> = {
	read: { now: 'conversation.toolReading', past: 'conversation.toolRead' },
	edit: { now: 'conversation.toolEditing', past: 'conversation.toolEdited' },
	search: { now: 'conversation.toolSearching', past: 'conversation.toolSearched' },
	run: { now: 'conversation.toolRunning', past: 'conversation.toolRan' },
	fetch: { now: 'conversation.toolFetching', past: 'conversation.toolFetched' }
};

function field(input: unknown, keys: string[]): string | null {
	if (typeof input !== 'object' || input === null) return null;
	const record = input as Record<string, unknown>;
	for (const key of keys) {
		const value = record[key];
		if (typeof value === 'string' && value.trim() !== '') return value.trim().replace(/\s+/g, ' ');
	}
	return null;
}

/** What the call works on: a file name, a pattern, a command, an address. */
function target(verb: Verb, input: unknown): string | null {
	switch (verb) {
		case 'read':
		case 'edit': {
			const path = field(input, ['file_path', 'path', 'notebook_path']);
			return path ? (path.split(/[\\/]/).filter(Boolean).pop() ?? path) : null;
		}
		case 'search':
			return field(input, ['pattern', 'query']);
		case 'run':
			return field(input, ['command']);
		case 'fetch':
			return field(input, ['url', 'query']);
	}
}

/**
 * The title of a call's line: « Exécute cargo test » while it runs, « A exécuté
 * cargo test » once it ended. A tool without a known verb, or a call without a
 * target, is named by the tool.
 */
export function toolTitle(name: string, input: unknown, state: ToolLineState): string {
	const verb = VERB_OF[name];
	const what = verb ? target(verb, input) : null;
	if (!verb || !what) return formatToolName(name);
	const key = VERB_KEY[verb][state === 'running' ? 'now' : 'past'];
	return t(key, { target: what });
}

/** Compact elapsed time; `null` when the engine gave no valid duration. */
export function formatToolDuration(ms: number | undefined): string | null {
	if (ms === undefined || !Number.isFinite(ms) || ms < 0) return null;
	return formatDuration(ms);
}

/**
 * The trace that replaces a resolved approval: `Autorisé · Bash · par vous`. Conversations
 * stored before answers covered one call only may carry other values: shown as allowed.
 */
export function approvalTrace(tool: string, resolved: { decision: Decision; by: DecidedBy }): string {
	const label = formatToolName(tool);
	const decision = DECISION_LABEL[resolved.decision] ?? DECISION_LABEL.allow;
	const by = DECIDED_BY_LABEL[resolved.by];
	return by ? `${decision} · ${label} · ${by}` : `${decision} · ${label}`;
}
