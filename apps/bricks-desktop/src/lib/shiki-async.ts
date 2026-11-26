// Off-main-thread Shiki highlighting with cancellation and graceful fallback when Worker is unavailable.
import { canHighlightText, isHighlightable, lineHtml } from './code-highlight'
import { highlightCode, type HighlightedLine } from './highlighter'
import type { ShikiWorkerRequest, ShikiWorkerResponse } from './shiki.worker'

let worker: Worker | null = null
let nextId = 1

const pending = new Map<
  number,
  {
    resolve: (res: ShikiWorkerResponse) => void
  }
>()

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null
  if (!worker) {
    try {
      worker = new Worker(new URL('./shiki.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<ShikiWorkerResponse>) => {
        const res = event.data
        const entry = pending.get(res.id)
        if (!entry) return
        pending.delete(res.id)
        entry.resolve(res)
      }
      worker.onerror = () => {
        for (const [id, entry] of pending) {
          pending.delete(id)
          entry.resolve({ id, mode: 'tokens', lines: null })
        }
        worker?.terminate()
        worker = null
      }
    } catch {
      return null
    }
  }
  return worker
}

function runInWorker(
  mode: ShikiWorkerRequest['mode'],
  code: string,
  language: string,
  signal?: AbortSignal,
): Promise<ShikiWorkerResponse['lines']> {
  if (signal?.aborted) return Promise.resolve(null)
  const w = getWorker()
  if (!w) {
    return highlightCode(code, language).then((tokens) => {
      if (!tokens || signal?.aborted) return null
      return mode === 'html' ? tokens.map(lineHtml) : tokens
    })
  }
  const id = nextId++
  return new Promise((resolve) => {
    const onAbort = () => {
      pending.delete(id)
      resolve(null)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    pending.set(id, {
      resolve: (res) => {
        signal?.removeEventListener('abort', onAbort)
        resolve(res.lines)
      },
    })
    w.postMessage({ id, mode, code, language } satisfies ShikiWorkerRequest)
  })
}

export async function highlightTokensAsync(
  code: string,
  language: string,
  signal?: AbortSignal,
): Promise<HighlightedLine[] | null> {
  if (!isHighlightable(language) || !canHighlightText(code)) return null
  return (await runInWorker('tokens', code, language, signal)) as HighlightedLine[] | null
}

export async function highlightHtmlLinesAsync(
  code: string,
  language: string,
  signal?: AbortSignal,
): Promise<string[] | null> {
  if (!isHighlightable(language) || !canHighlightText(code)) return null
  return (await runInWorker('html', code, language, signal)) as string[] | null
}
