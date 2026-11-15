<script lang="ts">
  // A question of `Ask`: its choices, « Autre » for a free answer, « Passer » and
  // « Envoyer » (⌘↩). With a timer, the time left comes from the engine's deadline,
  // so a reload or a switch of conversation never restarts it; the engine closes
  // the question at expiry. A closed question shows nothing here: its `Ask` line
  // counts the answers. Once an answer is accepted, the card gives way to a shimmering line
  // until the engine closes the question.
  import { t } from '$lib/i18n/i18n.svelte'
  import MessageCircleQuestion from '@lucide/svelte/icons/message-circle-question-mark'
  import { Button } from '$lib/components/ui/button'
  import * as Item from '$lib/components/ui/item'
  import * as Trace from '$lib/components/ui/trace'
  import { Input } from '$lib/components/ui/input'
  import type { QuestionAnswer, QuestionRequest } from '$lib/ipc/engine'
  import type { Conversation } from '$lib/state/conversation.svelte'
  import { app } from '$lib/state/app.svelte'
  import { createClock } from '$lib/features/navigation/clock.svelte'
  import { cn } from '$lib/utils'

  let { question, conversation }: { question: QuestionRequest; conversation: Conversation } = $props()

  const uid = $props.id()
  /** « Autre »: the index after the options. */
  const OTHER = $derived(question.options.length)

  /** The choice made, the recommended option until the person picks one. */
  let selected = $derived<number | null>(question.recommended ?? null)
  let other = $state('')
  let sending = $state(false)
  let refusal = $state<string | null>(null)

  const clock = createClock(1000)
  /** Whole seconds left, `null` without a timer. */
  const left = $derived(
    question.deadline_at === undefined
      ? null
      : Math.max(0, Math.ceil((question.deadline_at - clock.now) / 1000)),
  )
  const leftText = $derived(
    left === null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`,
  )

  const canSend = $derived(
    !sending && selected !== null && (selected !== OTHER || other.trim() !== ''),
  )

  async function answer(a: QuestionAnswer) {
    if (sending) return
    sending = true
    refusal = await app.answerQuestion(conversation, question.question_id, a)
    // Accepted: the line stays until the engine closes the question.
    if (refusal) sending = false
  }

  function send() {
    if (!canSend || selected === null) return
    void answer(selected === OTHER ? { kind: 'other', text: other.trim() } : { kind: 'choice', choice: selected })
  }

  function onKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.isComposing) {
      event.preventDefault()
      send()
    }
  }

</script>

{#if sending}
  <Trace.Root>
    <Trace.Line status="running" role="status">
      <Trace.Icon><MessageCircleQuestion /></Trace.Icon>
      <Trace.Title>{t('conversation.answerSent')}</Trace.Title>
    </Trace.Line>
  </Trace.Root>
{:else}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    aria-labelledby={`${uid}-q`}
    class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
    onkeydown={onKeydown}
  >
    <Item.Root size="sm" class="rounded-none border-0 border-b border-border bg-muted/40 px-4 py-3">
      <Item.Media variant="icon" class="text-warning">
        <MessageCircleQuestion />
      </Item.Media>
      <Item.Content class="min-w-0">
        <Item.Description class="text-caption font-medium text-warning">{t('conversation.needsYourInput')}</Item.Description>
        <Item.Title>
          <h2 id={`${uid}-q`} class="text-ui font-medium break-words">{question.question}</h2>
        </Item.Title>
      </Item.Content>
      {#if left !== null}
        <Item.Actions
          class={cn(
            'self-start font-mono text-caption tabular-nums',
            left < 10 ? 'text-destructive' : left < 30 ? 'text-warning' : 'text-muted-foreground',
          )}
          aria-label={t('conversation.timeLeft', { leftText })}
        >
          {leftText}
        </Item.Actions>
      {/if}
    </Item.Root>

    <fieldset class="m-0 border-0 p-0">
      <legend class="sr-only">{question.question}</legend>
      {#each [...question.options, { label: t('common.other'), description: undefined }] as option, index (index)}
        <label
          class={cn(
            'flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-element-hover',
            index > 0 && 'border-t border-border',
          )}
        >
          <input
            type="radio"
            name={`${uid}-choice`}
            value={index}
            class="mt-0.5 size-4 shrink-0 accent-primary"
            checked={selected === index}
            onchange={() => (selected = index)}
          />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="text-ui break-words">
              {option.label}{#if index === question.recommended}<span class="ml-1 text-muted-foreground">{t('conversation.recommended')}</span>{/if}
            </span>
            {#if option.description}
              <span class="text-caption break-words text-muted-foreground">{option.description}</span>
            {/if}
          </span>
        </label>
      {/each}
      {#if selected === OTHER}
        <div class="px-4 pb-3 pl-11">
          <Input bind:value={other} aria-label={t('conversation.yourAnswer')} class="h-8 text-ui" />
        </div>
      {/if}
    </fieldset>

    <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
      {#if refusal}
        <p class="mr-auto text-caption break-words text-destructive" role="alert">{refusal}</p>
      {/if}
      <Button size="sm" variant="secondary" disabled={sending} onclick={() => answer({ kind: 'skip' })}>
        {t('conversation.skip')}
      </Button>
      <Button size="sm" disabled={!canSend} onclick={send}>{t('common.send')}</Button>
    </footer>
  </section>
{/if}
