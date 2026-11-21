// Right panel: pending approvals, the project environment and the context
// occupation of the shown conversation. Its sub-agents are in the thread.
import { FolderOpenIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import type { ApprovalRequest } from '$lib/ipc/engine'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import EmptyState from '$lib/layout/EmptyState'
import ContextCard from './ContextCard'
import PendingApprovals from './PendingApprovals'
import ProjectEnvironment from './ProjectEnvironment'

const EMPTY_APPROVALS: ApprovalRequest[] = []

export function ContextPanel() {
  useLanguage()
  const project = useApp((s) => s.currentProject)
  const conversation = useApp((s) => s.current)
  const approvals = useConversation(conversation, (c) => c.pendingApprovals) ?? EMPTY_APPROVALS

  return (
    <div className="h-full">
      {!project ? (
        <EmptyState title={t('common.noOpenProject')} icon={FolderOpenIcon} />
      ) : (
        /* The scroll viewport takes keyboard focus and has a name, so keyboard users
           can scroll the panel even when no control in view is focusable. */
        <ScrollArea
          className="h-full"
          viewportProps={{
            role: 'region',
            'aria-label': t('context.projectContext'),
            tabIndex: 0,
          }}
        >
          <div className="flex flex-col gap-3 px-3 pt-5 pb-3">
            {conversation && <PendingApprovals approvals={approvals} />}

            {/* A conversation without a project has no project folder to show. */}
            {!project.chats && <ProjectEnvironment project={project} />}

            {conversation && <ContextCard conversation={conversation} />}
          </div>
        </ScrollArea>
      )}
    </div>
  )
}

export default ContextPanel
