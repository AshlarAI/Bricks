// Shiki as synchronous HTML, for code rendered as HTML strings (Markdown code blocks, the reader).
// A language already loaded highlights at once; another one is shown as plain text, loaded in the
// background, and `codeLanguages.version` changes when it arrives so the views render again.
import { highlightSync, languageId, loadHighlighter, type HighlightedLine } from './highlighter'
import { ObservableStore, useStoreSelector } from '$lib/state/observable'

/** Above this byte/char budget, Shiki tokenization is skipped to keep the UI responsive. */
export const MAX_HIGHLIGHT_CHARS = 512 * 1024
/** A single very long line (minified JS/JSON) stalls regex tokenizers and WebKit layout. */
export const MAX_HIGHLIGHT_LINE_CHARS = 4_000
/** Above this size, complete files/blocks highlight off the main thread via `shiki.worker.ts`. */
export const WORKER_HIGHLIGHT_MIN_CHARS = 16_000
export const WORKER_HIGHLIGHT_MIN_LINES = 250

class CodeLanguages extends ObservableStore {
  /** Bumped each time a language finishes loading. */
  version = 0
  #pending = new Set<string>()

  /** Loads `language` in the background, once. */
  request(language: string) {
    const id = languageId(language)
    if (!id || this.#pending.has(id)) return
    this.#pending.add(id)
    void loadHighlighter(id).then(
      () => {
        this.version += 1
        this.emit()
      },
      () => this.#pending.delete(id),
    )
  }
}

export const codeLanguages = new CodeLanguages()

/** Subscribes a React component to newly loaded Shiki grammars. */
export function useCodeLanguagesVersion(): number {
  return useStoreSelector(codeLanguages, (s) => s.version)
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export function lineHtml(line: HighlightedLine): string {
  if (typeof line === 'string') return escapeHtml(line)
  return line
    .map((token) => {
      const style = token.style ? ` style="${escapeHtml(token.style)}"` : ''
      const cls = token.class ? ` class="${escapeHtml(token.class)}"` : ''
      return `<span${cls}${style}>${escapeHtml(token.content)}</span>`
    })
    .join('')
}

/** True when `text` is small enough and free of giant minified lines for Shiki. */
export function canHighlightText(text: string): boolean {
  if (text.length > MAX_HIGHLIGHT_CHARS) return false
  let start = 0
  while (start < text.length) {
    const nl = text.indexOf('\n', start)
    const end = nl === -1 ? text.length : nl
    if (end - start > MAX_HIGHLIGHT_LINE_CHARS) return false
    start = end + 1
  }
  return true
}

/** True when `text` should be highlighted asynchronously in a Web Worker rather than blocking render. */
export function shouldUseWorkerHighlight(text: string, lineCount?: number): boolean {
  if (text.length >= WORKER_HIGHLIGHT_MIN_CHARS) return true
  if (lineCount !== undefined && lineCount >= WORKER_HIGHLIGHT_MIN_LINES) return true
  let lines = 1
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) === 10) {
      lines += 1
      if (lines >= WORKER_HIGHLIGHT_MIN_LINES) return true
    }
  }
  return false
}

/** True when `language` is one Shiki can highlight. */
export function isHighlightable(language: string | null | undefined): boolean {
  return !!language && languageId(language) !== null
}

/**
 * One HTML string per line of `code`, highlighted when the language is loaded; null when it is
 * not loaded yet (it is requested) or not known. The text is always escaped.
 */
export function highlightedLines(code: string, language: string | null | undefined): string[] | null {
  if (!isHighlightable(language) || !canHighlightText(code)) return null
  const lines = highlightSync(code, language as string)
  if (lines === null) {
    codeLanguages.request(language as string)
    return null
  }
  return lines.map(lineHtml)
}

/** The lines of `code` escaped, without colours. */
export function plainLines(code: string): string[] {
  return code.split('\n').map(escapeHtml)
}
