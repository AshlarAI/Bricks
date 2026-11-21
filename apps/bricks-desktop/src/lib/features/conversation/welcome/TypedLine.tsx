// The welcome's line, typed as on a keyboard: « Bienvenue sur Bricks. » first, then the other
// lines in a random order, each typed, held, then erased. Keys come at uneven intervals, with a
// longer pause after punctuation. With reduced motion the lines change whole, without typing.
// While `paused` (the composer has focus), the line in progress is finished and stays; the
// cycle goes on once the pause ends.
import { useEffect, useRef, useState } from 'react'
import { t, useLanguage, type MessageKey } from '$lib/i18n/i18n'
import { cn } from '$lib/utils'
import './typed-line.css'

export interface TypedLineProps {
  paused?: boolean
}

const FIRST: MessageKey = 'welcome.line1'
const OTHERS: MessageKey[] = [
  'welcome.line2',
  'welcome.line3',
  'welcome.line4',
  'welcome.line5',
  'welcome.line6',
  'welcome.line7',
]
/** Stretches typing and erasing: 1.5 times the delays, a third slower. */
const PACE = 1.5
const HOLD_MS = 2600
const HOLD_REDUCED_MS = 4000
const ERASE_MS = 22 * PACE
const BETWEEN_MS = 380

/** The other lines, shuffled, never starting with `last`. */
function shuffled(last: MessageKey | null): MessageKey[] {
  const out = [...OTHERS]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  if (out[0] === last) out.push(out.shift()!)
  return out
}

/** Delay before the next key: uneven, longer after punctuation. */
function keyDelay(typed: string): number {
  const base = 35 + Math.random() * 75
  return (/[.,;:!?]$/.test(typed) ? base + 220 : base) * PACE
}

export function TypedLine({ paused = false }: TypedLineProps) {
  useLanguage()

  const [key, setKey] = useState<MessageKey>(FIRST)
  /** Characters of the line shown so far. */
  const [shown, setShown] = useState(0)

  const pausedRef = useRef(paused)
  pausedRef.current = paused
  /** Ends the current pause, if the loop is waiting on one. */
  const resumeRef = useRef<(() => void) | null>(null)

  const line = t(key)
  const visible = line.slice(0, shown)
  /** Paused with the whole line on screen: the caret goes away. */
  const still = paused && shown >= line.length

  useEffect(() => {
    if (!paused && resumeRef.current) {
      resumeRef.current()
      resumeRef.current = null
    }
  }, [paused])

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let timer: ReturnType<typeof setTimeout> | undefined
    let queue: MessageKey[] = []
    let cancelled = false
    let currentShown = 0

    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      })
    const resumed = () =>
      new Promise<void>((resolve) => {
        resumeRef.current = resolve
      })

    /** Types `text` from where it stands, holds it (as long as the pause lasts), then erases it. */
    async function play(text: string) {
      if (reduced) {
        currentShown = text.length
        setShown(currentShown)
      }
      while (currentShown < text.length && !cancelled) {
        currentShown += 1
        setShown(currentShown)
        await wait(keyDelay(text.slice(0, currentShown)))
      }
      for (;;) {
        await wait(reduced ? HOLD_REDUCED_MS : HOLD_MS)
        if (cancelled) return
        if (!pausedRef.current) break
        await resumed()
        if (cancelled) return
      }
      if (reduced) return
      while (currentShown > 0 && !cancelled) {
        // A pause during the erase types the line back and keeps it.
        if (pausedRef.current) return play(text)
        currentShown -= 1
        setShown(currentShown)
        await wait(ERASE_MS)
      }
      if (cancelled) return
      await wait(BETWEEN_MS)
    }

    async function run() {
      let current: MessageKey = FIRST
      while (!cancelled) {
        currentShown = 0
        setKey(current)
        setShown(0)
        await play(t(current))
        if (cancelled) return
        if (queue.length === 0) queue = shuffled(current)
        current = queue.shift()!
      }
    }

    void run()

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (resumeRef.current) {
        const resume = resumeRef.current
        resumeRef.current = null
        resume()
      }
    }
  }, [])

  return (
    <p className="welcome-typed-line mt-1.5 min-h-6 text-base text-muted-foreground">
      <span className="sr-only">{line}</span>
      <span aria-hidden="true">
        {visible}
        <span className={cn('caret', still && 'still')} />
      </span>
    </p>
  )
}

export default TypedLine
