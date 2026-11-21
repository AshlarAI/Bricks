// The terminals of every project: which ones exist, which one is shown for each
// project. The sessions live here, not in the component: the pane unmounts when it
// is closed, but the shells, their scrollback and their xterm instances survive,
// and the component attaches the active one again on mount. Each terminal belongs
// to the project it was opened for.

import { ObservableStore, useStoreSelector, useStoreVersion } from '$lib/state/observable'
import { TerminalSession, type TerminalDeps } from './terminal-session'

const EMPTY_SESSIONS: TerminalSession[] = []

export class TerminalStore extends ObservableStore {
  #sessions = new Map<string, TerminalSession[]>()
  #active = new Map<string, string>()
  #seeded = new Set<string>()
  #unsubscribes = new Map<string, () => void>()
  readonly #deps: TerminalDeps

  constructor(deps: TerminalDeps) {
    super()
    this.#deps = deps
  }

  list(projectId: string): TerminalSession[] {
    return this.#sessions.get(projectId) ?? EMPTY_SESSIONS
  }

  activeId(projectId: string): string | null {
    return this.#active.get(projectId) ?? null
  }

  /** Opens the first terminal of a project, once per application run. */
  seed(projectId: string, sessionId: string | null): void {
    if (this.#seeded.has(projectId)) return
    this.#seeded.add(projectId)
    this.create(projectId, sessionId)
  }

  create(projectId: string, sessionId: string | null): TerminalSession {
    const session = new TerminalSession(projectId, sessionId, this.#deps)
    this.#unsubscribes.set(
      session.id,
      session.subscribe(() => this.emit()),
    )
    this.#sessions.set(projectId, [...this.list(projectId), session])
    this.#active.set(projectId, session.id)
    this.emit()
    return session
  }

  /** Makes one terminal of the project the shown one. Unknown ids are ignored. */
  activate(projectId: string, id: string): void {
    if (!this.list(projectId).some((s) => s.id === id)) return
    if (this.#active.get(projectId) === id) return
    this.#active.set(projectId, id)
    this.emit()
  }

  /** Kills and forgets a terminal. If it was shown, the neighbour becomes the shown one. */
  close(projectId: string, id: string): void {
    const current = this.list(projectId)
    const index = current.findIndex((s) => s.id === id)
    if (index < 0) return
    const closed = current[index]
    const remaining = current.filter((s) => s.id !== id)
    if (remaining.length > 0) this.#sessions.set(projectId, remaining)
    else this.#sessions.delete(projectId)
    if (this.activeId(projectId) === id) {
      const next = remaining[Math.min(index, remaining.length - 1)]
      if (next) this.#active.set(projectId, next.id)
      else this.#active.delete(projectId)
    }
    this.#unsubscribes.get(id)?.()
    this.#unsubscribes.delete(id)
    closed.dispose()
    this.emit()
  }

  /** Applies the current light or dark colours to every open terminal. */
  refreshTheme(): void {
    for (const sessions of this.#sessions.values()) {
      for (const session of sessions) session.refreshLook()
    }
  }

  /** Fonts changed: every terminal measures its glyphs again before it is shown. */
  refreshFonts(): void {
    for (const sessions of this.#sessions.values()) {
      for (const session of sessions) session.fontsChanged()
    }
  }
}

export function useTerminalStore(store: TerminalStore): TerminalStore
export function useTerminalStore<T>(
  store: TerminalStore,
  selector: (store: TerminalStore) => T,
  isEqual?: (a: T, b: T) => boolean,
): T
export function useTerminalStore<T>(
  store: TerminalStore,
  selector?: (store: TerminalStore) => T,
  isEqual?: (a: T, b: T) => boolean,
): TerminalStore | T {
  if (selector) {
    return useStoreSelector(store, selector, isEqual)
  }
  useStoreVersion(store)
  return store
}
