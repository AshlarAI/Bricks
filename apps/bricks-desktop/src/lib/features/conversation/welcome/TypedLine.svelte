<script lang="ts">
  // The welcome's line, typed as on a keyboard: « Bienvenue sur Bricks. » first, then the other
  // lines in a random order, each typed, held, then erased. Keys come at uneven intervals, with a
  // longer pause after punctuation. With reduced motion the lines change whole, without typing.
  // While `paused` (the composer has focus), the line in progress is finished and stays; the
  // cycle goes on once the pause ends.
  import { untrack } from 'svelte'
  import { t, type MessageKey } from '$lib/i18n/i18n.svelte'

  let { paused = false }: { paused?: boolean } = $props()

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

  let key = $state<MessageKey>(FIRST)
  /** Characters of the line shown so far. */
  let shown = $state(0)

  const line = $derived(t(key))
  const visible = $derived(line.slice(0, shown))
  /** Paused with the whole line on screen: the caret goes away. */
  const still = $derived(paused && shown >= line.length)

  /** Ends the current pause, if the loop is waiting on one. */
  let resume: (() => void) | null = null

  $effect(() => {
    if (!paused && resume) {
      resume()
      resume = null
    }
  })

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

  $effect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let timer: ReturnType<typeof setTimeout> | undefined
    let queue: MessageKey[] = []
    let cancelled = false
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, ms)
      })
    const resumed = () =>
      new Promise<void>((resolve) => {
        resume = resolve
      })

    /** Types `text` from where it stands, holds it (as long as the pause lasts), then erases it. */
    async function play(text: string) {
      if (reduced) shown = text.length
      while (shown < text.length && !cancelled) {
        shown += 1
        await wait(keyDelay(text.slice(0, shown)))
      }
      for (;;) {
        await wait(reduced ? HOLD_REDUCED_MS : HOLD_MS)
        if (cancelled) return
        if (!paused) break
        await resumed()
      }
      if (reduced) return
      while (shown > 0 && !cancelled) {
        // A pause during the erase types the line back and keeps it.
        if (paused) return play(text)
        shown -= 1
        await wait(ERASE_MS)
      }
      await wait(BETWEEN_MS)
    }

    async function run() {
      let current: MessageKey = FIRST
      while (!cancelled) {
        key = current
        shown = 0
        await play(t(current))
        if (queue.length === 0) queue = shuffled(current)
        current = queue.shift()!
      }
    }
    // The loop drives `key` and `shown` and reads `paused`; it must not make this effect depend
    // on them.
    untrack(() => void run())
    return () => {
      cancelled = true
      clearTimeout(timer)
      resume = null
    }
  })
</script>

<p class="mt-1.5 min-h-6 text-base text-muted-foreground">
  <span class="sr-only">{line}</span>
  <span aria-hidden="true">{visible}<span class={['caret', still && 'still']}></span></span>
</p>

<style>
  .caret {
    display: inline-block;
    width: 1.5px;
    height: 1.05em;
    margin-left: 2px;
    vertical-align: -0.15em;
    background: currentColor;
    animation: blink 1s steps(1) infinite;
  }

  .caret.still {
    visibility: hidden;
    animation: none;
  }

  @keyframes blink {
    50% {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .caret {
      animation: none;
    }
  }
</style>
