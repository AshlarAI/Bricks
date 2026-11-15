<script lang="ts">
  import type { Conversation, ToolItem, EditItem, QuestionItem } from '$lib/state/conversation.svelte'
  import { summarizeInput } from '../format'
  import EditRow from './EditRow.svelte'
  import ToolImage from './ToolImage.svelte'
  import ToolLine from './ToolLine.svelte'
  import { toolLineState } from './toolLine'

  let { item, conversation }: { item: ToolItem; conversation: Conversation } = $props()

  /** The run that made the call was cancelled: its unfinished calls are interruptions. */
  const interrupted = $derived(conversation.run(item.runId)?.outcome === 'cancelled')
  const edits = $derived(conversation.items.filter((entry): entry is EditItem =>
    entry.kind === 'edit' && entry.toolCallId === item.toolCallId && entry.runId === item.runId && !entry.agentId
  ))
  /** The questions of an `Ask` call: once all are closed, the line counts the answers. */
  const questions = $derived(
    item.name === 'Ask'
      ? conversation.items.filter(
          (entry): entry is QuestionItem =>
            entry.kind === 'question' && entry.question.tool_call_id === item.toolCallId,
        )
      : [],
  )
  const closed = $derived(questions.length > 0 && questions.every((q) => q.outcome))
  const answered = $derived(
    questions.filter((q) => q.outcome?.state === 'chosen' || q.outcome?.state === 'other').length,
  )
  /** A question closed by a cancelled run: the call failed. */
  const cancelled = $derived(
    questions.some((q) => q.outcome?.state === 'skipped' && q.outcome.reason === 'cancelled'),
  )
  const state = $derived(cancelled ? 'failed' : toolLineState(item, interrupted))
  // An image the call showed the model: `Read` of an image (its result names it, after the
  // report header a reopened history keeps), `ViewImage` in former conversations, or an MCP
  // tool result whose rendered text includes `[image image/<type>, <bytes> bytes]`.
  const READ_IMAGE = /^(?:[^\n]*\[Read\][^\n]*\n)?Image .+: image\/(?:png|jpeg|gif|webp)/
  const MCP_IMAGE = /\[image image\/(?:png|jpeg|gif|webp), \d+ bytes\]/
  const showsImage = $derived(
    item.status === 'ok' &&
      (item.name === 'ViewImage' ||
        (item.name === 'Read' && READ_IMAGE.test(item.output ?? '')) ||
        (item.name.startsWith('mcp__') && MCP_IMAGE.test(item.output ?? ''))),
  )
  const computerUseHint = $derived(
    item.name.startsWith('mcp__computer-use__') ? summarizeInput(item.name, item.input) : '',
  )
</script>

<ToolLine name={item.name} {state} durationMs={item.durationMs}>
  {#if computerUseHint}
    <span class="min-w-0 truncate text-muted-foreground">{computerUseHint}</span>
  {/if}
  {#if closed}
    <span class="shrink-0 tabular-nums">{answered}/{questions.length}</span>
  {/if}
  {#each edits as edit (edit.id)}
    <EditRow item={edit} {conversation} inline />
  {/each}
</ToolLine>
{#if showsImage}
  <ToolImage {item} {conversation} />
{/if}
