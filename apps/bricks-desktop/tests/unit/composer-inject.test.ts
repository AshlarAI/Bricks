// @vitest-environment happy-dom
// Mid-run user steering (`Command::Inject`, `Event::MessageInjected`, `SCHEMA_VERSION = 10`):
// protocol contract, `Conversation.inject`, `apply` / `replay` / `userIndexOf` / `timelineBlocks`,
// `composerSendState`, and mounted `Composer` UI behaviour while a run is active.
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushReact, mountReact, tickReact, type MountedComponent } from './react-test-utils';
import { TooltipProvider } from '../../src/lib/components/ui/tooltip';
import Composer, { composerSendState } from '../../src/lib/features/composer/Composer';
import { timelineBlocks, turnWindow } from '../../src/lib/features/conversation/runBlocks';
import UserMessage from '../../src/lib/features/conversation/timeline/UserMessage';
import { setLanguage, t } from '../../src/lib/i18n/i18n';
import {
	SCHEMA_VERSION,
	type Command,
	type Event as EngineEvent,
	type ModelChoice,
} from '../../src/lib/ipc/engine';
import { app } from '../../src/lib/state/app';
import { Conversation, type AssistantItem, type UserItem } from '../../src/lib/state/conversation';
import { EnvelopeFeed, MODEL, PROJECT_ID, SESSION_ID, T0, openedSession, snapshot } from './fixtures';

const ipc = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => {
	class Channel {
		onmessage: ((event: unknown) => void) | null = null;
	}
	return { Channel, invoke: (cmd: string, args?: unknown) => ipc.invoke(cmd, args) };
});
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn() }));

const RUN_1 = 'run-inject-1';

function startedConversation(): { conv: Conversation; feed: EnvelopeFeed } {
	const conv = new Conversation(openedSession(), PROJECT_ID);
	const feed = new EnvelopeFeed({ runId: RUN_1 });
	conv.apply(feed.next({ type: 'run_started', prompt: 'Start work', attachments: [], model: MODEL }, { at: T0 }));
	return { conv, feed };
}

function setupComposerApp(conv: Conversation) {
	app.projects = [
		{
			id: PROJECT_ID,
			name: 'Demo',
			path: '/work/demo',
			added_at: T0,
			last_opened_at: T0,
			missing: false,
			chats: false,
		},
	];
	app.currentProjectId = PROJECT_ID;
	app.models = [
		{
			selection: MODEL,
			name: 'Claude Test',
			provider: 'anthropic',
			profiles: [],
			default_profile: null,
			max_input_tokens: 180_000,
			input: ['text'],
			priced: false,
		} satisfies ModelChoice,
	];
	app.conversations.clear();
	app.conversations.set(conv.sessionId, conv);
	app.currentSessionId = conv.sessionId;
}

function mountComposer(conv: Conversation | null) {
	const target = document.createElement('div');
	document.body.appendChild(target);
	const Wrapper = ({ conversation }: { conversation: Conversation | null }) =>
		createElement(TooltipProvider, null, createElement(Composer, { conversation }));
	const mounted = mountReact(Wrapper, { target, props: { conversation: conv } });
	return { target, mounted };
}

describe('protocol schema for mid-run steering', () => {
	it('uses SCHEMA_VERSION 10 and supports inject command and message_injected event', () => {
		expect(SCHEMA_VERSION).toBe(10);
		const cmd: Command = { type: 'inject', text: 'Focus on unit tests' };
		const event: EngineEvent = { type: 'message_injected', text: 'Focus on unit tests' };
		expect(cmd).toEqual({ type: 'inject', text: 'Focus on unit tests' });
		expect(event).toEqual({ type: 'message_injected', text: 'Focus on unit tests' });
	});
});

