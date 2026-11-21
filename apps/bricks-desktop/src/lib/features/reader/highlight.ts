// Highlighted source split into lines, with Shiki: the whole text is tokenized at once (multi-line
// strings and comments keep their colour), one HTML string per line. A language not loaded yet
// gives plain lines and is requested; `codeLanguages.version` changes when it arrives. The file's
// text is always escaped.
import { highlightedLines, plainLines } from '$lib/code-highlight'

/** One HTML string per line of `text`. Unknown or not yet loaded languages are plain text. */
export function highlightLines(text: string, language: string | null): string[] {
  return highlightedLines(text, language) ?? plainLines(text)
}
