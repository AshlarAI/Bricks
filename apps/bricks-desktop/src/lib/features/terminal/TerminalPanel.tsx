// Bottom pane: interactive shells on a real PTY, one set per project.
// The sessions live in terminals.ts (store and session rules in
// terminal-store / terminal-session); this component only shows the active
// one.
import { useEffect, useRef } from 'react'
import '@xterm/xterm/css/xterm.css'
import { PlusIcon, RotateCwIcon, XIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { ToggleGroup, ToggleGroupItem } from '$lib/components/ui/toggle-group'
import EmptyState from '$lib/layout/EmptyState'
import { useApp } from '$lib/state/app'
import { useTheme } from '$lib/theme/theme'
import { terminals, useTerminals } from './terminals'

export interface TerminalPanelProps {
  /** Hides the pane (its sessions keep running); owned by the shell's `terminalOpen`. */
  onHide?: () => void
}

export function TerminalPanel({ onHide }: TerminalPanelProps) {
  useLanguage()
  const { resolved: resolvedTheme } = useTheme()
  const projectId = useApp((s) => s.currentProjectId)
  const currentSessionId = useApp((s) => s.current?.sessionId ?? null)
  const terminalStore = useTerminals()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const sessionIdRef = useRef<string | null>(currentSessionId)
  sessionIdRef.current = currentSessionId

  const list = projectId ? terminalStore.list(projectId) : []
  const activeId = projectId ? terminalStore.activeId(projectId) : null
  const active = list.find((s) => s.id === activeId) ?? null
  const activeName = active ? t('terminal.terminal', { value: list.indexOf(active) + 1 }) : t('common.terminal')

  // The first terminal of a project opens by itself, once per application run.
  useEffect(() => {
    if (!projectId) return
    terminals.seed(projectId, sessionIdRef.current)
  }, [projectId])

  // Show the active terminal here, start its shell if needed, and keep its
  // size in step with the pane. The cleanup runs before the next terminal is
  // attached (tab switch, project switch) and when the pane closes: it takes
  // this terminal out of the container, without disposing it.
  useEffect(() => {
    const element = containerRef.current
    if (!active || !element) return
    active.attach(element)
    if (active.status === 'idle') active.start()
    active.focus()
    const observer = new ResizeObserver(() => active.requestRefit())
    observer.observe(element)
    return () => {
      observer.disconnect()
      active.detach()
    }
  }, [active])

  // Terminal colours follow the theme. Read after the `.dark` class is set.
  useEffect(() => {
    void resolvedTheme
    terminals.refreshTheme()
  }, [resolvedTheme])

  function select(id: string) {
    if (projectId) terminals.activate(projectId, id)
  }

  function close(id: string) {
    if (projectId) terminals.close(projectId, id)
  }

  function create() {
    if (projectId) terminals.create(projectId, sessionIdRef.current)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-code-bg">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border bg-background px-2">
        <ScrollArea orientation="horizontal" className="min-w-0 flex-1">
          <ToggleGroup
            type="single"
            spacing={1}
            aria-label={t('terminal.projectTerminals')}
            className="w-max"
            value={activeId ?? ''}
            onValueChange={(id) => {
              if (id) select(id)
            }}
          >
            {list.map((session, index) => (
              <div key={session.id} className="flex shrink-0 items-center rounded-md has-data-[state=on]:bg-element-selected">
                <ToggleGroupItem
                  value={session.id}
                  className="h-6 min-w-0 px-2 text-xs font-normal hover:bg-transparent data-[state=on]:bg-transparent"
                >
                  {t('terminal.terminal', { value: index + 1 })}
                </ToggleGroupItem>
                <button
                  type="button"
                  className="rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t('terminal.closeTerminal', { value: index + 1 })}
                  title={t('terminal.closeTheTerminal')}
                  onClick={() => close(session.id)}
                >
                  <XIcon className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
          </ToggleGroup>
        </ScrollArea>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('terminal.newTerminal')}
          title={t('terminal.newTerminal')}
          disabled={!projectId}
          onClick={create}
        >
          <PlusIcon aria-hidden="true" />
        </Button>
        {onHide && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={t('common.hideTheTerminal')}
            title={t('common.hideTheTerminal')}
            onClick={onHide}
          >
            <XIcon aria-hidden="true" />
          </Button>
        )}
      </div>

      {active?.cwd ? (
        <p className="truncate px-3 pt-1 font-mono text-xs text-muted-foreground" title={active.cwd}>
          {active.cwd}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1">
        <div ref={containerRef} role="group" aria-label={activeName} className="absolute inset-0 px-2 py-1" />

        {!active ? (
          <div className="absolute inset-0 flex items-center justify-center bg-code-bg">
            <EmptyState
              title={projectId ? t('terminal.noTerminalOpen') : t('common.noOpenProject')}
              description={projectId ? t('terminal.openATerminalInTheProject') : t('terminal.chooseAProjectToOpenA')}
              action={
                projectId ? (
                  <Button variant="outline" size="sm" onClick={create}>
                    {t('terminal.newTerminal')}
                  </Button>
                ) : undefined
              }
            />
          </div>
        ) : active.status === 'exited' ? (
          <div
            role="status"
            className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-border bg-card px-3 py-2 text-xs text-card-foreground"
          >
            <span>
              {t('terminal.processFinished', {
                value: active.exitCode !== null ? t('terminal.code', { exitCode: active.exitCode }) : '',
              })}
            </span>
            <Button variant="outline" size="sm" onClick={() => active.restart()}>
              <RotateCwIcon aria-hidden="true" data-icon="inline-start" />
              {t('terminal.restart')}
            </Button>
          </div>
        ) : active.status === 'error' ? (
          <div
            role="alert"
            className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 border-t border-border bg-card px-3 py-2 text-xs text-destructive"
          >
            <span className="min-w-0 truncate">{t('terminal.couldNotStartTheTerminal', { error: active.error })}</span>
            <Button variant="outline" size="sm" onClick={() => active.restart()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default TerminalPanel
