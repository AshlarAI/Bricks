// Extensions: the MCP servers of Bricks. Computer Use (Cua Driver) is built in: it can be
// turned on and off, never removed. On macOS its permissions are those of the driver's own
// process, read again when the window comes back to the front; Windows has none to ask for.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CircleCheckIcon,
  CircleXIcon,
  ExternalLinkIcon,
  MousePointerClickIcon,
} from 'lucide-react'
import { RefreshCWIcon, useIconHover, type RefreshCWIconHandle } from '$lib/components/icons'
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import { Switch } from '$lib/components/ui/switch'
import { t, useLanguage } from '$lib/i18n/i18n'
import * as ipc from '$lib/ipc/client'
import type { ComputerUsePermission } from '$lib/ipc/bindings/ComputerUsePermission'
import type { ComputerUseStatus } from '$lib/ipc/bindings/ComputerUseStatus'
import { app, useApp } from '$lib/state/app'
import { FocusGate } from '$lib/state/focus-gate'
import { cn } from '$lib/utils'
import McpServers from './McpServers'
import SettingsGroup from './SettingsGroup'
import { computerUseLabel, permissionLabel } from './extensions'

const PERMISSIONS: {
  id: ComputerUsePermission
  label: string
  key: 'accessibility' | 'screen_recording'
}[] = [
  { id: 'accessibility', get label() { return t('settings.accessibility') }, key: 'accessibility' },
  { id: 'screen_recording', get label() { return t('settings.screenCapture') }, key: 'screen_recording' },
]

export function ExtensionsSettings() {
  useLanguage()
  const platform = useApp((s) => s.info?.platform)
  const computerUsePref = useApp((s) => s.prefs.computer_use_enabled)

  const [status, setStatus] = useState<ComputerUseStatus | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const inFlightRef = useRef<Promise<void> | null>(null)
  const focusGateRef = useRef(new FocusGate(1_500))

  const available =
    status !== null && status.state !== 'unsupported' && status.state !== 'missing'
  /** Accessibility and Screen Recording are macOS grants. */
  const hasPermissions = platform === 'macos'
  const enabled = status?.enabled ?? computerUsePref
  const refreshHover = useIconHover<RefreshCWIconHandle>()

  const refresh = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current
    setChecking(true)
    const run = (async () => {
      try {
        const next = await ipc.computerUseStatus()
        setStatus(next)
        setLoadError(null)
      } catch (e) {
        setLoadError(ipc.errorMessage(e))
      } finally {
        setChecking(false)
        inFlightRef.current = null
      }
    })()
    inFlightRef.current = run
    return run
  }, [])

  async function setEnabled(on: boolean) {
    setBusy(true)
    setActionError(null)
    try {
      const next = await ipc.computerUseSetEnabled(on)
      setStatus(next)
      app.noteComputerUse(next.enabled)
    } catch (e) {
      setActionError(ipc.errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  async function request(permission: ComputerUsePermission) {
    setActionError(null)
    try {
      await ipc.computerUseRequestPermission(permission)
    } catch (e) {
      setActionError(ipc.errorMessage(e))
    }
  }

  useEffect(() => {
    void refresh()
    // Back from System Settings: the grants are read again.
    const onFocus = () => {
      if (inFlightRef.current || !focusGateRef.current.canRunOnFocus()) return
      void focusGateRef.current.track(() => refresh())
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') onFocus()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  // While the driver starts, its state is read again every second.
  useEffect(() => {
    if (status?.state !== 'starting') return
    const timer = setTimeout(() => void refresh(), 1000)
    return () => clearTimeout(timer)
  }, [status?.state, refresh])

  return (
    <div className="flex flex-col gap-6">
      <McpServers />

      <SettingsGroup title={t('common.mcpServers')}>
        <div className="flex items-center gap-3 p-3">
          <MousePointerClickIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-2">
              <span id="computer-use-label" className="text-ui font-medium text-foreground">
                Computer Use
              </span>
              <Badge variant="outline">{t('common.builtIn')}</Badge>
            </div>
            {status && (
              <span className="text-caption text-muted-foreground" data-testid="computer-use-state">
                {computerUseLabel(status)}
              </span>
            )}
          </div>
          <Switch
            aria-labelledby="computer-use-label"
            checked={enabled}
            disabled={busy || !available}
            onCheckedChange={(on) => void setEnabled(on)}
          />
        </div>
        {status?.driver && (
          <div className="flex items-center justify-between gap-3 p-3 text-ui">
            <span className="shrink-0 whitespace-nowrap text-muted-foreground">
              Cua Driver{status.driver.version ? ` ${status.driver.version}` : ''}
            </span>
            <span
              className="min-w-0 truncate font-mono text-caption text-muted-foreground"
              title={status.driver.path}
            >
              {status.driver.path}
            </span>
          </div>
        )}
        {status?.state === 'error' && status.error && (
          <p role="alert" className="p-3 text-ui text-pretty text-destructive">
            {status.error}
          </p>
        )}
        {loadError && (
          <p role="alert" className="p-3 text-ui text-pretty text-destructive">
            {loadError}
          </p>
        )}
      </SettingsGroup>

      {available && status && hasPermissions && (
        <SettingsGroup
          title={t('settings.computerUsePermissions')}
          action={
            <Button
              size="icon-xs"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              disabled={checking}
              aria-label={t('settings.checkAgain')}
              title={t('settings.checkAgain')}
              onMouseEnter={refreshHover.onMouseEnter}
              onMouseLeave={refreshHover.onMouseLeave}
              onClick={() => void refresh()}
            >
              <RefreshCWIcon
                ref={refreshHover.ref}
                className={cn('size-3.5', checking && 'animate-spin')}
                aria-hidden="true"
              />
            </Button>
          }
        >
          {PERMISSIONS.map((permission) => {
            const state = status[permission.key]
            return (
              <div key={permission.id} className="flex items-center gap-3 p-3" data-testid={`permission-${permission.id}`}>
                <span className="flex-1 text-ui text-foreground">{permission.label}</span>
                <span
                  className={cn(
                    'inline-flex items-center gap-1.5 text-ui',
                    state === 'granted'
                      ? 'text-success'
                      : state === 'missing'
                        ? 'text-destructive'
                        : 'text-muted-foreground',
                  )}
                >
                  {state === 'granted' ? (
                    <CircleCheckIcon className="size-4" aria-hidden="true" />
                  ) : state === 'missing' ? (
                    <CircleXIcon className="size-4" aria-hidden="true" />
                  ) : null}
                  {permissionLabel(state)}
                </span>
                {state === 'missing' && (
                  <Button size="sm" variant="secondary" onClick={() => void request(permission.id)}>
                    <ExternalLinkIcon aria-hidden="true" data-icon="inline-start" />
                    {t('settings.openSettings')}
                  </Button>
                )}
              </div>
            )
          })}
        </SettingsGroup>
      )}
      {actionError && (
        <p role="alert" className="text-ui text-pretty text-destructive">
          {actionError}
        </p>
      )}
    </div>
  )
}

export default ExtensionsSettings
