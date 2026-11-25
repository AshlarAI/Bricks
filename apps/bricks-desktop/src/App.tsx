// Root: wires the shell, the global state and the feature entry points.
// Owner: orchestrator.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { toast } from 'sonner'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Toaster } from '$lib/components/ui/sonner'
import { TooltipProvider } from '$lib/components/ui/tooltip'
import { Button } from '$lib/components/ui/button'
import AppShell from '$lib/layout/AppShell'
import TopBar from '$lib/layout/TopBar'
import EmptyState from '$lib/layout/EmptyState'
import StartSplash from '$lib/layout/StartSplash'
import type { ShellLayout } from '$lib/layout/types'
import { blockReload } from '$lib/layout/reload'
import { initTheme, setTheme, theme, useTheme } from '$lib/theme/theme'
import { appIconShow, errorMessage, keepAwakeSet } from '$lib/ipc/client'
import { keepAwakeWanted } from '$lib/state/keepAwake'
import { app, useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import { useReader } from '$lib/state/reader'
import { conversationHistory, useConversationHistory } from '$lib/state/history'
import { ui, useUi } from '$lib/state/ui'
import NavigationPanel from '$lib/features/navigation/NavigationPanel'
import ConversationView from '$lib/features/conversation/ConversationView'
import ConversationTitle from '$lib/features/conversation/ConversationTitle'
import Composer from '$lib/features/composer/Composer'
import PermissionChoice from '$lib/features/permissions/PermissionChoice'
import ContextPanel from '$lib/features/context/ContextPanel'
import PlusMenu from '$lib/features/context/PlusMenu'
import AgentBranch from '$lib/features/agents/AgentBranch'
import ChangesPanel from '$lib/features/changes/ChangesPanel'
import ReaderPanel from '$lib/features/reader/ReaderPanel'
import SearchDialog from '$lib/features/navigation/SearchDialog'
import TerminalPanel from '$lib/features/terminal/TerminalPanel'
import SettingsPage from '$lib/features/settings/SettingsPage'
import UpdateDialog from '$lib/features/updates/UpdateDialog'
import FolderMissingDialog from '$lib/features/navigation/FolderMissingDialog'
import InspectorHost from '$lib/features/commands/InspectorHost'
import WelcomeView from '$lib/features/conversation/welcome/WelcomeView'
import { prefillDraft } from '$lib/features/conversation/welcome/starters'

/** Follows the window's full-screen state; a no-op outside Tauri. */
function watchFullscreen(onChange: (fullscreen: boolean) => void): Promise<() => void> {
  try {
    const appWindow = getCurrentWindow()
    const sync = () => {
      appWindow.isFullscreen().then(
        (value) => onChange(value),
        () => {},
      )
    }
    sync()
    return appWindow.onResized(sync).catch(() => () => {})
  } catch {
    return Promise.resolve(() => {})
  }
}

export function App() {
  useLanguage()
  const { resolved: resolvedTheme } = useTheme()

  const ready = useApp((s) => s.ready)
  const startError = useApp((s) => s.startError)
  const platform = useApp((s) => s.info?.platform)
  const appIcon = useApp((s) => s.prefs.app_icon)
  const keepAwakePref = useApp((s) => s.prefs.keep_awake)
  const hasActiveRuns = useApp((s) => s.hasActiveRuns)
  const currentSessionId = useApp((s) => s.currentSessionId)
  const current = useApp((s) => s.current)
  const currentProject = useApp((s) => s.currentProject)
  const hasProviders = useApp((s) => s.hasProviders)
  const rightView = useApp((s) => s.rightView)
  const lastError = useApp((s) => s.lastError)

  const currentKeepAwake = useConversation(current, (c) => c.keepAwake) ?? false
  const currentRunning = useConversation(current, (c) => c.running) ?? false
  const currentAgentId = useUi((s) => s.agentId)
  const settingsOpen = useUi((s) => s.settingsOpen)
  const updateDialogOpen = useUi((s) => s.updateDialogOpen)
  const branchAgent = useConversation(current, (c) =>
    currentAgentId ? (c.agents.get(currentAgentId) ?? null) : null,
  ) ?? null

  const openRequests = useReader((s) => s.openRequests)
  const canGoBack = useConversationHistory((s) => s.canGoBack)
  const canGoForward = useConversationHistory((s) => s.canGoForward)

  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [leftWidth, setLeftWidth] = useState(320)
  const [rightWidth, setRightWidth] = useState(280)
  // Terminal share of the centre column. `legacyTerminalHeight` is the
  // saved pixel height, read by AppShell once to derive the ratio when none is saved.
  const [terminalRatio, setTerminalRatio] = useState<number | null>(null)
  const [legacyTerminalHeight, setLegacyTerminalHeight] = useState<number | undefined>(undefined)
  // macOS draws its window buttons over the top bar, except in full screen.
  const [fullscreen, setFullscreen] = useState(false)
  // Focus inside the composer pauses the welcome's typed line.
  const [composerFocused, setComposerFocused] = useState(false)
  const systemButtons = platform === 'macos' && !fullscreen

  // Production reload shortcut blocker.
  useEffect(() => {
    if (!import.meta.env.PROD) return
    window.addEventListener('keydown', blockReload)
    return () => window.removeEventListener('keydown', blockReload)
  }, [])

  // Startup lifecycle.
  const revealedRef = useRef(false)
  const revealWindow = useCallback(() => {
    if (revealedRef.current) return
    revealedRef.current = true
    // Wait two animation frames after the splash logo is decoded so WebKit
    // commits the painted frame before AppKit orders the window front.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        try {
          void getCurrentWindow().show().catch(() => {})
        } catch {
          // No-op outside Tauri.
        }
      })
    })
  }, [])

  useEffect(() => {
    const disposeTheme = initTheme(theme.mode)
    const unlistenResize = watchFullscreen(setFullscreen)
    const fallbackTimer = window.setTimeout(revealWindow, 500)
    void app.init().then(() => {
      const p = app.prefs
      setTheme(p.theme)
      setLeftOpen(p.left_open)
      setRightOpen(p.right_open)
      setTerminalOpen(p.terminal_open)
      setLeftWidth(p.left_width)
      setRightWidth(p.right_width)
      setTerminalRatio(p.terminal_ratio)
      setLegacyTerminalHeight(p.terminal_height)
    })
    return () => {
      window.clearTimeout(fallbackTimer)
      disposeTheme()
      void unlistenResize.then((unlisten) => unlisten())
      void app.dispose()
    }
  }, [revealWindow])

  useEffect(() => {
    if (ready) revealWindow()
  }, [ready, revealWindow])

  // Every conversation shown is a stop of the history (« Précédent » / « Suivant »).
  useEffect(() => {
    conversationHistory.visit(currentSessionId)
  }, [currentSessionId])

  // The Dock icon: the chosen one, or the one of the mode on screen. Once the
  // preferences are loaded, so the default never flashes first.
  useEffect(() => {
    if (!ready) return
    const dark = appIcon === 'dark' || (appIcon === 'aligned' && resolvedTheme === 'dark')
    appIconShow(dark).catch(() => {})
  }, [ready, appIcon, resolvedTheme])

  // Close sub-agent branch when switching conversations.
  const branchSessionRef = useRef<string | null>(null)
  useEffect(() => {
    const id = current?.sessionId ?? null
    if (id !== branchSessionRef.current) {
      branchSessionRef.current = id
      ui.closeAgent()
    }
  }, [current])

  // The computer stays awake while the preference or a running conversation asks for it.
  const keptAwakeRef = useRef(false)
  useEffect(() => {
    if (!ready) return
    const wanted = keepAwakeWanted(keepAwakePref, app.conversations.values())
    if (wanted === keptAwakeRef.current) return
    keptAwakeRef.current = wanted
    keepAwakeSet(wanted).catch((e) => {
      keptAwakeRef.current = !wanted
      toast.error(errorMessage(e))
    })
  }, [ready, keepAwakePref, hasActiveRuns, currentKeepAwake, currentRunning])

  useEffect(() => {
    if (lastError) toast.error(lastError.message)
  }, [lastError])

  // `/diff` (or any caller) sets app.rightView = 'changes': show the panel.
  useEffect(() => {
    if (rightView === 'changes' || rightView === 'reader') setRightOpen(true)
  }, [rightView])

  // Opening a file (from a summary or an edit) shows the reader, even when
  // it already was the right view of a closed column.
  useEffect(() => {
    if (openRequests > 0) {
      app.setRightView('reader')
      setRightOpen(true)
    }
  }, [openRequests])

  const onLayoutChange = useCallback((l: ShellLayout) => {
    app.setPrefs({
      left_open: l.leftOpen,
      right_open: l.rightOpen,
      terminal_open: l.terminalOpen,
      left_width: Math.round(l.leftWidth),
      right_width: Math.round(l.rightWidth),
      terminal_ratio: l.terminalRatio,
    })
  }, [])

  /** A suggestion of the welcome screen fills the composer; a draft it replaces can be given back. */
  const pickStarter = useCallback((text: string) => {
    const project = app.currentProject
    if (!project) return
    const draft = app.draftFor(project.id)
    const previous = prefillDraft(draft, text)
    app.setProjectDraft(project.id, { text: draft.text })
    app.bumpComposerFocus()
    if (previous !== null) {
      toast(t('welcome.draftReplaced'), {
        action: {
          label: t('welcome.undo'),
          onClick: () => app.setProjectDraft(project.id, { text: previous }),
        },
      })
    }
  }, [])

  const toggleReader = useCallback(() => {
    if (app.rightView === 'reader' && rightOpen) {
      app.setRightView('context')
    } else {
      app.setRightView('reader')
      setRightOpen(true)
    }
  }, [rightOpen])

  const toggleChanges = useCallback(() => {
    if (app.rightView === 'changes' && rightOpen) {
      app.setRightView('context')
    } else {
      app.setRightView('changes')
      setRightOpen(true)
    }
  }, [rightOpen])

  return (
    <TooltipProvider>
      {!ready ? (
        <StartSplash onReady={revealWindow} />
      ) : startError ? (
        <div className="grid h-screen place-items-center p-6">
          <EmptyState title={t('app.bricksCouldNotStart')} description={startError} />
        </div>
      ) : (
        /* Under the settings page the workspace stays mounted, out of reach. */
        <div className="contents" inert={settingsOpen}>
          <AppShell
            leftOpen={leftOpen}
            onLeftOpenChange={setLeftOpen}
            rightOpen={rightOpen}
            onRightOpenChange={setRightOpen}
            terminalOpen={terminalOpen}
            onTerminalOpenChange={setTerminalOpen}
            leftWidth={leftWidth}
            onLeftWidthChange={setLeftWidth}
            rightWidth={rightWidth}
            onRightWidthChange={setRightWidth}
            terminalRatio={terminalRatio}
            onTerminalRatioChange={setTerminalRatio}
            legacyTerminalHeight={legacyTerminalHeight}
            onLayoutChange={onLayoutChange}
            topbar={(controls) => (
              <TopBar
                {...controls}
                systemButtons={systemButtons}
                onBack={() => void conversationHistory.back()}
                onForward={() => void conversationHistory.forward()}
                canGoBack={canGoBack}
                canGoForward={canGoForward}
                changesPressed={rightView === 'changes' && rightOpen}
                onToggleChanges={toggleChanges}
                readerPressed={rightView === 'reader' && rightOpen}
                onToggleReader={toggleReader}
                search={<SearchDialog />}
                title={<ConversationTitle conversation={current} />}
                trailing={<PlusMenu />}
              />
            )}
            left={<NavigationPanel />}
            center={
              <>
                {current && branchAgent && (
                  <div className="flex h-full min-h-0 flex-col">
                    <AgentBranch key={branchAgent.id} conversation={current} agent={branchAgent} />
                  </div>
                )}
                {/* Kept mounted under a branch: the conversation, its scroll and its draft wait for the way back. */}
                <div className={`flex h-full min-h-0 flex-col ${branchAgent ? 'hidden' : ''}`}>
                  <div className="min-h-0 flex-1">
                    {current ? (
                      <ConversationView key={current.sessionId} conversation={current} />
                    ) : !hasProviders ? (
                      <div className="grid h-full place-items-center p-6">
                        <EmptyState
                          title={t('app.noProviderConfigured')}
                          action={
                            <Button variant="ghost" size="sm" onClick={() => ui.openSettings()}>
                              {t('app.openSettings')}
                            </Button>
                          }
                        />
                      </div>
                    ) : currentProject ? (
                      <WelcomeView onPick={pickStarter} paused={composerFocused} />
                    ) : null}
                  </div>
                  <PermissionChoice conversation={current} />
                  <div
                    className="contents"
                    onFocus={() => setComposerFocused(true)}
                    onBlur={(e) => setComposerFocused(e.currentTarget.contains(e.relatedTarget as Node | null))}
                  >
                    <Composer conversation={current} />
                  </div>
                </div>
              </>
            }
            right={
              rightView === 'changes' ? (
                <ChangesPanel />
              ) : rightView === 'reader' ? (
                <ReaderPanel conversation={current} />
              ) : (
                <ContextPanel />
              )
            }
            terminal={(hide) => <TerminalPanel onHide={hide} />}
          />
        </div>
      )}
      {/* Reachable whatever the state of the app, a failed start included. */}
      {settingsOpen && <SettingsPage systemButtons={systemButtons} />}
      <UpdateDialog open={updateDialogOpen} onOpenChange={(open) => ui.setUpdateDialogOpen(open)} />
      <FolderMissingDialog />
      <InspectorHost />
      <Toaster richColors />
    </TooltipProvider>
  )
}

export default App
