import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useGroupRef, type GroupImperativeHandle, type Layout, type LayoutChangedMeta } from 'react-resizable-panels'
import { useUi } from '$lib/state/ui'
import { t, useLanguage } from '$lib/i18n/i18n'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '$lib/components/ui/resizable'
import { Sheet, SheetContent, SheetTitle } from '$lib/components/ui/sheet'
import TopBar from './TopBar'
import {
  LAYOUT_DEFAULTS,
  LAYOUT_LIMITS,
  TERMINAL_RATIO,
  WIDE_BREAKPOINT,
  layoutModeFor,
} from './constants'
import {
  clampRatio,
  fitSidebars,
  fitTerminalRatio,
  migrateTerminalRatio,
  toPercent,
  toPx,
} from './geometry'
import type { ShellControls, ShellLayout } from './types'

/** Opening and closing a side panel: the duration of shadcn's sidebar (200 ms, linear). */
const SIDE_ANIMATION_MS = 200

export interface AppShellProps {
  /** Left navigation column (inline at >= 800px, Sheet below). */
  left?: ReactNode
  /** Conversation column. Always mounted, so its state survives panel toggles. */
  center: ReactNode
  /** Right context column (inline at >= 1200px, Sheet below). */
  right?: ReactNode
  /** Bottom terminal pane inside the centre column. Mounted only while open; receives the hide action. */
  terminal?: (hide: () => void) => ReactNode
  /** Top bar. Receives the toggle controls; defaults to a plain TopBar with those toggles. */
  topbar?: (controls: ShellControls) => ReactNode
  /** User preferences. Automatic collapses never change these. */
  leftOpen?: boolean
  onLeftOpenChange?: (open: boolean) => void
  rightOpen?: boolean
  onRightOpenChange?: (open: boolean) => void
  terminalOpen?: boolean
  onTerminalOpenChange?: (open: boolean) => void
  /** Preferred inline widths, in px. */
  leftWidth?: number
  onLeftWidthChange?: (width: number) => void
  rightWidth?: number
  onRightWidthChange?: (width: number) => void
  /**
   * Terminal share of the centre column, 0.1–0.8. `null` while no ratio is saved:
   * it is then derived once from `legacyTerminalHeight` (the saved pixel height).
   */
  terminalRatio?: number | null
  onTerminalRatioChange?: (ratio: number | null) => void
  /** Saved terminal height in px (legacy preference). Undefined until preferences are loaded. */
  legacyTerminalHeight?: number
  /** Called after the user resizes or toggles a pane (debounced ~300 ms). Not called for automatic changes. */
  onLayoutChange?: (layout: ShellLayout) => void
}

function applyLayout(group: GroupImperativeHandle | null, targets: Layout): void {
  if (!group) return
  const keys = Object.keys(targets)
  if (keys.length === 0) return
  try {
    const current = group.getLayout()
    const currentKeys = Object.keys(current)
    const same =
      currentKeys.length === keys.length &&
      keys.every((key) => key in current && Math.abs((current[key] ?? 0) - targets[key]) < 0.1)
    if (!same) group.setLayout(targets)
  } catch {
    // Panel mount/unmount mid-frame can throw before registration completes.
  }
}