describe('Conversation.inject and message_injected handling', () => {
	beforeEach(() => {
		ipc.invoke.mockReset();
		ipc.invoke.mockResolvedValue(undefined);
	});

	it('sends Command::Inject with trimmed text and skips blank strings', async () => {
		const { conv } = startedConversation();

		await conv.inject('   ');
		expect(ipc.invoke).not.toHaveBeenCalled();

		await conv.inject('  Check edge cases  ');
		expect(ipc.invoke).toHaveBeenCalledTimes(1);
		expect(ipc.invoke).toHaveBeenCalledWith('session_command', {
			sessionId: SESSION_ID,
			command: { type: 'inject', text: 'Check edge cases' },
			display: null,
		});
	});

	it('propagates IPC errors from session_command', async () => {
		const { conv } = startedConversation();
		ipc.invoke.mockRejectedValueOnce(new Error('transport failure'));
		await expect(conv.inject('Steer')).rejects.toThrow('transport failure');
	});

	it('appends message_injected as a steered UserItem and closes any streaming assistant item', () => {
		const { conv, feed } = startedConversation();
		conv.apply(feed.next({ type: 'text_delta', text: 'Working on step 1...' }));
		conv.apply(feed.next({ type: 'command_rejected', command: 'inject', reason: 'too fast' }, { runId: null }));
		expect(conv.lastRejection?.command).toBe('inject');

		conv.apply(feed.next({ type: 'message_injected', text: 'Skip step 2' }));

		expect(conv.lastRejection).toBeNull();
		expect(conv.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'user']);
		const assistant = conv.items[1] as AssistantItem;
		expect(assistant.streaming).toBe(false);
		const steered = conv.items[2] as UserItem;
		expect(steered).toMatchObject({
			kind: 'user',
			runId: RUN_1,
			text: 'Skip step 2',
			attachments: [],
			steered: true,
		});
	});

	it('keeps timelineBlocks segmented around steered messages and turnWindow intact without breaking revise user_index assumptions', async () => {
		const { conv, feed } = startedConversation();
		conv.apply(feed.next({ type: 'tool_started', tool_call_id: 'tc-1', name: 'Read', input: { file_path: 'a.ts' } }));
		conv.apply(feed.next({ type: 'tool_finished', tool_call_id: 'tc-1', name: 'Read', is_error: false, duration_ms: 5, output: 'ok' }));
		conv.apply(feed.next({ type: 'message_injected', text: 'Only fix tests' }));
		conv.apply(feed.next({ type: 'tool_started', tool_call_id: 'tc-2', name: 'Bash', input: { command: 'npm test' } }));
		conv.apply(feed.next({ type: 'tool_finished', tool_call_id: 'tc-2', name: 'Bash', is_error: false, duration_ms: 9, output: 'pass' }));
		conv.apply(feed.next({ type: 'text_delta', text: 'Done.' }));
		conv.apply(feed.next({ type: 'run_finished', outcome: 'succeeded', text: 'Done.', turns: 2 }));

		const blocks = timelineBlocks(conv.items, conv.items, conv.runs, conv.runningRunId);
		expect(blocks.map((b) => (b.kind === 'work' ? `work:${b.items.length}` : b.answer ? 'answer' : b.item.kind))).toEqual([
			'user',
			'work:1',
			'user',
			'work:1',
			'answer',
			'run_end',
		]);
		const preSteerWork = blocks[1];
		const postSteerWork = blocks[3];
		if (preSteerWork.kind !== 'work' || postSteerWork.kind !== 'work') throw new Error('expected work blocks');
		expect(preSteerWork.items[0]).toMatchObject({ kind: 'tool', toolCallId: 'tc-1' });
		expect(postSteerWork.items[0]).toMatchObject({ kind: 'tool', toolCallId: 'tc-2' });

		// Slicing to the last 1 user turn backs up to the start of the run so its WorkBlock stays intact.
		const windowed = turnWindow(conv.items, 1);
		expect(windowed.startIndex).toBe(0);
		expect(windowed.totalTurns).toBe(2);

		// A live steered message never queries sessionRunUserIndex for the parent run's user_index.
		const steered = conv.items[2] as UserItem;
		expect(await conv.userIndexOf(steered)).toBeNull();
		expect(ipc.invoke).not.toHaveBeenCalled();

		// A non-steered run prompt still resolves via session_run_user_index.
		ipc.invoke.mockResolvedValueOnce(0);
		const initial = conv.items[0] as UserItem;
		expect(await conv.userIndexOf(initial)).toBe(0);
		expect(ipc.invoke).toHaveBeenCalledWith('session_run_user_index', {
			sessionId: SESSION_ID,
			runId: RUN_1,
		});
	});

	it('does not duplicate injected messages when replaying an idle reopened session', () => {
		const feed = new EnvelopeFeed({ runId: RUN_1 });
		const conv = new Conversation(
			openedSession({
				snapshot: snapshot({ activity: { state: 'idle' } }),
				history: [
					{ role: 'user', attachments: [], blocks: [{ type: 'text', text: 'Start work' }] },
					{ role: 'user', attachments: [], blocks: [{ type: 'text', text: 'Steer mid-run' }] },
					{ role: 'assistant', attachments: [], blocks: [{ type: 'text', text: 'Finished' }] },
				],
				recent_events: [
					feed.next({ type: 'run_started', prompt: 'Start work', attachments: [], model: MODEL }, { at: T0 }),
					feed.next({ type: 'message_injected', text: 'Steer mid-run' }),
					feed.next({ type: 'text_delta', text: 'Finished' }),
					feed.next({ type: 'run_finished', outcome: 'succeeded', text: 'Finished', turns: 2 }),
				],
				last_seq: 0,
			}),
			PROJECT_ID,
		);

		const userTexts = conv.items.filter((i): i is UserItem => i.kind === 'user').map((u) => u.text);
		expect(userTexts).toEqual(['Start work', 'Steer mid-run']);
	});
});

