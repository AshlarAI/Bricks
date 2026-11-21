// Tools of the session (`/tools`): name, description, permission level and
// the decision of the session's permission policy.
import { useEffect, useRef, useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Badge } from '$lib/components/ui/badge'
import { Input } from '$lib/components/ui/input'
import { errorMessage, sessionTools, type SessionToolInfo } from '$lib/ipc/client'
import EmptyState from '$lib/layout/EmptyState'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import type { InspectorState } from '$lib/state/ui'
import { decisionLabel, decisionVariant, levelLabel, matchesTool } from './format'

// Opened without options: the view shows the conversation on screen.
export function ToolsView({ args: _args }: { args: InspectorState['args'] }) {
  useLanguage()
  const conv = useApp((s) => s.current)
  useConversation(conv)

  const sessionId = conv?.sessionId ?? null
  const running = conv?.running ?? false
  const permissionsRevision = conv?.permissions?.revision ?? null

  const [tools, setTools] = useState<SessionToolInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  /** Only the newest read may write the view (a slower earlier one is dropped). */
  const loadTokenRef = useRef(0)

  // Read on open, and again when a run ends or the policy changes.
  useEffect(() => {
    if (!sessionId) {
      loadTokenRef.current += 1
      setTools(null)
      setLoadError(null)
      return
    }
    const token = ++loadTokenRef.current
    void sessionTools(sessionId).then(
      (next) => {
        if (token !== loadTokenRef.current) return
        setTools(next)
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
  }, [sessionId, running, permissionsRevision])

  const visible = tools ? tools.filter((tool) => matchesTool(tool, filter)) : []

  if (!conv || !sessionId) {
    return <EmptyState title={t('common.noOpenConversation2')} />
  }

  if (loadError) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {t('sessionInfo.couldNotReadTheTools', { loadError })}
      </p>
    )
  }

  if (tools === null) {
    return (
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {t('sessionInfo.loadingTools')}
      </p>
    )
  }

  if (tools.length === 0) {
    return <EmptyState title={t('sessionInfo.noToolAvailable')} />
  }

  return (
    <div className="flex flex-col gap-3">
      <Input
        type="search"
        value={filter}
        onChange={(e) => setFilter(e.currentTarget.value)}
        placeholder={t('sessionInfo.filterByNameOrDescription')}
        aria-label={t('sessionInfo.filterTools')}
        autoComplete="off"
      />

      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t('sessionInfo.noToolMatches', { filter: filter.trim() })}
        </p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {visible.length === tools.length
              ? t('sessionInfo.toolCount', { count: tools.length })
              : t('sessionInfo.ofTools', { visible: visible.length, count: tools.length })}
          </p>
          <ScrollArea className="rounded-lg border border-border" orientation="horizontal">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <caption className="sr-only">{t('sessionInfo.sessionToolsWithTheirLevelAnd')}</caption>
              <thead className="bg-muted text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('sessionInfo.tool')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('sessionInfo.level')}
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    {t('sessionInfo.decision')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((tool, i) => (
                  <tr key={i} className="align-top">
                    <th scope="row" className="px-3 py-2 font-mono text-xs font-medium break-all">
                      {tool.name}
                      {tool.description && (
                        <p className="mt-0.5 font-sans text-xs font-normal text-muted-foreground">
                          {tool.description}
                        </p>
                      )}
                    </th>
                    <td className="px-3 py-2 whitespace-nowrap">{levelLabel(tool.level)}</td>
                    <td className="px-3 py-2">
                      <Badge variant={decisionVariant(tool.decision)} title={tool.reason}>
                        {decisionLabel(tool.decision)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollArea>
        </>
      )}
    </div>
  )
}

export default ToolsView
