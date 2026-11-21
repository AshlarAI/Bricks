// The shared `/` command list, loaded once from the engine registry
// (`slash_commands`) and cached. A failed load is shown and can be retried.

import { currentLanguage } from '$lib/i18n/i18n'
import { errorMessage, slashCommands } from '$lib/ipc/client'
import type { SlashCommandInfo } from '$lib/ipc/bindings/SlashCommandInfo'
import { ObservableStore, useStoreSelector } from '$lib/state/observable'

export type SlashRegistryState =
  | { status: 'loading' }
  | { status: 'ready'; commands: SlashCommandInfo[] }
  | { status: 'error'; message: string }

class SlashRegistry extends ObservableStore {
  state: SlashRegistryState = { status: 'loading' }
  #pending: Promise<void> | null = null

  get commands(): SlashCommandInfo[] | null {
    return this.state.status === 'ready' ? this.state.commands : null
  }

  /** Loads the list once; concurrent callers share the same request. */
  load(): Promise<void> {
    if (this.state.status === 'ready') return Promise.resolve()
    this.#pending ??= this.#fetch()
    return this.#pending
  }

  /** Tries again after an error. */
  retry(): Promise<void> {
    this.state = { status: 'loading' }
    this.#pending = null
    this.emit()
    return this.load()
  }

  async #fetch(): Promise<void> {
    try {
      const commands = await slashCommands()
      this.state = { status: 'ready', commands }
    } catch (e) {
      this.state = { status: 'error', message: errorMessage(e) }
    } finally {
      this.#pending = null
      this.emit()
    }
  }
}

export const slashRegistry = new SlashRegistry()

/** Subscribes a React component to the shared `/` command registry state. */
export function useSlashRegistry(): SlashRegistryState {
  return useStoreSelector(slashRegistry, (s) => s.state)
}

/** What a command does, in the interface language (the engine gives both). */
export function commandDescription(command: SlashCommandInfo): string {
  return currentLanguage() === 'fr' ? command.description_fr : command.description
}
