// Each conversation shows its own work: a sub-agent's edits and skill failures go to its branch,
// never to the main thread; the run still counts its files. Hand-built envelopes, no rendering.
import { describe, expect, it } from 'vitest';
import { Conversation } from '../../src/lib/state/conversation';
import { agentBranch, applyAgentSteps } from '../../src/lib/features/agents/branch';
import { EnvelopeFeed, MODEL, PROJECT_ID, T0, openedSession, spawnInfo } from './fixtures';

const RUN = 'run-1';
const AGENT = 'ag-1';
const FILE = { path: 'src/a.ts', absolute: '/w/src/a.ts', added: 4, removed: 1, kind: 'modify' as const };

function parentWithAgent() {
	const conv = new Conversation(openedSession(), PROJECT_ID);
	const feed = new EnvelopeFeed({ runId: RUN });
	conv.apply(feed.next({ type: 'run_started', prompt: 'Corrige', attachments: [], model: MODEL }, { at: T0 }));
	conv.apply(feed.next({ type: 'tool_started', tool_call_id: 'tc-A', name: 'Agent', input: {} }));
	conv.apply(feed.next({ type: 'agent_spawned', agent: spawnInfo({ agent_id: AGENT, tool_call_id: 'tc-A' }) }, { at: T0 + 100 }));
	return { conv, feed, agent: conv.agents.get(AGENT)! };
}

function subAgentEdit(conv: Conversation, feed: EnvelopeFeed) {
	conv.apply(feed.next({ type: 'agent_tool_started', agent_id: AGENT, tool_call_id: 'tc-1', name: 'Edit', input: { file_path: 'src/a.ts' } }));
	conv.apply(
		feed.next({ type: 'agent_tool_finished', agent_id: AGENT, tool_call_id: 'tc-1', name: 'Edit', is_error: false, duration_ms: 5, executed: true, status: 'success', output: '', output_truncated: false }),
	);
	conv.apply(feed.next({ type: 'edit_applied', tool_call_id: 'tc-1', tool: 'Edit', files: [FILE], agent_id: AGENT }));
}

describe('a sub-agent edit', () => {
	it('stays out of the main thread and goes to the agent log, with its agent', () => {
		const { conv, feed } = parentWithAgent();
		subAgentEdit(conv, feed);
		const agent = conv.agents.get(AGENT)!;

		expect(conv.items.some((item) => item.kind === 'edit')).toBe(false);
		const logged = agent.log.find((step) => step.event.type === 'edit_applied');
		expect(logged?.event).toMatchObject({ type: 'edit_applied', tool_call_id: 'tc-1', agent_id: AGENT, files: [FILE] });
	});

	it('still counts in the files of the run', () => {
		const { conv, feed } = parentWithAgent();
		subAgentEdit(conv, feed);

		const files = conv.run(RUN)?.fileSummaries ?? [];
		expect(files).toEqual([expect.objectContaining({ path: 'src/a.ts', added: 4, removed: 1, agentIds: [AGENT] })]);
	});

	it('is shown in the branch with its own tool call, as the branch agent own edit', () => {
		const { conv, feed } = parentWithAgent();
		subAgentEdit(conv, feed);
		const agent = conv.agents.get(AGENT)!;

		const branch = agentBranch(conv, agent);
		expect(branch.ownAgentId).toBe(AGENT);
		const tool = branch.items.find((item) => item.kind === 'tool' && item.toolCallId === 'tc-1');
		const edit = branch.items.find((item) => item.kind === 'edit');
		expect(edit).toMatchObject({ toolCallId: 'tc-1', agentId: AGENT, runId: tool && 'runId' in tool ? tool.runId : 'missing' });
	});

	it('arrives in an open branch as it is applied', () => {
		const { conv, feed, agent } = parentWithAgent();
		const branch = agentBranch(conv, agent);
		const before = agent.log.length;
		subAgentEdit(conv, feed);
		applyAgentSteps(branch, conv.agents.get(AGENT)!, before);

		expect(branch.items.filter((item) => item.kind === 'edit')).toHaveLength(1);
	});

	it('from an unknown agent stays in the main thread, so nothing is lost', () => {
		const { conv, feed } = parentWithAgent();
		conv.apply(feed.next({ type: 'edit_applied', tool_call_id: 'tc-9', tool: 'Edit', files: [FILE], agent_id: 'ag-unknown' }));

		expect(conv.items.filter((item) => item.kind === 'edit')).toHaveLength(1);
	});

	it('of the main agent stays in the main thread', () => {
		const { conv, feed } = parentWithAgent();
		conv.apply(feed.next({ type: 'tool_started', tool_call_id: 'tc-M', name: 'Edit', input: { file_path: 'src/a.ts' } }));
		conv.apply(feed.next({ type: 'edit_applied', tool_call_id: 'tc-M', tool: 'Edit', files: [FILE] }));

		expect(conv.ownAgentId).toBeNull();
		expect(conv.items.filter((item) => item.kind === 'edit')).toEqual([expect.objectContaining({ toolCallId: 'tc-M' })]);
	});
});

describe('a sub-agent skill failure', () => {
	it('is told in its branch, not in the main thread', () => {
		const { conv, feed } = parentWithAgent();
		conv.apply(feed.next({ type: 'skill_activation_failed', agent_id: AGENT, name: 'deploy', reason: 'absent' }));

		expect(conv.items.some((item) => item.kind === 'notice')).toBe(false);
		expect(conv.lastSkill).toBeNull();
		const branch = agentBranch(conv, conv.agents.get(AGENT)!);
		expect(branch.items.some((item) => item.kind === 'notice')).toBe(true);
	});
});
