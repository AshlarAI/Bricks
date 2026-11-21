import { useEffect, useMemo, useRef, useState } from 'react'
import {
  loadHighlighter,
  type Highlighter,
  type HighlightedLine,
} from '$lib/highlighter'
import type { GrammarState } from 'shiki/core'

/**
 * Highlights `code` in `language`. Returns one entry per line: a plain string
 * until the highlighter loads, then the line's tokens. Pass each one to the
 * `code` prop of a `CodeBlockLine`.
 */
export function useHighlightedCode(value: string, language: string): HighlightedLine[] {
  const [loaded, setLoaded] = useState<{
    language: string
    highlighter: Highlighter | null
  } | null>(null)

  useEffect(() => {
    let cancelled = false

    loadHighlighter(language)
      .then((next) => {
        if (!cancelled) {
          setLoaded({ language, highlighter: next })
        }
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [language])

  // The complete lines, highlighted. While the code streams, only the new
  // lines are tokenized, starting from the grammar state of the last one.
  const doneRef = useRef<{
    highlighter: Highlighter | null
    text: string
    lines: HighlightedLine[]
    state?: GrammarState
  }>({ highlighter: null, text: '', lines: [] })

  return useMemo((): HighlightedLine[] => {
    // A trailing newline would render as an extra empty line.
    const code = value.endsWith('\n') ? value.slice(0, -1) : value
    const highlighter = loaded?.language === language ? loaded.highlighter : null

    if (!highlighter) {
      return code.split('\n')
    }

    let next = doneRef.current

    if (next.highlighter !== highlighter || !code.startsWith(next.text)) {
      next = { highlighter, text: '', lines: [] }
    }

    const end = code.lastIndexOf('\n') + 1

    if (end > next.text.length) {
      const result = highlighter.highlight(code.slice(next.text.length, end - 1), next.state)

      next = {
        highlighter,
        text: code.slice(0, end),
        lines: [...next.lines, ...result.lines],
        state: result.state,
      }
    }

    doneRef.current = next

    // The last line is still being written, so it is tokenized every time.
    const tail = code.slice(end)

    return [...next.lines, highlighter.highlight(tail, next.state).lines[0]]
  }, [value, language, loaded])
}
