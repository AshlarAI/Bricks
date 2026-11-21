// One applied edit operation: a compact line per file (name and the
// operation's counts). The full path is the name's tooltip; a click opens
// the file in the reader.
import { t, useLanguage } from '$lib/i18n/i18n'
import DiffStat from '$lib/layout/DiffStat'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { useConversation, type Conversation, type EditItem } from '$lib/state/conversation'
import { reader } from '$lib/state/reader'
import { CHANGE_KIND_LABEL } from '../format'

export interface EditRowProps {
  item: EditItem
  conversation: Conversation
  inline?: boolean
}

function baseName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

export function EditRow({ item, conversation, inline = false }: EditRowProps) {
  useLanguage()
  const liveConversation =
    conversation && typeof conversation.subscribe === 'function' ? conversation : null
  const ownAgentId = useConversation(liveConversation, (c) => c.ownAgentId)
  const subscribedProfile = useConversation(liveConversation, (c) =>
    item.agentId && item.agentId !== c.ownAgentId
      ? (c.agents.get(item.agentId)?.spawn.profile ?? null)
      : null,
  )

  const effectiveOwnAgentId = liveConversation ? ownAgentId : conversation?.ownAgentId
  const profile = liveConversation
    ? subscribedProfile
    : item.agentId
      ? (conversation?.agents?.get(item.agentId)?.spawn.profile ?? null)
      : null

  // Its own agent is not named in its branch.
  const agentName =
    !item.agentId || item.agentId === effectiveOwnAgentId
      ? null
      : (profile ?? t('conversation.unknownAgent', { value: item.agentId.slice(0, 8) }))

  function open(file: EditItem['files'][number]) {
    reader.open({
      sessionId: conversation.sessionId,
      projectId: conversation.projectId,
      agentId: item.agentId,
      path: file.path,
      absolute: file.absolute ?? null,
    })
  }

  return (
    <ul
      aria-label={agentName ? t('conversation.filesChangedBy', { agentName }) : t('conversation.filesChanged')}
      className={inline ? 'contents' : 'flex flex-col gap-0.5 py-0.5 text-ui'}
    >
      {item.files.map((file, i) => (
        <li key={`${file.absolute ?? file.path}#${i}`} className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1.5 rounded-sm text-start font-mono text-xs hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            title={`${file.absolute ?? file.path} · ${CHANGE_KIND_LABEL[file.kind]}${agentName ? ` · ${agentName}` : ''}`}
            onClick={() => open(file)}
          >
            <FileIcon path={file.path} />
            <span className="min-w-0 truncate">{baseName(file.path)}</span>
          </button>
          {file.binary ? (
            <span className="text-xs text-muted-foreground">{t('common.binary')}</span>
          ) : (
            <DiffStat additions={file.added} deletions={file.removed} />
          )}
        </li>
      ))}
    </ul>
  )
}

export default EditRow
