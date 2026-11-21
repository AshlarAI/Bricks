// Change journal caches: the project history and each conversation's own
// records. Both stay current through `change_recorded` events.
// Owner: Haiku 7 (changes feature).

import { useSyncExternalStore } from 'react'
import {
  changeLogInfo,
  changeLogList,
  errorMessage,
  type ChangeJournalInfo,
  type ChangeRecord,
} from '$lib/ipc/client'
import { onChangeRecorded } from '$lib/state/app'
import { ObservableStore } from '$lib/state/observable'

/** Records per page of the project history. */
export const HISTORY_PAGE = 50

/**
 * Records asked for one conversation: the engine's largest page. Its default
 * (200) would cut a longer conversation's changes without a word.
 */
export const SESSION_LIST_LIMIT = 2000

const newestFirst = (a: ChangeRecord, b: ChangeRecord) => b.at - a.at

/** Observable paginated change journal for a single project. */
export class ProjectJournal extends ObservableStore {
  readonly projectId: string
  records: ChangeRecord[] = []
  info: ChangeJournalInfo | null = null
  /** Size of the page currently shown. */
  limit = HISTORY_PAGE
  loaded = false
  loading = false
  error: string | null = null
  /** The last page was shorter than asked: nothing older to load. */
  exhausted = false
  #seq = 0

  constructor(projectId: string) {
    super()
    this.projectId = projectId
  }

  /** Loads the newest `limit` records and the journal's header. */
  async load(limit = this.limit): Promise<void> {
    const seq = ++this.#seq
    this.loading = true
    this.emit()
    try {
      const [records, info] = await Promise.all([
        changeLogList(this.projectId, null, limit),
        changeLogInfo(this.projectId),
      ])
      if (seq !== this.#seq) return
      this.records = [...records].sort(newestFirst)
      this.info = info
      this.limit = limit
      this.exhausted = records.length < limit
      this.error = null
      this.loaded = true
    } catch (e) {
      if (seq === this.#seq) this.error = errorMessage(e)
    } finally {
      if (seq === this.#seq) {
        this.loading = false
        this.emit()
      }
    }
  }

  more(): Promise<void> {
    return this.load(this.limit + HISTORY_PAGE)
  }

  add(record: ChangeRecord): void {
    if (this.records.some((r) => r.id === record.id)) return
    this.records = [record, ...this.records].sort(newestFirst)
    this.emit()
  }
}

/** Observable change journal for a single conversation session. */
export class SessionJournal extends ObservableStore {
  readonly projectId: string
  readonly sessionId: string
  records: ChangeRecord[] = []
  loaded = false
  loading = false
  error: string | null = null
  #seq = 0

  constructor(projectId: string, sessionId: string) {
    super()
    this.projectId = projectId
    this.sessionId = sessionId
  }

  async load(): Promise<void> {
    const seq = ++this.#seq
    this.loading = true
    this.emit()
    try {
      const records = await changeLogList(this.projectId, this.sessionId, SESSION_LIST_LIMIT)
      if (seq !== this.#seq) return
      this.records = [...records].sort(newestFirst)
      this.error = null
      this.loaded = true
    } catch (e) {
      if (seq === this.#seq) this.error = errorMessage(e)
    } finally {
      if (seq === this.#seq) {
        this.loading = false
        this.emit()
      }
    }
  }

  add(record: ChangeRecord): void {
    if (this.records.some((r) => r.id === record.id)) return
    this.records = [record, ...this.records].sort(newestFirst)
    this.emit()
  }
}

// Plain maps on purpose: lookups are safe during render without mutating store
// state. The entries extend ObservableStore.
const projects = new Map<string, ProjectJournal>()
const sessions = new Map<string, SessionJournal>()
let subscribed = false

function subscribe(): void {
  if (subscribed) return
  subscribed = true
  onChangeRecorded((record) => {
    projects.get(record.project_id)?.add(record)
    sessions.get(record.session_id)?.add(record)
  })
}

const noopSubscribe = () => () => {}
const zeroSnapshot = () => 0

function useOptionalStoreVersion(store: ObservableStore | null): void {
  useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    store ? store.getSnapshot : zeroSnapshot,
    store ? store.getSnapshot : zeroSnapshot,
  )
}

/** The history of a project (created on first use). Safe during render. */
export function projectJournal(projectId: string): ProjectJournal {
  subscribe()
  let journal = projects.get(projectId)
  if (!journal) {
    journal = new ProjectJournal(projectId)
    projects.set(projectId, journal)
  }
  return journal
}

/** The records of one conversation (created on first use). Safe during render. */
export function sessionJournal(projectId: string, sessionId: string): SessionJournal {
  subscribe()
  let journal = sessions.get(sessionId)
  if (!journal) {
    journal = new SessionJournal(projectId, sessionId)
    sessions.set(sessionId, journal)
  }
  return journal
}

/** Subscribes a React component to the `ProjectJournal` for `projectId`. */
export function useProjectJournal(projectId: string): ProjectJournal
export function useProjectJournal(projectId: string | null | undefined): ProjectJournal | null
export function useProjectJournal(projectId: string | null | undefined): ProjectJournal | null {
  const journal = projectId ? projectJournal(projectId) : null
  useOptionalStoreVersion(journal)
  return journal
}

/** Subscribes a React component to the `SessionJournal` for `projectId` and `sessionId`. */
export function useSessionJournal(projectId: string, sessionId: string): SessionJournal
export function useSessionJournal(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): SessionJournal | null
export function useSessionJournal(
  projectId: string | null | undefined,
  sessionId: string | null | undefined,
): SessionJournal | null {
  const journal = projectId && sessionId ? sessionJournal(projectId, sessionId) : null
  useOptionalStoreVersion(journal)
  return journal
}
