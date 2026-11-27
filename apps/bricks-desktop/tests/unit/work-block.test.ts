// @vitest-environment happy-dom
// The work block (timeline/WorkBlock.tsx): the steps of a run under a thin bar. While the run
// works, the bar reads « Travaille depuis 3s » and shows the steps; folded, it names the current step. When
// the run ends it reads how long it worked, or how it ended, folds by itself, and what asks the person something stays
// visible while it is folded. Mounted in happy-dom and fed by the reducer.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { flushReact, mountReact, type MountedComponent } from './react-test-utils';
import WorkBlock, { type WorkBlockProps } from '../../src/lib/features/conversation/timeline/WorkBlock';
import { timelineBlocks, type WorkBlock as WorkBlockData } from '../../src/lib/features/conversation/runBlocks';
import { Conversation } from '../../src/lib/state/conversation';
import type { ApprovalRequest } from '../../src/lib/ipc/engine';
import { EnvelopeFeed, PROJECT_ID, T0, openedSession } from './fixtures';

const RUN = 'run-bar';

const APPROVAL: ApprovalRequest = {
	approval_id: 'ap-1',
	tool_call_id: 'tc-9',
	tool: 'Bash',
	level: 'execute',
	description: 'Lancer les tests',
	input: { command: 'npm test' },
	preview: null,
};

/** A conversation whose run started at `T0` and is still going. */
function runningRun() {
	const conv = new Conversation(openedSession(), PROJECT_ID);
	const feed = new EnvelopeFeed({ runId: RUN });
	conv.apply(feed.next({ type: 'run_started', prompt: 'Travaille', attachments: [], model: 'm' }, { at: T0 }));
	return { conv, feed };
}

type Feed = ReturnType<typeof runningRun>['feed'];

function readCall(conv: Conversation, feed: Feed, id: string, name: string) {
	conv.apply(feed.next({ type: 'tool_started', tool_call_id: id, name, input: { file_path: 'a.ts' } }));
	conv.apply(feed.next({ type: 'tool_finished', tool_call_id: id, name, is_error: false, duration_ms: 12, output: 'ok' }));
}

/** The work block's steps and reasoning, as the timeline gives them to the block. */
function barOf(conv: Conversation): Pick<WorkBlockData, 'items' | 'answerReasoning'> {
	const block = timelineBlocks(conv.items, conv.items, conv.runs, conv.runningRunId).find(
		(b): b is WorkBlockData => b.kind === 'work' && b.runId === RUN,
	);
	return block ?? { items: [], answerReasoning: null };
}

let target: HTMLDivElement;
let app: MountedComponent<WorkBlockProps> | null = null;

/** Mounts the block with the run's current steps and reasoning. */
function show(conv: Conversation, showPlan = false): void {
	const { items, answerReasoning } = barOf(conv);
	app = mountReact(WorkBlock, {
		target,
		props: {
			conversation: conv,
			runId: RUN,
			items,
			answerReasoning,
			showPlan,
		},
	});
}

/** Re-renders the mounted block with the latest timeline items from `conv`. */
function sync(conv: Conversation, mutate?: () => void): void {
	flushReact(() => {
		mutate?.();
	});
	const { items, answerReasoning } = barOf(conv);
	app?.rerender({ items, answerReasoning });
}

/**
 * The text on screen. A folded block keeps its steps in the DOM, as closed collapsible content
 * (`data-state="closed"`): once folded they are not on screen, so they are left out. happy-dom has
 * no closing animation to wait for, so the closed content is what the settled state looks like.
 */
