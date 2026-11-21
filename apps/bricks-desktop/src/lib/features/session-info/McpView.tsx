// MCP servers of the session (`/mcp`): name and state as the engine reports
// them. Read-only: no installation or management here.
import { useEffect, useRef, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Badge } from '$lib/components/ui/badge'
import { errorMessage, sessionMcp, type McpServerInfo } from '$lib/ipc/client'
import EmptyState from '$lib/layout/EmptyState'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import type { InspectorState } from '$lib/state/ui'
import { mcpStatusView } from './format'

// Opened without options: the view shows the conversation on screen.
export function McpView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  const sessionId = conv?.sessionId ?? null
  const running = conv?.running ?? false

  const [servers, setServers] = useState<McpServerInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  /** Only the newest read may write the view (a slower earlier one is dropped). */
  const loadTokenRef = useRef(0)

  // Read on open, and again when a run starts or ends: servers connect at the
  // first run of the session.
  useEffect(() => {
    if (!sessionId) {
      loadTokenRef.current += 1
      setServers(null)
      setLoadError(null)
      return
    }
    const token = ++loadTokenRef.current
    void sessionMcp(sessionId).then(
      (next) => {
        if (token !== loadTokenRef.current) return
        setServers(next)
        setLoadError(null)
      },
      (e: unknown) => {
        if (token !== loadTokenRef.current) return
        setLoadError(errorMessage(e))
      },
    )
    return () => {
      loadTokenRef.current += 1
    }
  }, [sessionId, running])

  if (!conv || !sessionId) {
    return <EmptyState title={t('common.noOpenConversation2')} />
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('sessionInfo.couldNotReadTheMcpServers', { loadError })}
      </p>
    )
  }

  if (servers === null) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('sessionInfo.loadingMcpServers')}
      </p>
    )
  }

  if (servers.length === 0) {
    return <EmptyState title={t('sessionInfo.noMcpServerForThisProject')} />
  }

  return (
    <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
      {servers.map((server, i) => {
        const view = mcpStatusView(server.status)
        return (
          <li
            key={i}
            className="flex min-w-0 flex-col gap-1 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <span className="min-w-0 font-mono text-sm break-all">{server.name}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">
              <Badge
                variant={
                  view.tone === 'error'
                    ? 'destructive'
                    : view.tone === 'success'
                      ? 'secondary'
                      : 'outline'
                }
              >
                {view.label}
              </Badge>
              {view.detail && (
                <span className="min-w-0 text-xs break-words text-muted-foreground">{view.detail}</span>
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export default McpView
