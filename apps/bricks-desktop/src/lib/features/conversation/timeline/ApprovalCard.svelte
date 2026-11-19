<script lang="ts">
  // A permission request: a card with Allow and Refuse while it waits, a shimmering line while the
  // decision travels, then one trace line with the decision.
  import { t } from '$lib/i18n/i18n.svelte'
  import ChevronDown from '@lucide/svelte/icons/chevron-down'
  import ShieldCheck from '@lucide/svelte/icons/shield-check'
  import ShieldX from '@lucide/svelte/icons/shield-x'
  import { Button } from '$lib/components/ui/button'
  import * as Item from '$lib/components/ui/item'
  import * as Trace from '$lib/components/ui/trace'
  import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
  import DiffStat from '$lib/layout/DiffStat.svelte'
  import { app } from '$lib/state/app.svelte'
  import type { Conversation } from '$lib/state/conversation.svelte'
  import type { ApprovalRequest, Command, DecidedBy, Decision } from '$lib/ipc/engine'
  import { CHANGE_KIND_LABEL, formatToolName, prettyJson, summarizeInput } from '../format'
  import MonoBlock from './MonoBlock.svelte'
  import { approvalTrace } from './toolLine'
  import { toolIcon } from './toolIcons'

  interface Props {
    approval: ApprovalRequest
    resolved?: { decision: Decision; by: DecidedBy }
    conversation: Conversation
  }

  let { approval, resolved, conversation }: Props = $props()

  /** Decision being sent; kept until the engine confirms with approval_resolved. */
  let sending = $state<Decision | null>(null)
  let refusal = $state<string | null>(null)

  const agentName = $derived.by(() => {
    if (!approval.agent_id) return null
    const agent = conversation.agents.get(approval.agent_id)
    return agent ? agent.spawn.profile : t('conversation.unknownAgent', { value: approval.agent_id.slice(0, 8) })
  })
  const displayTool = $derived(formatToolName(approval.tool))
  const inputSummary = $derived(summarizeInput(approval.tool, approval.input))
  const inputText = $derived(prettyJson(approval.input))
  const ToolIcon = $derived(toolIcon(approval.tool))

  async function decide(decision: Decision) {
    if (sending !== null || resolved) return
    sending = decision
    refusal = null
    const message: string | null = await app.command(conversation.sessionId, {
      type: 'approve',
      approval_id: approval.approval_id,
      decision,
    } satisfies Command)
    if (message) {
      refusal = message
      sending = null
    }
  }
</script>

{#if resolved}
  <Trace.Root>
    <Trace.Line status={resolved.decision === 'deny' ? 'error' : undefined}>
      <Trace.Icon>
        {#if resolved.decision === 'deny'}
          <ShieldX />
        {:else}
          <ShieldCheck class="text-success" />
        {/if}
      </Trace.Icon>
      <Trace.Title class="break-words">{approvalTrace(approval.tool, resolved)}</Trace.Title>
    </Trace.Line>
  </Trace.Root>
{:else if sending !== null && refusal === null}
  <Trace.Root>
    <Trace.Line status="running" role="status">
      <Trace.Icon><ToolIcon /></Trace.Icon>
      <Trace.Title>{t('conversation.decisionSent')}</Trace.Title>
    </Trace.Line>
  </Trace.Root>
{:else}
  <!-- A pending request is a prompt, not activity: it sits outside Trace. -->
  <Item.Root variant="outline" size="sm" aria-label={t('conversation.approvalRequested2')} class="border-warning/40 bg-card">
    <Item.Media variant="icon" class="text-warning">
      <ToolIcon />
    </Item.Media>
    <Item.Content class="min-w-0">
      <p class="text-caption font-medium text-warning">{t('conversation.approvalRequested2')}</p>
      <Item.Title class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span class="font-mono" title={displayTool !== approval.tool ? approval.tool : undefined}>{displayTool}</span>
        {#if inputSummary}
          <span class="min-w-0 font-mono text-xs font-normal break-all text-muted-foreground">{inputSummary}</span>
        {/if}
      </Item.Title>
      <Item.Description class="line-clamp-none break-words">{approval.description}</Item.Description>
      <p class="text-xs text-muted-foreground">
        {t('conversation.level', { level: approval.level })}{#if agentName}<span> · {t('conversation.agent', { agentName })}</span>{/if}
      </p>
    </Item.Content>
    <Item.Actions>
      <Button size="sm" variant="outline" onclick={() => decide('deny')}>{t('common.refuse')}</Button>
      <Button size="sm" onclick={() => decide('allow')}>{t('common.allow')}</Button>
    </Item.Actions>
    <Item.Footer class="flex-col items-stretch gap-2">
      <Collapsible>
        <CollapsibleTrigger
          class="group inline-flex w-fit items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronDown class="size-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />
          {t('conversation.fullInput')}
        </CollapsibleTrigger>
        <CollapsibleContent class="mt-1.5">
          <MonoBlock text={inputText} label={t('conversation.fullInputOf', { tool: displayTool })} />
        </CollapsibleContent>
      </Collapsible>

      {#if approval.preview}
        {#if approval.preview.refusal}
          <p class="text-xs break-words text-destructive">{approval.preview.refusal}</p>
        {/if}
        {#if approval.preview.files.length > 0}
          <ul class="flex flex-col gap-2 border-t border-border pt-2.5" aria-label={t('conversation.filesInvolved')}>
            {#each approval.preview.files as file (file.absolute)}
              <li class="flex flex-col gap-1.5">
                <Collapsible>
                  <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    <span class="text-muted-foreground">{CHANGE_KIND_LABEL[file.kind]}</span>
                    <span class="min-w-0 font-mono break-all">{file.path}</span>
                    <DiffStat additions={file.added} deletions={file.removed} label={t('common.lines')} />
                    {#if file.diff}
                      <CollapsibleTrigger
                        aria-label={t('conversation.viewTheDiffOf', { path: file.path })}
                        class="rounded-sm px-1 text-brand underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                      >
                        {t('conversation.viewTheDiff')}
                      </CollapsibleTrigger>
                    {/if}
                  </div>
                  {#if file.diff}
                    <CollapsibleContent class="mt-1.5">
                      <MonoBlock text={file.diff} label={t('conversation.diffOf', { path: file.path })} diff maxLines={Number.POSITIVE_INFINITY} />
                    </CollapsibleContent>
                  {/if}
                </Collapsible>
              </li>
            {/each}
          </ul>
        {/if}
      {/if}

      {#if refusal}
        <p class="text-xs break-words text-destructive" role="alert">{refusal}</p>
      {/if}
    </Item.Footer>
  </Item.Root>
{/if}
