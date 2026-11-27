// End of a response, under its answer: why it stopped early (an error shows in the banner
// above the composer), then the files it changed (cumulative counts of the applied operations). Each
// file opens its changes in the reader, or shows itself in the Finder. The time
// worked is in the bar of its steps (WorkBlock.tsx).
import { useState } from 'react'
import { ChevronRightIcon, CircleAlertIcon, ExternalLinkIcon, EyeIcon, TriangleAlertIcon } from 'lucide-react'
import { localeTag, t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '$lib/components/ui/collapsible'
import { Marker, MarkerContent, MarkerIcon } from '$lib/components/ui/marker'
import FileIcon from '$lib/features/file-icons/FileIcon'
import DiffStat from '$lib/layout/DiffStat'
import { readerFileReveal } from '$lib/ipc/reader'
import {
  useConversation,
  type Conversation,
  type RunEndItem,
  type RunFileSummary,
  type RunInfo,
} from '$lib/state/conversation'
import { reader } from '$lib/state/reader'
import { resolveChatError } from '../chat-error'
import { runEndSummary } from '../runend'

export interface RunEndCardProps {
  item: RunEndItem
  conversation: Conversation
}

/**
 * The folder of a file: its relative folder in the workspace, or only the name of
 * its parent folder for an absolute path (the full path is in the title). Empty at the root.
 */
function folderOf(file: RunFileSummary): string {
  const path = file.path
  const cut = path.lastIndexOf('/')
  if (cut <= 0) return ''
  const folder = path.slice(0, cut)
  return path.startsWith('/') ? folder.slice(folder.lastIndexOf('/') + 1) : folder
}

export function RunEndCard({ item, conversation }: RunEndCardProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const subscribedRun = useConversation(liveConversation, (c) => c.runs.get(item.runId))
  const run: RunInfo | undefined = liveConversation
    ? subscribedRun
    : conversation?.runs?.get(item.runId)

  const summary = runEndSummary(run)
  const tag = localeTag()
  const files = run
    ? [...run.fileSummaries].sort(
        (a, b) => a.name.localeCompare(b.name, tag) || a.path.localeCompare(b.path, tag),
      )
    : []
  const totals =
    files.length === 0 || files.every((f) => f.binary)
      ? null
      : files.reduce(
          (acc, f) => ({ added: acc.added + f.added, removed: acc.removed + f.removed }),
          { added: 0, removed: 0 },
        )
  const unsatisfied = run?.approvalsUnsatisfied.length ?? 0
  const reason = summary.outcome === 'incomplete' ? summary.reason : null
  const errorMessage = summary.error ? resolveChatError(summary.error).message : null

  const [open, setOpen] = useState(true)
  /** Error of the last « Afficher dans le Finder »; cleared by the next one. */
  const [revealError, setRevealError] = useState<string | null>(null)

  function review(file: RunFileSummary) {
    const tab = reader.open({
      sessionId: conversation.sessionId,
      projectId: conversation.projectId,
      agentId: file.agentIds[0] ?? null,
      path: file.path,
      absolute: file.absolute,
    })
    // Falls back to the source while the file offers no changes.
    if (!reader.setMode(tab.id, 'changes')) {
      tab.requested = 'changes'
    }
  }

  async function reveal(file: RunFileSummary) {
    setRevealError(null)
    try {
      await readerFileReveal(
        conversation.sessionId,
        file.agentIds[0] ?? null,
        file.absolute ?? file.path,
      )
    } catch (e) {
      setRevealError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!errorMessage && !reason && unsatisfied === 0 && files.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {errorMessage && (
        <Marker tone="error" role="alert">
          <MarkerIcon>
            <CircleAlertIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>{errorMessage}</MarkerContent>
        </Marker>
      )}
      {reason && (
        <Marker tone="warning">
          <MarkerIcon>
            <TriangleAlertIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>{t('conversation.reason', { reason })}</MarkerContent>
        </Marker>
      )}
      {unsatisfied > 0 && (
        <Marker tone="warning">
          <MarkerIcon>
            <TriangleAlertIcon aria-hidden="true" />
          </MarkerIcon>
          <MarkerContent>{t('conversation.approvalsNotGranted', { count: unsatisfied })}</MarkerContent>
        </Marker>
      )}

      {files.length > 0 && (
        <section
          aria-label={t('conversation.filesChanged')}
          className="rounded-xl border border-border bg-card text-ui text-card-foreground"
        >
          <Collapsible open={open} onOpenChange={setOpen}>
            <CollapsibleTrigger className="group flex w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-start hover:bg-element-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <ChevronRightIcon
                className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90"
                aria-hidden="true"
              />
              <span className="font-medium">{t('common.filesChanged', { count: files.length })}</span>
              {totals && <DiffStat additions={totals.added} deletions={totals.removed} className="text-ui" />}
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ul className="border-t border-border">
                {files.map((file) => {
                  const folder = folderOf(file)
                  return (
                    <li
                      key={file.key}
                      className="flex min-w-0 items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
                    >
                      <FileIcon path={file.path} />
                      <span
                        className="min-w-0 shrink-0 truncate font-medium"
                        title={file.absolute ?? file.path}
                      >
                        {file.name}
                      </span>
                      {folder && (
                        <span className="min-w-0 truncate text-xs text-muted-foreground">{folder}/</span>
                      )}
                      {file.binary ? (
                        <span className="shrink-0 text-xs text-muted-foreground">{t('common.binary')}</span>
                      ) : (
                        <DiffStat additions={file.added} deletions={file.removed} className="shrink-0" />
                      )}
                      <span className="ml-auto flex shrink-0 items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t('conversation.viewTheChangesOf', { name: file.name })}
                          title={t('conversation.viewTheChanges')}
                          onClick={() => review(file)}
                        >
                          <EyeIcon aria-hidden="true" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label={t('conversation.showInTheFinder', { name: file.name })}
                          title={t('conversation.showInTheFinder2')}
                          onClick={() => void reveal(file)}
                        >
                          <ExternalLinkIcon aria-hidden="true" />
                        </Button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CollapsibleContent>
          </Collapsible>
          {revealError && (
            <Marker tone="error" role="alert" className="border-t border-border px-3 py-1.5">
              <MarkerIcon>
                <CircleAlertIcon aria-hidden="true" />
              </MarkerIcon>
              <MarkerContent>{revealError}</MarkerContent>
            </Marker>
          )}
        </section>
      )}
    </div>
  )
}

export default RunEndCard