export function AppShell({
  left,
  center,
  right,
  terminal,
  topbar,
  leftOpen: leftOpenProp,
  onLeftOpenChange,
  rightOpen: rightOpenProp,
  onRightOpenChange,
  terminalOpen: terminalOpenProp,
  onTerminalOpenChange,
  leftWidth: leftWidthProp,
  onLeftWidthChange,
  rightWidth: rightWidthProp,
  onRightWidthChange,
  terminalRatio: terminalRatioProp,
  onTerminalRatioChange,
  legacyTerminalHeight,
  onLayoutChange,
}: AppShellProps) {
  useLanguage()
  const settingsOpen = useUi((s) => s.settingsOpen)

  const [internalLeftOpen, setInternalLeftOpen] = useState(true)
  const [internalRightOpen, setInternalRightOpen] = useState(true)
  const [internalTerminalOpen, setInternalTerminalOpen] = useState(false)
  const [internalLeftWidth, setInternalLeftWidth] = useState<number>(LAYOUT_DEFAULTS.leftWidth)
  const [internalRightWidth, setInternalRightWidth] = useState<number>(LAYOUT_DEFAULTS.rightWidth)
  const [internalTerminalRatio, setInternalTerminalRatio] = useState<number | null>(null)

  const leftOpen = leftOpenProp ?? internalLeftOpen
  const rightOpen = rightOpenProp ?? internalRightOpen
  const terminalOpen = terminalOpenProp ?? internalTerminalOpen
  const leftWidth = leftWidthProp ?? internalLeftWidth
  const rightWidth = rightWidthProp ?? internalRightWidth
  const terminalRatio = terminalRatioProp !== undefined ? terminalRatioProp : internalTerminalRatio

  const setLeftOpen = useCallback(
    (next: boolean) => {
      if (leftOpenProp === undefined) setInternalLeftOpen(next)
      onLeftOpenChange?.(next)
    },
    [leftOpenProp, onLeftOpenChange],
  )

  const setRightOpen = useCallback(
    (next: boolean) => {
      if (rightOpenProp === undefined) setInternalRightOpen(next)
      onRightOpenChange?.(next)
    },
    [rightOpenProp, onRightOpenChange],
  )

  const setTerminalOpen = useCallback(
    (next: boolean) => {
      if (terminalOpenProp === undefined) setInternalTerminalOpen(next)
      onTerminalOpenChange?.(next)
    },
    [terminalOpenProp, onTerminalOpenChange],
  )

  const setLeftWidth = useCallback(
    (next: number) => {
      if (leftWidthProp === undefined) setInternalLeftWidth(next)
      onLeftWidthChange?.(next)
    },
    [leftWidthProp, onLeftWidthChange],
  )

  const setRightWidth = useCallback(
    (next: number) => {
      if (rightWidthProp === undefined) setInternalRightWidth(next)
      onRightWidthChange?.(next)
    },
    [rightWidthProp, onRightWidthChange],
  )

  const setTerminalRatio = useCallback(
    (next: number | null) => {
      if (terminalRatioProp === undefined) setInternalTerminalRatio(next)
      onTerminalRatioChange?.(next)
    },
    [terminalRatioProp, onTerminalRatioChange],
  )

  // Measured sizes of the horizontal body and the centre column, in px.
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const centerRef = useRef<HTMLDivElement | null>(null)
  const [bodyWidth, setBodyWidth] = useState(0)
  const [centerHeight, setCenterHeight] = useState(0)
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth : WIDE_BREAKPOINT,
  )

  const hGroupRef = useGroupRef()
  const vGroupRef = useGroupRef()

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    const bodyEl = bodyRef.current
    const centerEl = centerRef.current
    if (!bodyEl && !centerEl) return
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === bodyEl) setBodyWidth(entry.contentRect.width)
        else if (entry.target === centerEl) setCenterHeight(entry.contentRect.height)
      }
    })
    if (bodyEl) {
      setBodyWidth(bodyEl.clientWidth)
      observer.observe(bodyEl)
    }
    if (centerEl) {
      setCenterHeight(centerEl.clientHeight)
      observer.observe(centerEl)
    }
    return () => observer.disconnect()
  }, [])

  // Breakpoints. Viewport width decides the layout mode; it never writes preferences.
  const mode = layoutModeFor(viewportWidth)
  const leftIsOverlay = mode === 'narrow'
  const rightIsOverlay = mode !== 'wide'

  // Temporary Sheets opened by the user in overlay modes. Closed on every breakpoint change.
  const [leftOverlay, setLeftOverlay] = useState(false)
  const [rightOverlay, setRightOverlay] = useState(false)

  useEffect(() => {
    setLeftOverlay(false)
    setRightOverlay(false)
  }, [mode])

  // The settings page covers the window: a Sheet left open would stay above it.
  useEffect(() => {
    if (settingsOpen) {
      setLeftOverlay(false)
      setRightOverlay(false)
    }
  }, [settingsOpen])

  // Inline visibility: preference AND not forced into an overlay.
  const leftInline = Boolean(left) && leftOpen && !leftIsOverlay
  const rightInline = Boolean(right) && rightOpen && !rightIsOverlay
  const leftMounted = Boolean(left) && !leftIsOverlay
  const rightMounted = Boolean(right) && !rightIsOverlay
  const terminalInline = Boolean(terminal) && terminalOpen

  /** True for one animation after a side opens or closes; dragging and window resizes stay immediate. */
  const [animating, setAnimating] = useState(false)
  const sidesSeenRef = useRef<string | null>(null)
  const animationTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    const sides = `${leftInline}:${rightInline}`
    if (sidesSeenRef.current !== null && sidesSeenRef.current !== sides) {
      setAnimating(true)
      clearTimeout(animationTimerRef.current)
      animationTimerRef.current = setTimeout(() => setAnimating(false), SIDE_ANIMATION_MS + 60)
    }
    sidesSeenRef.current = sides
  }, [leftInline, rightInline])

  useEffect(() => () => clearTimeout(animationTimerRef.current), [])

  // Horizontal geometry (px -> percentage).
  const sides = fitSidebars(bodyWidth, leftInline ? leftWidth : null, rightInline ? rightWidth : null)
  const leftPct = bodyWidth > 0 ? (sides.left === null ? 0 : toPercent(sides.left, bodyWidth)) : leftInline ? 20 : 0
  const rightPct = bodyWidth > 0 ? (sides.right === null ? 0 : toPercent(sides.right, bodyWidth)) : rightInline ? 22 : 0
  const centerPct = Math.max(0, 100 - leftPct - rightPct)
  const sideMinPct = bodyWidth > 0 ? Math.min(100, toPercent(LAYOUT_LIMITS.sideMin, bodyWidth)) : 0
  const centerMinPct = bodyWidth > 0 ? Math.min(100, toPercent(LAYOUT_LIMITS.centerMin, bodyWidth)) : 0
  const maxSidePx = (other: number | null) =>
    Math.min(LAYOUT_LIMITS.sideMax, Math.max(LAYOUT_LIMITS.sideMin, bodyWidth - LAYOUT_LIMITS.centerMin - (other ?? 0)))
  const leftMaxPct = bodyWidth > 0 ? Math.min(100, toPercent(maxSidePx(sides.right), bodyWidth)) : 100
  const rightMaxPct = bodyWidth > 0 ? Math.min(100, toPercent(maxSidePx(sides.left), bodyWidth)) : 100

  // Vertical geometry inside the centre column.
  const termPx = fitTerminalRatio(centerHeight, terminalRatio ?? TERMINAL_RATIO.fallback)
  const termPct = centerHeight > 0 ? toPercent(termPx, centerHeight) : 30
  const convPct = Math.max(0, 100 - termPct)
  const termMinPct = centerHeight > 0 ? Math.min(100, toPercent(LAYOUT_LIMITS.terminalMin, centerHeight)) : 0
  const termMaxPct =
    centerHeight > 0
      ? Math.min(100, toPercent(Math.max(LAYOUT_LIMITS.terminalMin, centerHeight - LAYOUT_LIMITS.conversationMin), centerHeight))
      : 100
  const convMinPct = centerHeight > 0 ? Math.min(100, toPercent(LAYOUT_LIMITS.conversationMin, centerHeight)) : 0

  useLayoutEffect(() => {
    if (bodyWidth <= 0) return
    const targets: Layout = {}
    if (leftMounted) targets['bricks-left'] = leftInline ? leftPct : 0
    targets['bricks-center'] = centerPct
    if (rightMounted) targets['bricks-right'] = rightInline ? rightPct : 0
    applyLayout(hGroupRef.current, targets)
    // `animating` re-applies the targets once the panels hold their new constraints: a side that
    // closes is collapsible from then on, so it reaches 0 instead of stopping at its minimum width.
  }, [bodyWidth, leftMounted, rightMounted, leftInline, rightInline, leftPct, centerPct, rightPct, hGroupRef, animating])

  useLayoutEffect(() => {
    if (centerHeight <= 0) return
    const targets: Layout = terminalInline
      ? { 'bricks-conversation': convPct, 'bricks-terminal': termPct }
      : { 'bricks-conversation': 100 }
    applyLayout(vGroupRef.current, targets)
  }, [centerHeight, terminalInline, convPct, termPct, vGroupRef])

  // Latest layout state ref for debounced change emission.
  const latestLayoutRef = useRef<ShellLayout>({
    leftOpen,
    rightOpen,
    terminalOpen,
    leftWidth,
    rightWidth,
    terminalRatio: clampRatio(terminalRatio ?? TERMINAL_RATIO.fallback),
  })
  latestLayoutRef.current = {
    leftOpen,
    rightOpen,
    terminalOpen,
    leftWidth,
    rightWidth,
    terminalRatio: clampRatio(terminalRatio ?? TERMINAL_RATIO.fallback),
  }

  const lastEmittedRef = useRef<string>(JSON.stringify(latestLayoutRef.current))
  const emitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const onLayoutChangeRef = useRef(onLayoutChange)
  onLayoutChangeRef.current = onLayoutChange

  const scheduleEmit = useCallback((override?: Partial<ShellLayout>) => {
    if (override) {
      latestLayoutRef.current = { ...latestLayoutRef.current, ...override }
    }
    clearTimeout(emitTimerRef.current)
    emitTimerRef.current = setTimeout(() => {
      const current = latestLayoutRef.current
      const key = JSON.stringify(current)
      if (key === lastEmittedRef.current) return
      lastEmittedRef.current = key
      onLayoutChangeRef.current?.(current)
    }, 300)
  }, [])

  useEffect(() => () => clearTimeout(emitTimerRef.current), [])

  // One-time migration: a saved pixel height becomes a share of the centre column.
  useEffect(() => {
    const ratio = migrateTerminalRatio(terminalRatio, legacyTerminalHeight, centerHeight)
    if (ratio === null) return
    setTerminalRatio(ratio)
    lastEmittedRef.current = ''
    scheduleEmit({ terminalRatio: ratio })
  }, [terminalRatio, legacyTerminalHeight, centerHeight, setTerminalRatio, scheduleEmit])

  // Focus restoration after dragging a handle.
  const focusBeforeDragRef = useRef<HTMLElement | null>(null)
  const onHandlePointerDown = useCallback(() => {
    const active = document.activeElement
    focusBeforeDragRef.current =
      active instanceof HTMLElement && !active.hasAttribute('data-separator') ? active : null
    const restore = () => {
      window.removeEventListener('pointerup', restore)
      window.removeEventListener('pointercancel', restore)
      const previous = focusBeforeDragRef.current
      focusBeforeDragRef.current = null
      if (previous && previous.isConnected) previous.focus({ preventScroll: true })
    }
    window.addEventListener('pointerup', restore, { once: true })
    window.addEventListener('pointercancel', restore, { once: true })
  }, [])

  const onHorizontalLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (bodyWidth <= 0 || !meta.isUserInteraction) return
      const next: Partial<ShellLayout> = {}
      if (leftMounted && leftInline) {
        const size = layout['bricks-left'] ?? 0
        if (size > 0) {
          const px = toPx(size, bodyWidth)
          setLeftWidth(px)
          next.leftWidth = px
        }
      }
      if (rightMounted && rightInline) {
        const size = layout['bricks-right'] ?? 0
        if (size > 0) {
          const px = toPx(size, bodyWidth)
          setRightWidth(px)
          next.rightWidth = px
        }
      }
      scheduleEmit(next)
    },
    [bodyWidth, leftMounted, leftInline, rightMounted, rightInline, setLeftWidth, setRightWidth, scheduleEmit],
  )

  const onVerticalLayoutChanged = useCallback(
    (layout: Layout, meta: LayoutChangedMeta) => {
      if (!terminalInline || centerHeight <= 0 || !meta.isUserInteraction) return
      const size = layout['bricks-terminal'] ?? 0
      const ratio = clampRatio(size / 100)
      setTerminalRatio(ratio)
      scheduleEmit({ terminalRatio: ratio })
    },
    [terminalInline, centerHeight, setTerminalRatio, scheduleEmit],
  )

  const toggleLeft = useCallback(() => {
    if (leftIsOverlay) {
      setLeftOverlay((v) => !v)
    } else {
      const next = !leftOpen
      setLeftOpen(next)
      scheduleEmit({ leftOpen: next })
    }
  }, [leftIsOverlay, leftOpen, setLeftOpen, scheduleEmit])

  const toggleRight = useCallback(() => {
    if (rightIsOverlay) {
      setRightOverlay((v) => !v)
    } else {
      const next = !rightOpen
      setRightOpen(next)
      scheduleEmit({ rightOpen: next })
    }
  }, [rightIsOverlay, rightOpen, setRightOpen, scheduleEmit])

  const toggleTerminal = useCallback(() => {
    const next = !terminalOpen
    setTerminalOpen(next)
    scheduleEmit({ terminalOpen: next })
  }, [terminalOpen, setTerminalOpen, scheduleEmit])

  const hideTerminal = useCallback(() => {
    if (terminalOpen) toggleTerminal()
  }, [terminalOpen, toggleTerminal])

  const controls: ShellControls = useMemo(
    () => ({
      leftPressed: leftIsOverlay ? leftOverlay : leftOpen,
      rightPressed: rightIsOverlay ? rightOverlay : rightOpen,
      terminalPressed: terminalOpen,
      onToggleLeft: left ? toggleLeft : undefined,
      onToggleRight: right ? toggleRight : undefined,
      onToggleTerminal: terminal ? toggleTerminal : undefined,
    }),
    [leftIsOverlay, leftOverlay, leftOpen, rightIsOverlay, rightOverlay, rightOpen, terminalOpen, left, right, terminal, toggleLeft, toggleRight, toggleTerminal],
  )

  return (
    <>
      <div className="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-sidebar text-foreground">
        <h1 className="sr-only">Bricks</h1>
        {topbar ? topbar(controls) : <TopBar {...controls} />}

        {/* The frame (top bar and left panel) shares one colour; the conversation and the right panel
            sit on one rounded surface inset in it. */}
        <div
          className={`min-h-0 flex-1 pr-2 pb-2 transition-[padding] duration-200 ease-linear ${!(leftInline && left) ? 'pl-2' : ''}`}
        >
          <div ref={bodyRef} className="h-full w-full">
            <ResizablePanelGroup
              orientation="horizontal"
              groupRef={hGroupRef}
              onLayoutChanged={onHorizontalLayoutChanged}
              className="flex h-full w-full"
              data-animating={animating ? '' : undefined}
            >
              {leftMounted && left && (
                <>
                  <ResizablePanel
                    id="bricks-left"
                    defaultSize={`${leftInline ? leftPct : 0}%`}
                    minSize={leftInline ? `${sideMinPct}%` : '0%'}
                    maxSize={`${leftMaxPct}%`}
                    collapsible={animating || !leftInline}
                    collapsedSize="0%"
                  >
                    <div
                      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground"
                      inert={!leftInline}
                      style={{ minWidth: leftInline ? undefined : `${sides.left ?? leftWidth}px` }}
                    >
                      {left}
                    </div>
                  </ResizablePanel>
                  {leftInline && (
                    <ResizableHandle
                      className="bg-transparent"
                      aria-label={t('layout.resizeTheLeftPanel')}
                      onPointerDown={onHandlePointerDown}
                    />
                  )}
                </>
              )}

              <ResizablePanel id="bricks-center" defaultSize={`${centerPct}%`} minSize={`${centerMinPct}%`}>
                <div
                  ref={centerRef}
                  className={`flex h-full min-w-0 flex-col overflow-hidden border-y border-l border-border-subtle bg-background ${
                    rightInline && right ? 'rounded-l-xl' : 'rounded-xl border-r'
                  }`}
                >
                  <ResizablePanelGroup
                    orientation="vertical"
                    groupRef={vGroupRef}
                    onLayoutChanged={onVerticalLayoutChanged}
                    className="flex h-full w-full flex-col"
                  >
                    <ResizablePanel id="bricks-conversation" defaultSize={`${convPct}%`} minSize={`${convMinPct}%`}>
                      <main aria-label={t('common.conversation')} className="flex h-full min-h-0 min-w-0 flex-col bg-background">
                        {center}
                      </main>
                    </ResizablePanel>
                    {terminalInline && terminal && (
                      <>
                        <ResizableHandle
                          className="bg-border-subtle"
                          aria-label={t('layout.resizeTheTerminal')}
                          onPointerDown={onHandlePointerDown}
                        />
                        <ResizablePanel
                          id="bricks-terminal"
                          defaultSize={`${termPct}%`}
                          minSize={`${termMinPct}%`}
                          maxSize={`${termMaxPct}%`}
                        >
                          <section aria-label={t('common.terminal')} className="flex h-full min-h-0 flex-col bg-background">
                            {terminal(hideTerminal)}
                          </section>
                        </ResizablePanel>
                      </>
                    )}
                  </ResizablePanelGroup>
                </div>
              </ResizablePanel>

              {rightMounted && right && (
                <>
                  {rightInline && (
                    <ResizableHandle
                      className="border-y border-border-subtle bg-background"
                      aria-label={t('layout.resizeTheRightPanel')}
                      onPointerDown={onHandlePointerDown}
                    />
                  )}
                  <ResizablePanel
                    id="bricks-right"
                    defaultSize={`${rightInline ? rightPct : 0}%`}
                    minSize={rightInline ? `${sideMinPct}%` : '0%'}
                    maxSize={`${rightMaxPct}%`}
                    collapsible={animating || !rightInline}
                    collapsedSize="0%"
                  >
                    {/* While it closes, the panel keeps its width and slides out: nothing in it reflows or stays visible. */}
                    <div className="flex h-full min-h-0 justify-end overflow-hidden">
                      <aside
                        aria-label={t('common.context')}
                        inert={!rightInline}
                        className="flex h-full min-h-0 w-full min-w-0 shrink-0 flex-col overflow-hidden rounded-r-xl border-y border-r border-border-subtle bg-background text-foreground"
                        style={{ minWidth: rightInline ? undefined : `${sides.right ?? rightWidth}px` }}
                      >
                        {right}
                      </aside>
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
          </div>
        </div>
      </div>

      {left && leftIsOverlay && (
        <Sheet open={leftOverlay} onOpenChange={setLeftOverlay}>
          <SheetContent side="left" className="gap-0 p-0" style={{ width: 'min(20rem, 88vw)' }}>
            <SheetTitle className="sr-only">{t('layout.leftPanel')}</SheetTitle>
            <div className="flex h-full min-h-0 flex-col overflow-hidden">{left}</div>
          </SheetContent>
        </Sheet>
      )}

      {right && rightIsOverlay && (
        <Sheet open={rightOverlay} onOpenChange={setRightOverlay}>
          <SheetContent
            side="right"
            className="gap-0 p-0 data-[side=right]:sm:max-w-none"
            style={{ width: `min(${rightWidth}px, 92vw)` }}
          >
            <SheetTitle className="sr-only">{t('layout.rightPanel')}</SheetTitle>
            <aside aria-label={t('common.context')} className="flex h-full min-h-0 flex-col overflow-hidden">
              {right}
            </aside>
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}

export default AppShell
