// Left panel: projects with their conversations, the conversations without a project, and search.
// Entry point mounted by App.tsx with no props. All state lives in `app`.
import { useState } from 'react'
import { ArrowDownToLineIcon, FolderPlusIcon, SettingsIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Spinner } from '$lib/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip'
import { hasActionableUpdate, updateTooltipLabel } from '$lib/features/updates/updates'
import { app, useApp } from '$lib/state/app'
import { ui } from '$lib/state/ui'
import ConversationList from './ConversationList'
import NewConversationButton from './NewConversationButton'
import ProjectList from './ProjectList'

export function NavigationPanel() {
  useLanguage()
  const pinnedSessions = useApp((s) => s.pinnedSessions)
  const folders = useApp((s) => s.folders)
  const chats = useApp((s) => s.chatsProject)
  const updateStatus = useApp((s) => s.updateStatus)
  const hasChats = useApp((s) => {
    const c = s.chatsProject
    return Boolean(c && s.sessionsOf(c.id).some((sess) => !s.isPinned(sess.id)))
  })

  const [adding, setAdding] = useState(false)

  const showUpdateButton = hasActionableUpdate(updateStatus)
  const updateTooltip = updateTooltipLabel(updateStatus)

  async function addProject() {
    if (adding) return
    setAdding(true)
    try {
      await app.addProject()
    } catch (error) {
      app.fail(error)
    } finally {
      setAdding(false)
    }
  }

  return (
    <aside
      aria-label={t('navigation.projectsAndConversations')}
      className="flex h-full min-h-0 flex-col bg-sidebar text-sidebar-foreground"
    >
      <div className="flex flex-col gap-0.5 px-2 pt-1 pb-3">
        <NewConversationButton className="w-full justify-start px-2 text-ui" />
      </div>

      {/* Native scrolling, like shadcn's Sidebar.Content, and scroll-fade: an edge fades only where there is more to see. */}
      <ScrollArea className="min-h-0 flex-1" viewportClass="scroll-fade scroll-fade-6">
        <div className="flex flex-col gap-4 pb-6">
          {pinnedSessions.length > 0 && (
            <section className="flex flex-col gap-1 px-2">
              <h2 className="sticky top-0 z-10 flex h-6 items-center bg-sidebar px-2 text-xs font-medium text-muted-foreground">
                {t('navigation.pinned')}
              </h2>
              <ConversationList sessions={pinnedSessions} label={t('navigation.pinned')} />
            </section>
          )}

          <section className="flex flex-col gap-1 px-2">
            <div className="sticky top-0 z-10 flex h-6 items-center justify-between bg-sidebar pr-0.5 pl-2">
              <h2 className="text-xs font-medium text-muted-foreground">{t('navigation.projects')}</h2>
              <Button
                variant="ghost"
                size="icon-xs"
                className="text-muted-foreground hover:text-foreground"
                aria-label={t('navigation.newProject')}
                title={t('navigation.newProject')}
                onClick={() => void addProject()}
                disabled={adding}
              >
                <FolderPlusIcon aria-hidden="true" />
              </Button>
            </div>
            {folders.length > 0 && <ProjectList />}
          </section>

          {chats && hasChats && (
            <section className="flex flex-col gap-1 px-2">
              <h2 className="sticky top-0 z-10 flex h-6 items-center bg-sidebar px-2 text-xs font-medium text-muted-foreground">
                {t('navigation.conversations')}
              </h2>
              <ConversationList projectId={chats.id} label={t('navigation.conversations')} />
            </section>
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1">
        <Button
          variant="ghost"
          className="min-w-0 flex-1 justify-start text-ui"
          aria-label={t('common.bricksSettings')}
          onClick={() => ui.setSettingsOpen(true)}
        >
          <SettingsIcon aria-hidden="true" data-icon="inline-start" />
          {t('navigation.settings')}
        </Button>
        {showUpdateButton && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="default"
                size="icon-sm"
                className="shrink-0 rounded-full bg-emerald-600 text-white hover:bg-emerald-600/90 dark:bg-emerald-600 dark:hover:bg-emerald-500 [&_svg]:size-3.5"
                aria-label={updateTooltip}
                onClick={() => ui.setUpdateDialogOpen(true)}
              >
                {updateStatus.phase === 'downloading' ? (
                  <Spinner aria-hidden="true" />
                ) : (
                  <ArrowDownToLineIcon aria-hidden="true" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              {updateTooltip}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </aside>
  )
}

export default NavigationPanel
