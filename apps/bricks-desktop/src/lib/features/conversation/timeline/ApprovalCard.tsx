// A permission request: a card with Allow and Refuse while it waits, a shimmering line while the
// decision travels, then one trace line with the decision.
import { useState } from 'react'
import { ChevronDownIcon, ShieldCheckIcon, ShieldXIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemMedia,
  ItemTitle,
} from '$lib/components/ui/item'
import * as Trace from '$lib/components/ui/trace'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
import DiffStat from '$lib/layout/DiffStat'
import { app } from '$lib/state/app'
import { useConversation, type Conversation } from '$lib/state/conversation'
import type { ApprovalRequest, Command, DecidedBy, Decision } from '$lib/ipc/engine'
import { CHANGE_KIND_LABEL, formatToolName, prettyJson, summarizeInput } from '../format'
import MonoBlock from './MonoBlock'
import { approvalTrace } from './toolLine'
import { toolIcon } from './toolIcons'

export interface ApprovalCardProps {
  approval: ApprovalRequest
  resolved?: { decision: Decision; by: DecidedBy }
  conversation: Conversation
}

export function ApprovalCard({ approval, resolved, conversation }: ApprovalCardProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const subscribedProfile = useConversation(liveConversation, (c) =>
    approval.agent_id ? (c.agents.get(approval.agent_id)?.spawn.profile ?? null) : null,
  )
  const fallbackProfile =
    !liveConversation && approval.agent_id
      ? (conversation?.agents?.get(approval.agent_id)?.spawn.profile ?? null)
      : null
  const profile = liveConversation ? subscribedProfile : fallbackProfile

  /** Decision being sent; kept until the engine confirms with approval_resolved. */
  const [sending, setSending] = useState<Decision | null>(null)
  const [refusal, setRefusal] = useState<string | null>(null)

  const agentName = approval.agent_id
    ? (profile ?? t('conversation.unknownAgent', { value: approval.agent_id.slice(0, 8) }))
    : null
  const displayTool = formatToolName(approval.tool)
  const inputSummary = summarizeInput(approval.tool, approval.input)
  const inputText = prettyJson(approval.input)
  const ToolIcon = toolIcon(approval.tool)

  async function decide(decision: Decision) {
    if (sending !== null || resolved) return
    setSending(decision)
    setRefusal(null)
    const message: string | null = await app.command(conversation.sessionId, {
      type: 'approve',
      approval_id: approval.approval_id,
      decision,
    } satisfies Command)
    if (message) {
      setRefusal(message)
      setSending(null)
    }
  }

  if (resolved) {
    return (
      <Trace.Root>
        <Trace.Line status={resolved.decision === 'deny' ? 'error' : undefined}>
          <Trace.Icon>
            {resolved.decision === 'deny' ? (
              <ShieldXIcon />
            ) : (
              <ShieldCheckIcon className="text-success" />
            )}
          </Trace.Icon>
          <Trace.Title className="break-words">{approvalTrace(approval.tool, resolved)}</Trace.Title>
        </Trace.Line>
      </Trace.Root>
    )
  }

  if (sending !== null && refusal === null) {
    return (
      <Trace.Root>
        <Trace.Line status="running" role="status">
          <Trace.Icon>
            <ToolIcon />
          </Trace.Icon>
          <Trace.Title>{t('conversation.decisionSent')}</Trace.Title>
        </Trace.Line>
      </Trace.Root>
    )
  }

  return (
    /* A pending request is a prompt, not activity: it sits outside Trace. */
    <Item
      variant="outline"
      size="sm"
      aria-label={t('conversation.approvalRequested2')}
      className="border-warning/40 bg-card"
    >
      <ItemMedia variant="icon" className="text-warning">
        <ToolIcon />
      </ItemMedia>
      <ItemContent className="min-w-0">
        <p className="text-caption font-medium text-warning">{t('conversation.approvalRequested2')}</p>
        <ItemTitle className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="font-mono"
            title={displayTool !== approval.tool ? approval.tool : undefined}
          >
            {displayTool}
          </span>
          {inputSummary && (
            <span className="min-w-0 font-mono text-xs font-normal break-all text-muted-foreground">
              {inputSummary}
            </span>
          )}
        </ItemTitle>
        <ItemDescription className="line-clamp-none break-words">{approval.description}</ItemDescription>
        <p className="text-xs text-muted-foreground">
          {t('conversation.level', { level: approval.level })}
          {agentName && <span> · {t('conversation.agent', { agentName })}</span>}
        </p>
      </ItemContent>
      <ItemActions>
        <Button size="sm" variant="outline" onClick={() => void decide('deny')}>
          {t('common.refuse')}
        </Button>
        <Button size="sm" onClick={() => void decide('allow')}>
          {t('common.allow')}
        </Button>
      </ItemActions>
      <ItemFooter className="flex-col items-stretch gap-2">
        <Collapsible>
          <CollapsibleTrigger className="group inline-flex w-fit items-center gap-1 rounded-md text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronDownIcon
              className="size-3.5 transition-transform group-data-[state=open]:rotate-180"
              aria-hidden="true"
            />
            {t('conversation.fullInput')}
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-1.5">
            <MonoBlock text={inputText} label={t('conversation.fullInputOf', { tool: displayTool })} />
          </CollapsibleContent>
        </Collapsible>

        {approval.preview && (
          <>
            {approval.preview.refusal && (
              <p className="text-xs break-words text-destructive">{approval.preview.refusal}</p>
            )}
            {approval.preview.files.length > 0 && (
              <ul
                className="flex flex-col gap-2 border-t border-border pt-2.5"
                aria-label={t('conversation.filesInvolved')}
              >
                {approval.preview.files.map((file) => (
                  <li key={file.absolute} className="flex flex-col gap-1.5">
                    <Collapsible>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                        <span className="text-muted-foreground">{CHANGE_KIND_LABEL[file.kind]}</span>
                        <span className="min-w-0 font-mono break-all">{file.path}</span>
                        <DiffStat
                          additions={file.added}
                          deletions={file.removed}
                          label={t('common.lines')}
                        />
                        {file.diff && (
                          <CollapsibleTrigger
                            aria-label={t('conversation.viewTheDiffOf', { path: file.path })}
                            className="rounded-sm px-1 text-brand underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                          >
                            {t('conversation.viewTheDiff')}
                          </CollapsibleTrigger>
                        )}
                      </div>
                      {file.diff && (
                        <CollapsibleContent className="mt-1.5">
                          <MonoBlock
                            text={file.diff}
                            label={t('conversation.diffOf', { path: file.path })}
                            diff
                            maxLines={Number.POSITIVE_INFINITY}
                          />
                        </CollapsibleContent>
                      )}
                    </Collapsible>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {refusal && (
          <p className="text-xs break-words text-destructive" role="alert">
            {refusal}
          </p>
        )}
      </ItemFooter>
    </Item>
  )
}

export default ApprovalCard
