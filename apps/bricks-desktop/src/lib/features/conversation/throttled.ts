// A string that follows its source at most once per `ms` while `active`
// is true (streaming), and immediately otherwise.

import { useEffect, useRef, useState } from 'react'

/**
 * Returns a version of `source` that updates at most once every `ms` milliseconds
 * while `active` is true (leading + trailing edge), and immediately otherwise.
 */
export function useThrottledValue(source: string, active: boolean, ms = 80): string {
  const [value, setValue] = useState(source)
  const latestSourceRef = useRef(source)
  const lastRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    latestSourceRef.current = source

    const flush = () => {
      timerRef.current = undefined
      lastRef.current = Date.now()
      setValue(latestSourceRef.current)
    }

    if (!active) {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      lastRef.current = 0
      setValue(source)
      return
    }

    const wait = ms - (Date.now() - lastRef.current)
    if (wait <= 0) {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
      }
      flush()
    } else if (timerRef.current === undefined) {
      timerRef.current = setTimeout(flush, wait)
    }
  }, [source, active, ms])

  useEffect(
    () => () => {
      if (timerRef.current !== undefined) {
        clearTimeout(timerRef.current)
        timerRef.current = undefined
      }
      lastRef.current = 0
    },
    [],
  )

  return active ? value : source
}