describe('composerSendState: send-while-running rules', () => {
	const base = {
		editable: true,
		running: true,
		sending: false,
		saving: 0,
		importing: false,
		blocked: false,
		hasConversation: true,
		text: 'Focus on tests',
		attachmentCount: 0,
	};

	it('allows inject during a run only when all constraints pass', () => {
		expect(composerSendState(base)).toMatchObject({
			isSlashLine: false,
			canSend: false,
			canInject: true,
			slashReady: false,
		});
	});

	it('disallows inject when idle, non-editable, sending, saving, importing, blocked, no conversation, blank, with attachments, or on slash lines', () => {
		expect(composerSendState({ ...base, running: false }).canInject).toBe(false);
		expect(composerSendState({ ...base, editable: false }).canInject).toBe(false);
		expect(composerSendState({ ...base, sending: true }).canInject).toBe(false);
		expect(composerSendState({ ...base, saving: 1 }).canInject).toBe(false);
		expect(composerSendState({ ...base, importing: true }).canInject).toBe(false);
		expect(composerSendState({ ...base, blocked: true }).canInject).toBe(false);
		expect(composerSendState({ ...base, hasConversation: false }).canInject).toBe(false);
		expect(composerSendState({ ...base, text: '   ' }).canInject).toBe(false);
		expect(composerSendState({ ...base, attachmentCount: 1 }).canInject).toBe(false);
		expect(composerSendState({ ...base, text: '/compact' })).toMatchObject({
			isSlashLine: true,
			canInject: false,
			slashReady: true,
		});
	});
});

