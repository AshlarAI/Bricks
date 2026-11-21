import { useRef, useSyncExternalStore } from 'react'

/**
 * Minimal observable store base class bridging mutable domain stores with React's
 * `useSyncExternalStore`. Mutations bump `_version` via `emit()`, triggering
 * re-renders only where subscribed slices change.
 */
export class ObservableStore {
  private _version = 0
  private _listeners = new Set<() => void>()

  subscribe = (listener: () => void): (() => void) => {
    this._listeners.add(listener)
    return () => {
      this._listeners.delete(listener)
    }
  }

  getSnapshot = (): number => this._version

  protected emit(): void {
    this._version += 1
    for (const listener of this._listeners) {
      listener()
    }
  }
}

/** Subscribes to every `emit()` of `store` and returns its monotonic version. */
export function useStoreVersion(store: ObservableStore): number {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/**
 * Selects a derived slice from `store` and only triggers a React re-render when
 * `isEqual(prev, next)` returns false (defaults to `Object.is`).
 * Caches the previous selected value so `getSnapshot` stays referentially stable
 * when `isEqual` holds.
 */
export function useStoreSelector<S extends ObservableStore, T>(
  store: S,
  selector: (store: S) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const cacheRef = useRef<{
    hasValue: boolean
    value: T
    version: number
    store: S
    selector: (store: S) => T
  }>({
    hasValue: false,
    value: undefined as T,
    version: -1,
    store,
    selector,
  })

  const getSelected = (): T => {
    const cache = cacheRef.current
    const version = store.getSnapshot()
    if (
      cache.hasValue &&
      cache.store === store &&
      cache.version === version &&
      cache.selector === selector
    ) {
      return cache.value
    }
    const next = selector(store)
    if (cache.hasValue && cache.store === store && isEqual(cache.value, next)) {
      cache.version = version
      cache.selector = selector
      return cache.value
    }
    cache.hasValue = true
    cache.value = next
    cache.version = version
    cache.store = store
    cache.selector = selector
    return next
  }

  return useSyncExternalStore(store.subscribe, getSelected, getSelected)
}
