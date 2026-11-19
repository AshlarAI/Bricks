// Shiki as synchronous HTML, for code rendered as HTML strings (Markdown code blocks, the reader).
// A language already loaded highlights at once; another one is shown as plain text, loaded in the
// background, and `codeLanguages.version` changes when it arrives so the views render again.
import { highlightSync, languageId, loadHighlighter, type HighlightedLine } from './highlighter'

class CodeLanguages {
  /** Bumped each time a language finishes loading. */
  version = $state(0)
  #pending = new Set<string>()

  /** Loads `language` in the background, once. */
  request(language: string) {
    const id = languageId(language)
    if (!id || this.#pending.has(id)) return
    this.#pending.add(id)
    void loadHighlighter(id).then(
      () => {
        this.version += 1
      },
      () => this.#pending.delete(id),
    )
  }
}

export const codeLanguages = new CodeLanguages()

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function lineHtml(line: HighlightedLine): string {
  if (typeof line === 'string') return escapeHtml(line)
  return line
    .map((token) => {
      const style = token.style ? ` style="${escapeHtml(token.style)}"` : ''
      const cls = token.class ? ` class="${escapeHtml(token.class)}"` : ''
      return `<span${cls}${style}>${escapeHtml(token.content)}</span>`
    })
    .join('')
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
  if (!isHighlightable(language)) return null
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
