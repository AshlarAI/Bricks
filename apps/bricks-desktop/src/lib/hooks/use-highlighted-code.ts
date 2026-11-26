import { useEffect, useMemo, useRef, useState } from 'react'
import { canHighlightText, isHighlightable, shouldUseWorkerHighlight } from '$lib/code-highlight'
import {
  loadHighlighter,
  type Highlighter,
  type HighlightedLine,
} from '$lib/highlighter'
import { highlightTokensAsync } from '$lib/shiki-async'
import type { GrammarState } from 'shiki/core'

/**
 * Highlights `code` in `language`. Returns one entry per line: a plain string
 * until the highlighter loads (or while a large block highlights in a Worker),
 * then the line's tokens. Pass each one to `CodeBlockLine` or `CodeBlockContent`.
 */
export function useHighlightedCode(value: string, language: string): HighlightedLine[] {
  const code = useMemo(() => (value.endsWith('\n') ? value.slice(0, -1) : value), [value])
  const highlightable = isHighlightable(language) && canHighlightText(code)
  const useWorker = highlightable && shouldUseWorkerHighlight(code)

  const [loaded, setLoaded] = useState<{
    language: string
    highlighter: Highlighter | null
  } | null>(null)

  const [workerResult, setWorkerResult] = useState<{
    code: string
    language: string
    lines: HighlightedLine[]
  } | null>(null)

  useEffect(() => {
    if (!highlightable || useWorker) return
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
  }, [language, highlightable, useWorker])

  useEffect(() => {
    if (!useWorker) {
      setWorkerResult(null)
      return
    }
    const controller = new AbortController()
    void highlightTokensAsync(code, language, controller.signal).then((lines) => {
      if (!controller.signal.aborted && lines) {
        setWorkerResult({ code, language, lines })
      }
    })
    return () => controller.abort()
  }, [code, language, useWorker])

  // The complete lines, highlighted. While the code streams, only the new
  // lines are tokenized, starting from the grammar state of the last one.
  const doneRef = useRef<{
    highlighter: Highlighter | null
    text: string
    lines: HighlightedLine[]
    state?: GrammarState
  }>({ highlighter: null, text: '', lines: [] })

  const plain = useMemo(() => code.split('\n'), [code])

  return useMemo((): HighlightedLine[] => {
    if (!highlightable) {
      return plain
    }

    if (useWorker) {
      if (workerResult && workerResult.code === code && workerResult.language === language) {
        return workerResult.lines
      }
      return plain
    }

    const highlighter = loaded?.language === language ? loaded.highlighter : null
    if (!highlighter) {
      return plain
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
  }, [code, plain, highlightable, useWorker, workerResult, language, loaded])
}
