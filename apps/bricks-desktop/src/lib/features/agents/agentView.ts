// Sub-agent presentation: state mapping and labels.
// Pure helpers, no component state.

import { t, numberFormat, dateTimeFormat } from '$lib/i18n/i18n';
import type { ChangeSetState, InstanceState, Termination } from '$lib/ipc/engine';
import { TERMINAL_AGENT_STATES } from '$lib/ipc/engine';
import type { StatusState } from '$lib/layout/types';
import type { BadgeVariant } from '$lib/components/ui/badge';

export interface AgentStateView {
	dot: StatusState;
	label: string;
}

const STATE_VIEW: Record<InstanceState, AgentStateView> = {
	created: { dot: 'waiting', get label() { return t('common.created') } },
	queued: { dot: 'waiting', get label() { return t('agents.queued') } },
	waiting_admission: { dot: 'waiting', get label() { return t('agents.waitingForAdmission') } },
	starting: { dot: 'running', get label() { return t('agents.starting') } },
	running: { dot: 'running', get label() { return t('common.running') } },
	cancelling: { dot: 'running', get label() { return t('agents.cancelling') } },
	completed: { dot: 'success', get label() { return t('common.finished') } },
	incomplete: { dot: 'waiting', get label() { return t('common.incomplete') } },
	failed: { dot: 'error', get label() { return t('common.failed') } },
	interrupted: { dot: 'error', get label() { return t('common.interrupted') } },
	cancelled: { dot: 'cancelled', get label() { return t('common.cancelled') } }
};

export function agentStateView(state: InstanceState): AgentStateView {
	return STATE_VIEW[state];
}

/** Not yet finished: the engine may still change this agent. */
export function isLive(state: InstanceState): boolean {
	return !TERMINAL_AGENT_STATES.includes(state);
}

/** The person may ask the engine to stop this agent. */
export function canCancel(state: InstanceState): boolean {
	return isLive(state) && state !== 'cancelling';
}


export { formatDuration } from '../conversation/format';

const TIME = dateTimeFormat({
	hour: '2-digit',
	minute: '2-digit',
	second: '2-digit'
});

export function formatTime(ms: number): string {
	return TIME.format(new Date(ms));
}

const COUNT = numberFormat();
const USD = numberFormat({
	style: 'currency',
	currency: 'USD',
	maximumFractionDigits: 4
});

export function formatUsd(amount: number): string {
	return USD.format(amount);
}

export function formatCount(n: number): string {
	return COUNT.format(n);
}

/** Heading of a successful engine answer to a control action. */
export function controlDoneLabel(action: string): string {
	switch (action) {
		case 'cancel':
			return t('agents.stopRequested');
		case 'apply_changes':
			return t('agents.changesApplied');
		case 'discard_changes':
			return t('agents.changesDiscarded');
		default:
			return t('agents.actionCompleted');
	}
}

/** Heading of a failed engine answer; the engine's own text follows it. */
export function controlFailedLabel(action: string): string {
	switch (action) {
		case 'cancel':
			return t('agents.couldNotStop');
		case 'apply_changes':
			return t('common.couldNotApply');
		case 'discard_changes':
			return t('common.couldNotDiscard');
		default:
			return t('agents.actionFailed');
	}
}

export function isolationLabel(isolation: string): string {
	return isolation === 'worktree' ? t('agents.isolatedWorktree') : t('agents.sharedWorkspace');
}

export function terminationLabel(end: Termination | undefined): string | null {
	if (!end) return null;
	switch (end.kind) {
		case 'completed':
			return t('agents.finishedNormally');
		case 'output_truncated':
			return t('agents.outputTruncatedContinuation', { count: String(end.continuations) });
		case 'no_progress':
			return t('agents.noProgressRepetition', { count: String(end.repeats) });
		default:
			// A kind of an earlier version: interrupted, never a success.
			return t('common.interruptedEndOldSession');
	}
}

/** Git porcelain letter of a changed file. */
export function changeStatusLabel(code: string): string {
	switch (code) {
		case 'A':
			return t('common.added');
		case 'M':
			return t('common.modified');
		case 'D':
			return t('common.deleted');
		case 'R':
			return t('common.renamed');
		case 'C':
			return t('common.copied');
		default:
			return code;
	}
}

export function changesetLabel(state: ChangeSetState): string {
	switch (state) {
		case 'ready':
			return t('agents.readyToApply');
		case 'applied':
			return t('agents.applied');
		case 'conflict':
			return t('common.conflict');
		case 'discarded':
			return t('agents.discarded');
	}
}

export function changesetVariant(state: ChangeSetState): BadgeVariant {
	switch (state) {
		case 'ready':
			return 'default';
		case 'applied':
			return 'secondary';
		case 'conflict':
			return 'destructive';
		case 'discarded':
			return 'outline';
	}
}
