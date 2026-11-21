// Git state of a project folder: status and the commit list.
// Owner: Haiku 7 (changes feature). Components call `refresh()` and
// `loadCommits()`; nothing here computes a diff.

import { useSyncExternalStore } from 'react'
import { errorMessage, gitLog, gitStatus, type GitCommit, type GitStatus } from '$lib/ipc/client'
import { FocusGate } from '$lib/state/focus-gate'
import { ObservableStore } from '$lib/state/observable'

/** Commits per page. */
export const COMMIT_PAGE = 30

/** Observable git status and paginated commit history for a single project. */
export class GitState extends ObservableStore {
  readonly projectId: string
  status: GitStatus | null = null
  statusError: string | null = null
  statusLoading = false
  /** Bumped by each successful refresh: patches cached under an older value are stale. */
  revision = 0
  commits: GitCommit[] = []
  commitsLoaded = false
  commitsLoading = false
  commitsError: string | null = null
  commitsExhausted = false
  #statusSeq = 0
  #statusInFlight: Promise<void> | null = null
  #statusQueued = false
  readonly #statusGate = new FocusGate()

  constructor(projectId: string) {
    super()
    this.projectId = projectId
  }

  refresh(queueIfBusy = false): Promise<void> {
    if (this.#statusInFlight) {
      if (queueIfBusy) this.#statusQueued = true
      return this.#statusInFlight
    }
    const seq = ++this.#statusSeq
    this.statusLoading = true
    this.emit()
    const run = this.#statusGate
      .track(async () => {
        try {
          const status = await gitStatus(this.projectId)
          if (seq !== this.#statusSeq) return
          this.status = status
          this.statusError = null
          this.revision++
        } catch (e) {
          if (seq === this.#statusSeq) this.statusError = errorMessage(e)
        } finally {
          if (seq === this.#statusSeq) {
            this.statusLoading = false
            this.emit()
          }
        }
      })
      .finally(() => {
        if (this.#statusInFlight === run) this.#statusInFlight = null
      })
      .then(async () => {
        if (this.#statusQueued) {
          this.#statusQueued = false
          await this.refresh()
        }
      })
    this.#statusInFlight = run
    return run
  }

  refreshOnFocus(): Promise<void> {
    return this.#statusGate.canRunOnFocus() ? this.refresh() : Promise.resolve()
  }

  /** The first page of commits, or the next one when `next` is set. */
  async loadCommits(next = false): Promise<void> {
    if (this.commitsLoading) return
    const skip = next ? this.commits.length : 0
    this.commitsLoading = true
    this.emit()
    try {
      const page = await gitLog(this.projectId, COMMIT_PAGE, skip)
      this.commits = next ? [...this.commits, ...page] : page
      this.commitsExhausted = page.length < COMMIT_PAGE
      this.commitsError = null
      this.commitsLoaded = true
    } catch (e) {
      this.commitsError = errorMessage(e)
    } finally {
      this.commitsLoading = false
      this.emit()
    }
  }
}

// Plain map: see journal.ts. Entries extend ObservableStore.
const repos = new Map<string, GitState>()

const noopSubscribe = () => () => {}
const zeroSnapshot = () => 0

/** Git state of a project (created on first use). Safe during render. */
export function gitState(projectId: string): GitState {
  let state = repos.get(projectId)
  if (!state) {
    state = new GitState(projectId)
    repos.set(projectId, state)
  }
  return state
}

/** Subscribes a React component to the `GitState` for `projectId`. */
export function useGitState(projectId: string): GitState
export function useGitState(projectId: string | null | undefined): GitState | null
export function useGitState(projectId: string | null | undefined): GitState | null {
  const state = projectId ? gitState(projectId) : null
  useSyncExternalStore(
    state ? state.subscribe : noopSubscribe,
    state ? state.getSnapshot : zeroSnapshot,
    state ? state.getSnapshot : zeroSnapshot,
  )
  return state
}
