import { toast } from 'sonner'
import { Button } from '$lib/components/ui/button'
import { Spinner } from '$lib/components/ui/spinner'
import { hasActionableUpdate, updateTooltipLabel } from '$lib/features/updates/updates'
import { t, useLanguage } from '$lib/i18n/i18n'
import { app, useApp } from '$lib/state/app'
import { ui } from '$lib/state/ui'
import CopyValue from './CopyValue'
import SettingsGroup from './SettingsGroup'
import { platformLabel, versionLabel } from './format'

export function ApplicationSettings() {
  useLanguage()
  const info = useApp((s) => s.info)
  const updateStatus = useApp((s) => s.updateStatus)
  const checking = updateStatus.phase === 'checking'
  const actionable = hasActionableUpdate(updateStatus)
  const statusLine = updateTooltipLabel(updateStatus)

  async function onUpdateAction() {
    if (actionable) {
      ui.setUpdateDialogOpen(true)
      return
    }
    const next = await app.checkForUpdates()
    if (next.phase === 'available' || next.phase === 'ready') {
      ui.setUpdateDialogOpen(true)
    } else if (next.phase === 'up_to_date') {
      toast.success(t('updates.upToDate'))
    } else if (next.phase === 'error') {
      toast.error(t('updates.checkFailed', { message: next.message }))
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {!info ? (
        <p className="text-ui text-muted-foreground">{t('settings.informationUnavailable')}</p>
      ) : (
        <>
          <SettingsGroup title="Bricks">
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-6 gap-y-2 p-3 text-ui">
              <dt className="text-muted-foreground">{t('settings.name')}</dt>
              <dd className="text-foreground">Bricks</dd>
              <dt className="text-muted-foreground">{t('settings.version')}</dt>
              <dd className="text-foreground tabular-nums" title={info.version}>
                {versionLabel(info.version)}
              </dd>
              <dt className="text-muted-foreground">{t('settings.platform')}</dt>
              <dd className="text-foreground">{platformLabel(info.platform)}</dd>
            </dl>
            <div className="flex items-center justify-between gap-3 p-3">
              <span className="min-w-0 truncate text-ui text-muted-foreground">{statusLine}</span>
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={checking}
                onClick={() => void onUpdateAction()}
              >
                {checking ? (
                  <>
                    <Spinner data-icon="inline-start" />
                    {t('updates.checking')}
                  </>
                ) : updateStatus.phase === 'ready' ? (
                  t('updates.restartToUpdate')
                ) : updateStatus.phase === 'available' || updateStatus.phase === 'downloading' ? (
                  t('updates.viewUpdate')
                ) : (
                  t('updates.checkForUpdates')
                )}
              </Button>
            </div>
          </SettingsGroup>

          <SettingsGroup title={t('settings.folders')}>
            <div className="flex flex-col gap-2 p-3">
              <span className="text-ui text-muted-foreground" id="settings-bricks-home-label">
                {t('settings.bricksFolder')}
              </span>
              <div role="group" aria-labelledby="settings-bricks-home-label">
                <CopyValue label={t('settings.bricksFolder')} value={info.bricks_home} />
              </div>
            </div>
            <div className="flex flex-col gap-2 p-3">
              <span className="text-ui text-muted-foreground" id="settings-sessions-label">
                {t('settings.conversationsFolder')}
              </span>
              <div role="group" aria-labelledby="settings-sessions-label">
                <CopyValue label={t('settings.conversationsFolder')} value={info.sessions_dir} />
              </div>
            </div>
          </SettingsGroup>
        </>
      )}
    </div>
  )
}

export default ApplicationSettings