function text(): string {
	const shown = target.cloneNode(true) as HTMLElement;
	for (const closed of shown.querySelectorAll('[data-slot="collapsible-content"][data-state="closed"], [hidden]')) {
		closed.remove();
	}
	return (shown.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The arrow of the bar: the first button of the block, when the block has steps to fold. */
function trigger(): HTMLButtonElement | null {
	return target.querySelector('button');
}

function expanded(): string | null {
	return trigger()?.getAttribute('aria-expanded') ?? null;
}

function toggle(): void {
	flushReact(() => {
		trigger()!.click();
	});
}

beforeEach(() => {
	target = document.createElement('div');
	document.body.appendChild(target);
});

afterEach(() => {
	app?.unmount();
	app = null;
	target.remove();
});

describe('WorkBlock while the run works', () => {
	it('is open at first: the bar reads how long it has worked and every step is shown', () => {
		const { conv, feed } = runningRun();
		readCall(conv, feed, 'tc-1', 'Read');
		conv.apply(feed.next({ type: 'tool_started', tool_call_id: 'tc-2', name: 'Grep', input: { pattern: 'x' } }));
		show(conv);
		expect(text()).toMatch(/Travaille depuis \d/);
		expect(expanded()).toBe('true');
		// Open, the steps are in their own lines: the current step is not repeated on the bar.
		expect(text()).not.toContain('Grep');
		expect(text()).toContain('A lu a.ts');
		expect(text()).toContain('Cherche x');
	});

	it('folded by its arrow, the bar names the current step and hides the others', () => {
		const { conv, feed } = runningRun();
		readCall(conv, feed, 'tc-1', 'Read');
		conv.apply(feed.next({ type: 'tool_started', tool_call_id: 'tc-2', name: 'Grep', input: { pattern: 'x' } }));
		show(conv);
		toggle();
		expect(expanded()).toBe('false');
		expect(text()).toMatch(/Travaille depuis \d/);
		expect(text()).toContain('Grep');
		expect(text()).not.toContain('A lu a.ts');
	});

	it('an empty run has no arrow to fold: its bar is the status alone', () => {
		const { conv } = runningRun();
		show(conv);
		expect(trigger()).toBeNull();
		expect(text()).toMatch(/^Travaille depuis \d+[jhms]/);
	});

	it('a pending approval stays visible when the bar is folded, and goes once it is decided', () => {
		const { conv, feed } = runningRun();
		readCall(conv, feed, 'tc-1', 'Read');
		conv.apply(feed.next({ type: 'approval_requested', approval: APPROVAL }, { at: T0 + 1_000 }));
		show(conv);
		expect(expanded()).toBe('true');
		toggle();
		expect(expanded()).toBe('false');
		expect(text()).toContain('Lancer les tests');
		// The steps stay folded: the finished call is not on screen.
		expect(text()).not.toContain('A lu a.ts');

		sync(conv, () => {
			conv.apply(
				feed.next({ type: 'approval_resolved', approval_id: 'ap-1', tool_call_id: 'tc-9', decision: 'allow', by: 'user' }),
			);
		});
		expect(text()).not.toContain('Lancer les tests');
	});
});

describe('WorkBlock once the run has ended', () => {
	it('reads how long it worked and folds by itself', () => {
		const { conv, feed } = runningRun();
		readCall(conv, feed, 'tc-1', 'Read');
		show(conv);
		expect(expanded()).toBe('true');

		sync(conv, () => {
			conv.apply(feed.next({ type: 'run_finished', outcome: 'succeeded', text: '', turns: 1 }, { at: T0 + 6_000 }));
		});
		expect(text()).toBe('A travaillé 6s');
		expect(expanded()).toBe('false');
	});

	it.each([
		['failed', 'Échec après 6s'],
		['incomplete', 'Incomplet après 6s'],
		['cancelled', 'Annulé après 6s'],
	] as const)('a run that ended as %s says « %s »', (outcome, label) => {
		const { conv, feed } = runningRun();
		readCall(conv, feed, 'tc-1', 'Bash');
		conv.apply(feed.next({ type: 'run_finished', outcome, text: '', turns: 1 }, { at: T0 + 6_000 }));
		show(conv);
		expect(text()).toBe(label);
	});
});

describe('WorkBlock with showPlan', () => {
	it('places the compact step count beside the worked bar and opens the Trace popover on click', () => {
		const { conv, feed } = runningRun();
		readCall(conv, feed, 'tc-1', 'Read');
		conv.apply(
			feed.next({
				type: 'plan_updated',
				plan: {
					version: 1,
					revision: 1,
					updated_at: T0 + 1,
					explanation: 'Étape par étape.',
					todos: [
						{ content: 'Installer @base-ui/react', activeForm: 'Installation en cours', status: 'completed' },
						{ content: 'Remplacer Radix', activeForm: 'Remplacement des imports Radix', status: 'in_progress' },
						{ content: 'Vérifier les types', activeForm: 'Vérification des types', status: 'pending' },
					],
				},
			}),
		);
		conv.apply(feed.next({ type: 'run_finished', outcome: 'succeeded', text: '', turns: 1 }, { at: T0 + 21_000 }));

		show(conv, true);
		expect(text()).toContain('A travaillé 21s');
		expect(text()).toContain('1/3 étapes');

		const planTrigger = target.querySelector<HTMLButtonElement>('[data-slot="work-plan-trigger"]');
		expect(planTrigger).not.toBeNull();
		expect(document.querySelector('[data-slot="work-plan-popover"]')).toBeNull();

		flushReact(() => {
			planTrigger!.click();
		});

		const popover = document.querySelector<HTMLElement>('[data-slot="work-plan-popover"]');
		expect(popover).not.toBeNull();
		expect(popover!.textContent).toContain('1 sur 3 faites');
		expect(popover!.textContent).toContain('Installer @base-ui/react');
		expect(popover!.textContent).toContain('Remplacement des imports Radix');
		expect(popover!.textContent).toContain('Vérifier les types');
		expect(popover!.textContent).toContain('Étape par étape.');
	});
});
