// Highlights large code blocks and files off the main thread so WebKit never stalls.
import { canHighlightText, lineHtml } from './code-highlight'
import { highlightCode, type HighlightedLine } from './highlighter'

export interface ShikiWorkerRequest {
  id: number
  mode: 'tokens' | 'html'
  code: string
  language: string
}

export type ShikiWorkerResponse =
  | { id: number; mode: 'tokens'; lines: HighlightedLine[] | null }
  | { id: number; mode: 'html'; lines: string[] | null }

self.onmessage = async (event: MessageEvent<ShikiWorkerRequest>) => {
  const { id, mode, code, language } = event.data
  try {
    if (!canHighlightText(code)) {
      self.postMessage({ id, mode, lines: null } satisfies ShikiWorkerResponse)
      return
    }
    const tokens = await highlightCode(code, language)
    if (!tokens) {
      self.postMessage({ id, mode, lines: null } satisfies ShikiWorkerResponse)
      return
    }
    if (mode === 'html') {
      self.postMessage({ id, mode, lines: tokens.map(lineHtml) } satisfies ShikiWorkerResponse)
      return
    }
    self.postMessage({ id, mode, lines: tokens } satisfies ShikiWorkerResponse)
  } catch {
    self.postMessage({ id, mode, lines: null } satisfies ShikiWorkerResponse)
  }
}