describe('Composer UI: mid-run steering and Stop button', () => {
	let mounted: MountedComponent<object> | null = null;
	let target: HTMLElement | null = null;

	beforeEach(() => {
		setLanguage('en');
		ipc.invoke.mockReset();
		ipc.invoke.mockImplementation((cmd: string) => {
			if (cmd === 'slash_commands') return Promise.resolve([]);
			return Promise.resolve(undefined);
		});
	});

	afterEach(() => {
		mounted?.unmount();
		mounted = null;
		target?.remove();
		target = null;
	});

	it('keeps Stop clickable beside the steering Send button and injects on click and Enter', async () => {
		const { conv } = startedConversation();
		setupComposerApp(conv);
		conv.setDraft({ text: '  Switch to Rust tests  ' });

		const rendered = mountComposer(conv);
		mounted = rendered.mounted;
		target = rendered.target;

		const steerBtn = target.querySelector<HTMLButtonElement>(
			`button[aria-label="${t('composer.sendSteeringMessage')}"]`,
		);
		const stopBtn = target.querySelector<HTMLButtonElement>(
			`button[aria-label="${t('composer.stopGenerating')}"]`,
		);
		expect(steerBtn).not.toBeNull();
		expect(stopBtn).not.toBeNull();
		expect(steerBtn?.disabled).toBe(false);
		expect(stopBtn?.disabled).toBe(false);

		flushReact(() => {
			steerBtn?.click();
		});
		await tickReact();

		expect(ipc.invoke).toHaveBeenCalledWith('session_command', {
			sessionId: SESSION_ID,
			command: { type: 'inject', text: 'Switch to Rust tests' },
			display: null,
		});
		expect(conv.draft.text).toBe('');

		// With empty text, steering button is disabled while Stop remains clickable.
		const steerBtnAfter = target.querySelector<HTMLButtonElement>(
			`button[aria-label="${t('composer.sendSteeringMessage')}"]`,
		);
		expect(steerBtnAfter?.disabled).toBe(true);

		// Pressing Enter with new text injects; Shift+Enter does not inject.
		flushReact(() => {
			conv.setDraft({ text: 'Steer via Enter' });
		});
		const textarea = target.querySelector('textarea');
		expect(textarea).not.toBeNull();

		flushReact(() => {
			textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true }));
		});
		await tickReact();
		expect(ipc.invoke).not.toHaveBeenCalledWith(
			'session_command',
			expect.objectContaining({ command: { type: 'inject', text: 'Steer via Enter' } }),
		);

		flushReact(() => {
			textarea?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		});
		await tickReact();
		expect(ipc.invoke).toHaveBeenCalledWith('session_command', {
			sessionId: SESSION_ID,
			command: { type: 'inject', text: 'Steer via Enter' },
			display: null,
		});
		expect(conv.draft.text).toBe('');

		// Clicking Stop still sends cancel.
		flushReact(() => {
			stopBtn?.click();
		});
		await tickReact();
		expect(ipc.invoke).toHaveBeenCalledWith('session_command', {
			sessionId: SESSION_ID,
			command: { type: 'cancel' },
			display: null,
		});
	});

	it('disables steering when attachments are present and displays inject rejections', () => {
		const { conv, feed } = startedConversation();
		setupComposerApp(conv);
		conv.setDraft({
			text: 'With attachment',
			attachments: [{ id: 'a1', kind: 'file', path: '/work/demo/a.txt', name: 'a.txt' }],
		});

		const rendered = mountComposer(conv);
		mounted = rendered.mounted;
		target = rendered.target;

		const steerBtn = target.querySelector<HTMLButtonElement>(
			`button[aria-label="${t('composer.sendSteeringMessage')}"]`,
		);
		expect(steerBtn?.disabled).toBe(true);

		flushReact(() => {
			conv.apply(feed.next({ type: 'command_rejected', command: 'inject', reason: 'queue is full' }, { runId: null }));
		});
		const banner = target.querySelector('[data-slot="chat-error-banner"]');
		expect(banner?.textContent).toContain(t('composer.steeringRefused'));
		expect(banner?.textContent).toContain('queue is full');
	});

	it('does not render an Edit button on a live steered UserMessage after the run finishes', () => {
		const { conv, feed } = startedConversation();
		conv.apply(feed.next({ type: 'message_injected', text: 'Steer now' }));
		conv.apply(feed.next({ type: 'run_finished', outcome: 'succeeded', text: 'Ok', turns: 2 }));

		const initial = conv.items.find((i): i is UserItem => i.kind === 'user' && !i.steered)!;
		const steered = conv.items.find((i): i is UserItem => i.kind === 'user' && !!i.steered)!;

		const container = document.createElement('div');
		document.body.appendChild(container);
		target = container;
		const Both = () =>
			createElement(
				'div',
				null,
				createElement(UserMessage, { item: initial, conversation: conv }),
				createElement(UserMessage, { item: steered, conversation: conv }),
			);
		mounted = mountReact(Both, { target: container });

		const editButtons = container.querySelectorAll(`button[aria-label="${t('conversation.editTheMessage')}"]`);
		expect(editButtons).toHaveLength(1);
	});
});
