// The long-term memory: on or off (from the next run), the global memory and the open
// project's, viewed and cleared, and the memories of projects removed from the list.
// Turning it off deletes nothing; viewing and clearing work either way.
import { useCallback, useEffect, useState } from 'react'
import { Button } from '$lib/components/ui/button'
import { ButtonGroup } from '$lib/components/ui/button-group'
import { Switch } from '$lib/components/ui/switch'
import { t, useLanguage } from '$lib/i18n/i18n'
import * as ipc from '$lib/ipc/client'
import type { MemoryCounts, MemoryOverview, MemoryScope } from '$lib/ipc/client'
import { app, useApp } from '$lib/state/app'
import { ui } from '$lib/state/ui'
import DeleteDialog from './DeleteDialog'
import SettingsGroup from './SettingsGroup'
import type { WriteOutcome } from './models'

export function MemorySettings() {
  useLanguage()
  const currentProject = useApp((s) => s.currentProject)
  const memoryEnabled = useApp((s) => s.prefs.memory_enabled)
  const project = currentProject && !currentProject.chats ? currentProject : null

  const [overview, setOverview] = useState<MemoryOverview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)
  /** The deletion waiting for its confirmation. */
  const [pending, setPending] = useState<{
    title: string
    description: string
    run: () => Promise<void>
  } | null>(null)

  const projectId = project?.id ?? null

  const load = useCallback(async () => {
    try {
      const next = await ipc.memoryOverview(projectId)
      setOverview(next)
      setLoadError(null)
    } catch (e) {
      setLoadError(ipc.errorMessage(e))
    }
  }, [projectId])

  useEffect(() => {
    void load()
  }, [load])

  async function toggle(on: boolean) {
    setToggling(true)
    const err = await app.setMemoryEnabled(on)
    setToggleError(err)
    setToggling(false)
  }

  function total(c: MemoryCounts): string {
    return t('settings.noteCount', { count: c.notes })
  }

  function view(scope: MemoryScope) {
    ui.open('memory', { scope })
  }

  async function confirmed(run: () => Promise<void>): Promise<WriteOutcome> {
    try {
      await run()
      await load()
      return { ok: true }
    } catch (e) {
      return { ok: false, message: ipc.errorMessage(e), conflict: false }
    }
  }

  function askGlobal(c: MemoryCounts) {
    setPending({
      title: t('settings.deleteTheGlobalMemory'),
      description: t('settings.everyProjectLosesAccessToThis', { c: total(c) }),
      run: () => ipc.memoryDelete('global', null),
    })
  }

  function askProject(c: MemoryCounts, id: string, name: string) {
    setPending({
      title: t('settings.deleteThisProjectsMemory'),
      description: t('settings.theConversationHistoryIsKept', { name, c: total(c) }),
      run: () => ipc.memoryDelete('project', id),
    })
  }

  function askRetired(id: string, name: string | null) {
    setPending({
      title: t('settings.deleteThisRemovedProjectsMemory'),
      description: t('settings.theConversationHistoryIsKept2', { id: name ?? id }),
      run: () => ipc.memoryDeleteRetired(id),
    })
  }

  return (
    <>
      <div className="flex flex-col gap-6">
        <SettingsGroup title={t('common.memory')}>
          <label className="flex items-center justify-between gap-3 p-3 text-ui">
            {t('common.memory')}
            <Switch
              checked={memoryEnabled}
              onCheckedChange={(on) => void toggle(on)}
              disabled={toggling}
            />
          </label>
          {toggleError && (
            <p role="alert" className="p-3 text-ui text-pretty text-destructive">
              {t('settings.theSettingWasntSaved', { saveError: toggleError })}
            </p>
          )}
        </SettingsGroup>

        {loadError && (
          <p role="alert" className="text-ui text-pretty text-destructive">
            {t('settings.couldNotRead', { loadError })}
          </p>
        )}

        <SettingsGroup title={t('settings.globalMemory')}>
          <div className="flex flex-wrap items-center gap-2 p-3">
            <span className="text-ui text-muted-foreground tabular-nums">
              {overview ? total(overview.global) : '—'}
            </span>
            <ButtonGroup className="ml-auto">
              <Button variant="outline" size="sm" onClick={() => view('global')}>
                {t('settings.view')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={!overview}
                onClick={() => overview && askGlobal(overview.global)}
              >
                {t('common.delete')}
              </Button>
            </ButtonGroup>
          </div>
        </SettingsGroup>

        <SettingsGroup title={t('settings.memoryPerProject')}>
          <div className="flex flex-wrap items-center gap-2 p-3">
            {project ? (
              <>
                <span className="text-ui font-medium">{project.name}</span>
                <span className="text-ui text-muted-foreground tabular-nums">
                  {overview?.project ? total(overview.project) : '—'}
                </span>
              </>
            ) : (
              <span className="text-ui text-muted-foreground">{t('common.noOpenProject')}</span>
            )}
            <ButtonGroup className="ml-auto">
              <Button
                variant="outline"
                size="sm"
                disabled={!project}
                onClick={() => view('project')}
              >
                {t('settings.view')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive"
                disabled={!project || !overview?.project}
                onClick={() =>
                  project && overview?.project && askProject(overview.project, project.id, project.name)
                }
              >
                {t('common.delete')}
              </Button>
            </ButtonGroup>
          </div>
        </SettingsGroup>

        {overview && overview.retired.length > 0 && (
          <SettingsGroup title={t('settings.memoriesOfRemovedProjects')}>
            {overview.retired.map((r) => (
              <div key={r.project_id} className="flex items-center gap-2 p-3">
                <span className="min-w-0 truncate text-ui">
                  {r.name ?? t('settings.unnamedProject')}
                </span>
                <span className="min-w-0 truncate font-mono text-caption text-muted-foreground">
                  {r.project_id}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-destructive"
                  onClick={() => askRetired(r.project_id, r.name)}
                >
                  {t('common.delete')}
                </Button>
              </div>
            ))}
          </SettingsGroup>
        )}
      </div>

      {pending && (
        <DeleteDialog
          title={pending.title}
          description={pending.description}
          onConfirm={() => confirmed(pending.run)}
          onClose={() => setPending(null)}
        />
      )}
    </>
  )
}

export default MemorySettings
