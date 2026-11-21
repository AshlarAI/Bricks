// Hosts the inspector view opened by a `/` command (ui.inspector).
// Owner: orchestrator. Each view lives in its owner's feature folder.
import type { ComponentType } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
import { t, useLanguage } from '$lib/i18n/i18n'
import { ui, useUi, type InspectorState, type InspectorView } from '$lib/state/ui'
import HelpView from './HelpView'
import SearchView from '$lib/features/inspect/SearchView'
import MemoryView from '$lib/features/inspect/MemoryView'
import ContextView from '$lib/features/inspect/ContextView'
import CostView from '$lib/features/inspect/CostView'
import ClearView from '$lib/features/inspect/ClearView'
import AgentProfilesView from '$lib/features/catalog/AgentProfilesView'
import SkillsView from '$lib/features/catalog/SkillsView'
import JobsView from '$lib/features/catalog/JobsView'
import ChangesetView from '$lib/features/catalog/ChangesetView'
import SessionView from '$lib/features/session-info/SessionView'
import SessionsView from '$lib/features/session-info/SessionsView'
import ToolsView from '$lib/features/session-info/ToolsView'
import McpView from '$lib/features/session-info/McpView'
import ConfigView from '$lib/features/session-info/ConfigView'
import FileView from '$lib/features/inspect/FileView'

type ViewProps = { args: InspectorState['args'] }

const VIEWS: Record<InspectorView, { title: string; component: ComponentType<ViewProps> }> = {
  help: { get title() { return t('commands.commands') }, component: HelpView },
  search: { get title() { return t('common.codeSearch') }, component: SearchView },
  memory: { get title() { return t('common.memory') }, component: MemoryView },
  context: { get title() { return t('common.context') }, component: ContextView },
  cost: { get title() { return t('common.usage') }, component: CostView },
  clear: { get title() { return t('common.clearContext') }, component: ClearView },
  agents: { get title() { return t('common.agentProfiles') }, component: AgentProfilesView },
  skills: { get title() { return t('common.skills') }, component: SkillsView },
  jobs: { get title() { return t('common.backgroundJobs') }, component: JobsView },
  changeset: { get title() { return t('common.isolatedChanges') }, component: ChangesetView },
  session: { get title() { return t('common.session') }, component: SessionView },
  sessions: { get title() { return t('commands.resumeASession') }, component: SessionsView },
  tools: { get title() { return t('common.tools') }, component: ToolsView },
  mcp: { get title() { return t('common.mcpServers') }, component: McpView },
  config: { get title() { return t('common.configuration') }, component: ConfigView },
  file: { get title() { return t('commands.projectFile') }, component: FileView },
}

export function InspectorHost() {
  useLanguage()
  const inspector = useUi((s) => s.inspector)
  const entry = inspector ? VIEWS[inspector.view] : null
  const ViewComponent = entry?.component

  return (
    <Dialog
      open={inspector !== null}
      onOpenChange={(open) => {
        if (!open) ui.close()
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col gap-3 sm:max-w-3xl">
        {entry && inspector && ViewComponent && (
          <>
            <DialogHeader>
              <DialogTitle>{entry.title}</DialogTitle>
            </DialogHeader>
            {/* The dialog has only a max height: the viewport carries its own, minus padding and title. */}
            <ScrollArea className="min-h-0 flex-1" viewportClass="max-h-[calc(85vh-5.5rem)]">
              <ViewComponent args={inspector.args} />
            </ScrollArea>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default InspectorHost
