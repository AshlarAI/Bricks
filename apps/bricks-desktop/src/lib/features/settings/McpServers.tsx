// The MCP servers of the person (~/.bricks/config.json, shared with `bricks mcp`) and those the
// project in view declares in its .bricks/config.json: a project's server connects only once allowed,
// as declared. Changes reach the conversations opened afterwards.
import { useEffect, useState } from 'react'
import {
  AppWindowIcon,
  CircleCheckIcon,
  CircleXIcon,
  GlobeIcon,
  PlugZapIcon,
  PlusIcon,
  TerminalIcon,
  TrashIcon,
} from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { Spinner } from '$lib/components/ui/spinner'
import { Switch } from '$lib/components/ui/switch'
import { t, useLanguage } from '$lib/i18n/i18n'
import * as ipc from '$lib/ipc/client'
import type { McpServerInput, McpServerItem, McpServersView, McpTestResult } from '$lib/ipc/client'
import { useApp } from '$lib/state/app'
import McpAppDialog from './McpAppDialog'
import McpServerDialog from './McpServerDialog'
import SettingsGroup from './SettingsGroup'

export function McpServers() {
  useLanguage()
  const currentProject = useApp((s) => s.currentProject)
  const projectId = currentProject && !currentProject.chats ? currentProject.id : null

  const [list, setList] = useState<McpServersView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  /** The interface shown (MCP Apps prototype). */
  const [appView, setAppView] = useState<{ server: string; tool: string } | null>(null)
  /** Test results by server name; `null` while the test runs. */
  const [tests, setTests] = useState<Record<string, McpTestResult | null>>({})

  const mine = list?.servers.filter((s) => s.source === 'user') ?? []
  const theirs = list?.servers.filter((s) => s.source === 'project') ?? []

  async function run(action: () => Promise<McpServersView>) {
    try {
      const next = await action()
      setList(next)
      setError(null)
    } catch (e) {
      setError(ipc.errorMessage(e))
    }
  }

  async function add(input: McpServerInput): Promise<string | null> {
    try {
      const next = await ipc.mcpAdd(input, projectId)
      setList(next)
      return null
    } catch (e) {
      return ipc.errorMessage(e)
    }
  }

  async function test(server: McpServerItem) {
    setTests((prev) => ({ ...prev, [server.name]: null }))
    try {
      const result = await ipc.mcpTest(server.name, projectId)
      setTests((prev) => ({ ...prev, [server.name]: result }))
    } catch (e) {
      setTests((prev) => ({
        ...prev,
        [server.name]: { ok: false, tools: [], apps: [], error: ipc.errorMessage(e) },
      }))
    }
  }

  // The servers, again when another project comes into view.
  useEffect(() => {
    let cancelled = false
    ipc
      .mcpServers(projectId)
      .then((next) => {
        if (!cancelled) {
          setList(next)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) setError(ipc.errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [projectId])

  function renderRow(server: McpServerItem) {
    const result = tests[server.name]
    const Icon = server.transport === 'http' ? GlobeIcon : TerminalIcon
    return (
      <div
        key={`${server.source}:${server.name}`}
        className="flex flex-col gap-1.5 p-3"
        data-testid={`mcp-server-${server.name}`}
      >
        <div className="flex items-center gap-3">
          <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-ui font-medium text-foreground">{server.name}</span>
            <span className="truncate font-mono text-caption text-muted-foreground" title={server.target}>
              {server.target}
            </span>
          </div>
          {server.source === 'project' && server.decision !== 'approved' ? (
            server.shadowed ? (
              <span className="text-caption text-muted-foreground">{t('settings.mcpShadowed')}</span>
            ) : (
              <>
                <span className="text-caption text-muted-foreground">
                  {server.decision === 'denied' ? t('settings.mcpDenied') : t('settings.mcpPending')}
                </span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => projectId && void run(() => ipc.mcpDecide(projectId, server.name, true))}
                >
                  {t('settings.mcpApprove')}
                </Button>
                {server.decision === 'pending' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => projectId && void run(() => ipc.mcpDecide(projectId, server.name, false))}
                  >
                    {t('settings.mcpDeny')}
                  </Button>
                )}
              </>
            )
          ) : (
            <>
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                disabled={result === null}
                aria-label={t('settings.mcpTest', { name: server.name })}
                title={t('settings.mcpTest', { name: server.name })}
                onClick={() => void test(server)}
              >
                {result === null ? <Spinner aria-hidden="true" /> : <PlugZapIcon aria-hidden="true" />}
              </Button>
              {server.source === 'user' ? (
                <>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={t('settings.mcpRemove', { name: server.name })}
                    title={t('settings.mcpRemove', { name: server.name })}
                    onClick={() => void run(() => ipc.mcpRemove(server.name, projectId))}
                  >
                    <TrashIcon aria-hidden="true" />
                  </Button>
                  <Switch
                    aria-label={t('settings.mcpEnabled', { name: server.name })}
                    checked={server.enabled}
                    onCheckedChange={(on) =>
                      void run(() => ipc.mcpSetEnabled(server.name, on, projectId))
                    }
                  />
                </>
              ) : projectId ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void run(() => ipc.mcpDecide(projectId, server.name, false))}
                >
                  {t('settings.mcpDeny')}
                </Button>
              ) : null}
            </>
          )}
        </div>
        {result &&
          (result.ok ? (
            <>
              <p className="flex items-center gap-1.5 pl-7 text-caption text-success">
                <CircleCheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">
                  {result.tools.length === 1
                    ? t('settings.mcpOneTool')
                    : t('settings.mcpTools', { count: result.tools.length })}{' '}
                  · {result.tools.join(', ')}
                </span>
              </p>
              {result.apps.map((tool) => (
                <div key={tool} className="pl-7">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => setAppView({ server: server.name, tool })}
                  >
                    <AppWindowIcon aria-hidden="true" data-icon="inline-start" />
                    {t('settings.mcpOpenApp', { tool })}
                  </Button>
                </div>
              ))}
            </>
          ) : (
            <p role="alert" className="flex items-start gap-1.5 pl-7 text-caption text-pretty text-destructive">
              <CircleXIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
              <span>{result.error}</span>
            </p>
          ))}
      </div>
    )
  }

  return (
    <>
      <SettingsGroup
        title={t('settings.mcpYours')}
        action={
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            aria-label={t('settings.mcpAdd')}
            title={t('settings.mcpAdd')}
            onClick={() => setAdding(true)}
          >
            <PlusIcon aria-hidden="true" />
          </Button>
        }
      >
        {mine.length > 0 ? (
          mine.map(renderRow)
        ) : (
          <p className="p-3 text-ui text-muted-foreground">{t('settings.mcpNone')}</p>
        )}
      </SettingsGroup>

      {theirs.length > 0 && (
        <SettingsGroup title={t('settings.mcpProjectServers', { name: currentProject?.name ?? '' })}>
          {theirs.map(renderRow)}
        </SettingsGroup>
      )}

      {[...(list?.errors ?? []), ...(error ? [error] : [])].map((message, index) => (
        <p key={`${index}:${message}`} role="alert" className="text-ui text-pretty text-destructive">
          {message}
        </p>
      ))}

      {appView && (
        <McpAppDialog
          server={appView.server}
          tool={appView.tool}
          projectId={projectId}
          onClose={() => setAppView(null)}
        />
      )}

      {adding && <McpServerDialog onSave={add} onClose={() => setAdding(false)} />}
    </>
  )
}

export default McpServers
