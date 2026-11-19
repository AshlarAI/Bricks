<script lang="ts">
  import { t } from '$lib/i18n/i18n.svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import * as Trace from '$lib/components/ui/trace'
  import { formatWorked } from '../runend'
  import type { AssistantItem, Conversation } from '$lib/state/conversation.svelte'
  import { webSearchSources } from '../markdown/citations'
  import { ui } from '$lib/state/ui.svelte'
  import { throttledValue } from '../throttled.svelte'
  import { isAbsoluteFilePath } from '../markdown/fileref-parse'
  import type { FileReference } from '../markdown/types'
  import MarkdownView from '../markdown/MarkdownView.svelte'

  /**
   * `reasoning`: only the reasoning, among the steps of the run; `answer`: only
   * the text, when it is the run's answer (its reasoning stays with the steps).
   */
  type Part = 'all' | 'reasoning' | 'answer'

  let {
    item,
    conversation,
    part = 'all',
  }: { item: AssistantItem; conversation?: Conversation; part?: Part } = $props()

  /** What the conversation's web searches returned: the cards of the reply's links show it. */
  const sources = $derived(
    webSearchSources(
      (conversation?.items ?? []).flatMap((i) => (i.kind === 'tool' && i.name === 'WebSearch' && i.output ? [i.output] : [])),
    ),
  )

  /** The person's own choice; until then the reasoning is open while it streams. */
  let reasoningOpen = $state<boolean | undefined>(undefined)
  /** Error of the last link or file reference that could not be opened; cleared by the next successful open. */
  let linkError = $state<string | null>(null)
  // The source is followed at most every 80 ms while the answer streams; the
  // final text is reconciled as soon as the message completes.
  const throttled = throttledValue(
    () => item.text,
    () => item.streaming,
    80,
  )

  // The length in front makes the prefixes of two messages never prefixes of
  // each other, so their heading and note ids cannot collide.
  // svelte-ignore state_referenced_locally
  const safeId = item.id.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  const idPrefix = `m${safeId.length}-${safeId}`

  const hasReasoning = $derived(part !== 'answer' && item.thinking.trim().length > 0)
  const hasText = $derived(part !== 'reasoning')
  /** The model is still reasoning: the message streams and no answer text has come yet. */
  const thinkingNow = $derived(item.streaming && item.text.trim().length === 0)
  /** « Réfléchit » while it lasts, then « A réfléchi pendant 5s » when it was followed live. */
  const thinkingLabel = $derived.by(() => {
    if (thinkingNow) return t('conversation.thinking')
    const lasted = item.thinkingMs !== undefined ? formatWorked(Math.max(1000, item.thinkingMs)) : null
    return lasted ? t('conversation.thoughtFor', { value: lasted }) : t('conversation.thought')
  })

  function openFile(ref: FileReference) {
    const projectId = conversation?.projectId
    if (!projectId && !isAbsoluteFilePath(ref.path)) {
      linkError = t('conversation.thisConversationIsntAttachedToAny')
      return
    }
    linkError = null
    ui.open('file', {
      projectId: projectId ?? '',
      path: ref.path,
      line: ref.line !== undefined ? String(ref.line) : undefined,
      endLine: ref.endLine !== undefined ? String(ref.endLine) : undefined,
    })
  }

  function jumpTo(id: string) {
    const target = document.getElementById(id)
    if (!target) return
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1')
    target.scrollIntoView({ block: 'start' })
    target.focus({ preventScroll: true })
  }
</script>

<article class="flex min-w-0 flex-col gap-1.5" aria-busy={item.streaming}>
  {#if hasReasoning}
    <Trace.Root>
      <!-- Open while the model reasons, folded once it answers; the person's own toggle wins. -->
      <Trace.Collapsible bind:open={() => reasoningOpen ?? thinkingNow, (value) => (reasoningOpen = value)}>
        <Trace.CollapsibleTrigger>
          <Trace.Line status={thinkingNow ? 'running' : undefined}>
            <Trace.Title>{thinkingLabel}</Trace.Title>
          </Trace.Line>
        </Trace.CollapsibleTrigger>
        <Trace.CollapsibleContent class="text-xs whitespace-pre-wrap">{item.thinking}</Trace.CollapsibleContent>
      </Trace.Collapsible>
    </Trace.Root>
  {/if}

  {#if !hasText}
    <!-- The answer's text follows the steps. -->
  {:else if item.text}
    <MarkdownView
      source={item.streaming ? throttled.value : item.text}
      streaming={item.streaming}
      {idPrefix}
      onFile={openFile}
      onLinkResult={(error) => (linkError = error)}
      {sources}
    />
    {#if linkError}
      <p class="text-xs break-words text-destructive" role="alert">
        {t('conversation.theLinkCouldNotBeOpened', { linkError })}
      </p>
    {/if}
  {/if}
</article>
