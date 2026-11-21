// A discreet column of grains at the left of the conversation: one per message sent, the one
// being read darker. A grain scrolls to its message; hovered or focused, it shows a card with
// the message, the start of its answer, its place and its time. Only the loaded messages have
// a grain.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { dateTimeFormat, t, useLanguage } from '$lib/i18n/i18n'
import { cn } from '$lib/utils'

export interface Mark {
  /** The message's key, also its `data-turn` in the list. */
  key: string
  /** The start of the message, for the grain's name. */
  label: string
  /** The answer's text (empty while it runs, or when there is none). */
  answer: string
  /** When the message was sent, in milliseconds. */
  at: number | null
  /** Its place among all the messages sent in the conversation (from 1), and their number. */
  place: number
  total: number
}

export interface MessageRailProps {
  marks: Mark[]
  scroller: HTMLElement | null
}

/** The answer as plain text: Markdown's marks go, every other character stays. */
function plain(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
    .replace(/(^|[^\w*])\*(?=\S)([^*\n]*?\S)\*(?![\w*])/g, '$1$2')
    .replace(/(^|[^\w])_(?=\S)([^_\n]*?\S)_(?!\w)/g, '$1$2')
    .replace(/^[ \t]*(?:#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+|\d+[.)][ \t]+)/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function MessageRail({ marks, scroller }: MessageRailProps) {
  const language = useLanguage()
  const [active, setActive] = useState<string | null>(null)

  const marksRef = useRef(marks)
  marksRef.current = marks

  const turnOf = useCallback(
    (key: string): HTMLElement | null => {
      return scroller?.querySelector<HTMLElement>(`[data-turn="${CSS.escape(key)}"]`) ?? null
    },
    [scroller],
  )

  /** The message being read: the last one whose top is above the upper third of the view. */
  const measure = useCallback(() => {
    const el = scroller
    const currentMarks = marksRef.current
    if (!el || currentMarks.length === 0) return
    const line = el.getBoundingClientRect().top + el.clientHeight * 0.35
    let current = currentMarks[0].key
    for (const mark of currentMarks) {
      const turn = turnOf(mark.key)
      if (turn && turn.getBoundingClientRect().top <= line) current = mark.key
    }
    // At the very bottom, the last message is the one read.
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 4) {
      current = currentMarks.at(-1)?.key ?? current
    }
    setActive(current)
  }, [scroller, turnOf])

  useEffect(() => {
    const el = scroller
    if (!el) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        measure()
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [scroller, measure])

  useEffect(() => {
    measure()
  }, [scroller, marks.length, measure])

  function go(key: string) {
    const turn = turnOf(key)
    if (!turn || !scroller) return
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    turn.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
    setActive(key)
  }

  /** One tab stop for the whole rail: the arrows move between grains, Enter goes. */
  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === 'ArrowDown'
        ? index + 1
        : event.key === 'ArrowUp'
          ? index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? marks.length - 1
              : null
    if (next === null) return
    event.preventDefault()
    const target = marks[Math.max(0, Math.min(marks.length - 1, next))]
    setActive(target.key)
    const nav = event.currentTarget.parentElement
    nav?.querySelector<HTMLElement>(`[data-mark="${CSS.escape(target.key)}"]`)?.focus()
  }

  const focusable = active ?? marks.at(-1)?.key ?? null
  const when = useMemo(() => dateTimeFormat({ dateStyle: 'long', timeStyle: 'short' }), [language])

  function position(mark: Mark): string {
    return t('conversation.railPosition', { index: mark.place, total: mark.total })
  }

  if (marks.length <= 1) return null

  return (
    <nav
      aria-label={t('conversation.messageRail')}
      className="pointer-events-none absolute top-1/2 left-1 z-10 hidden max-h-[70%] -translate-y-1/2 flex-col items-center @[54rem]:flex"
    >
      {marks.map((mark, index) => (
        <button
          key={mark.key}
          type="button"
          data-mark={mark.key}
          tabIndex={focusable === mark.key ? 0 : -1}
          className="group pointer-events-auto relative flex h-3.5 min-h-1 w-7 shrink items-center justify-center focus-visible:outline-none"
          aria-label={`${mark.label} · ${position(mark)}`}
          aria-current={active === mark.key ? 'true' : undefined}
          onClick={() => go(mark.key)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          <span
            className={cn(
              'h-1.5 w-3 rounded-full transition-[background-color,transform] duration-150 group-hover:scale-125 group-focus-visible:ring-2 group-focus-visible:ring-ring',
              active === mark.key ? 'bg-foreground/55' : 'bg-muted-foreground/25 group-hover:bg-muted-foreground/60',
            )}
          />
          <span
            aria-hidden="true"
            className="pointer-events-none invisible absolute top-1/2 left-8 z-20 flex w-72 -translate-y-1/2 flex-col gap-1.5 rounded-2xl border border-border-subtle bg-popover px-4 py-3 text-left text-popover-foreground opacity-0 shadow-float transition-opacity duration-100 group-hover:visible group-hover:opacity-100 group-focus-visible:visible group-focus-visible:opacity-100"
          >
            <span className="truncate text-ui font-medium">{mark.label}</span>
            {mark.answer && <span className="line-clamp-3 text-compact text-muted-foreground">{plain(mark.answer)}</span>}
            <span className="mt-0.5 flex items-center justify-between gap-3 text-caption text-muted-foreground tabular-nums">
              <span>{position(mark)}</span>
              {mark.at && <span className="truncate">{when.format(new Date(mark.at))}</span>}
            </span>
          </span>
        </button>
      ))}
    </nav>
  )
}

export default MessageRail
