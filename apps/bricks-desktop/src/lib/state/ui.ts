// Inspector views opened by `/` commands or menus. One view at a time,
// rendered by `features/commands/InspectorHost`. Owner: orchestrator.

import { ObservableStore, useStoreSelector, useStoreVersion } from './observable'

export type InspectorView =
  | 'help'
  | 'search'
  | 'memory'
  | 'context'
  | 'cost'
  | 'session'
  | 'sessions'
  | 'tools'
  | 'mcp'
  | 'config'
  | 'agents'
  | 'skills'
  | 'jobs'
  | 'changeset'
  | 'clear'
  | 'file'

export interface InspectorState {
  view: InspectorView
  /** View options: `details` (context, cost), `query`, `changesetId`, `agentId`, `projectId`/`path`/`line`/`endLine` (file)... */
  args: Record<string, string | boolean | undefined>
}

/** Pickers of the composer that a command can open. */
export type ComposerPicker = 'model' | 'effort' | null

class UiStore extends ObservableStore {
  inspector: InspectorState | null = null
  /** Set by `/model`, `/effort`; the composer opens the matching select and resets it. */
  picker: ComposerPicker = null
  /** The settings dialog (opened from the left panel footer). */
  settingsOpen = false
  /** The application update dialog (opened from the sidebar badge or settings). */
  updateDialogOpen = false
  /** The section the settings open on, taken (and reset) by the dialog. */
  settingsSection: string | null = null
  /** The sub-agent whose read-only branch is shown in the centre (from its line in the thread). */
  agentId: string | null = null

  /** Opens the settings, on `section` when given. */
  openSettings(section?: string) {
    this.settingsSection = section ?? null
    this.settingsOpen = true
    this.emit()
  }

  setSettingsOpen(open: boolean) {
    if (this.settingsOpen === open) return
    this.settingsOpen = open
    if (!open) this.settingsSection = null
    this.emit()
  }

  clearSettingsSection() {
    if (this.settingsSection === null) return
    this.settingsSection = null
    this.emit()
  }

  setUpdateDialogOpen(open: boolean) {
    if (this.updateDialogOpen === open) return
    this.updateDialogOpen = open
    this.emit()
  }

  openAgent(id: string) {
    if (this.agentId === id) return
    this.agentId = id
    this.emit()
  }

  closeAgent() {
    if (this.agentId === null) return
    this.agentId = null
    this.emit()
  }

  open(view: InspectorView, args: InspectorState['args'] = {}) {
    this.inspector = { view, args }
    this.emit()
  }

  close() {
    if (this.inspector === null) return
    this.inspector = null
    this.emit()
  }

  openPicker(p: Exclude<ComposerPicker, null>) {
    this.picker = p
    this.emit()
  }

  clearPicker() {
    if (this.picker === null) return
    this.picker = null
    this.emit()
  }
}

export const ui = new UiStore()

export function useUi(): UiStore
export function useUi<T>(selector: (store: UiStore) => T, isEqual?: (a: T, b: T) => boolean): T
export function useUi<T>(selector?: (store: UiStore) => T, isEqual?: (a: T, b: T) => boolean): UiStore | T {
  if (selector) {
    return useStoreSelector(ui, selector, isEqual)
  }
  useStoreVersion(ui)
  return ui
}
