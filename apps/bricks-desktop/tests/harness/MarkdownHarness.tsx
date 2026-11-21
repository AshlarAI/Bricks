import { flushSync } from 'react-dom'
import { useRef, useState } from 'react'
import { renderMarkdown as renderBaseline } from '../bench/baseline/markdown-baseline'
import AssistantMessage from '../../src/lib/features/conversation/timeline/AssistantMessage'
import type { AssistantItem, Conversation } from '../../src/lib/state/conversation'

// Streams a corpus fixture into the real AssistantMessage component and
// measures, in this browser: time of each throttled update (render + DOM
// flush), long tasks, DOM mutations of blocks already frozen, heap, and
// whether KaTeX / Mermaid were loaded. Results in `window.__harness`.
const sources = import.meta.glob('../fixtures/markdown/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const fixtures = Object.fromEntries(
  Object.entries(sources).map(([path, text]) => [path.split('/').pop()!.replace('.md', ''), text]),
)

const params = new URLSearchParams(location.search)
const initialName = params.get('fixture') ?? 'simple'
const chunk = Number(params.get('chunk') ?? 60)
// fast=1: a simulated clock steps 85 ms per update (past the 80 ms throttle)
// and the loop yields through MessageChannel, which the pane does not throttle.
// Each step is still one real React + DOM render; only waiting is skipped.
const fast = params.get('fast') === '1'
// engine=baseline: the frozen pipeline of c1fe3de (whole message re-parsed, one dangerouslySetInnerHTML).
const baseline = params.get('engine') === 'baseline'
let fakeNow = Date.now()
if (fast) Date.now = () => fakeNow
const channel = new MessageChannel()
const yieldTask = () =>
  new Promise<void>((resolve) => {
    channel.port1.onmessage = () => resolve()
    channel.port2.postMessage(0)
  })

const conversation = { projectId: null } as unknown as Conversation

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]
}

function loaded(pattern: RegExp) {
  return performance.getEntriesByType('resource').some((e) => pattern.test(e.name))
}

export function MarkdownHarness() {
  const [name, setName] = useState(initialName)
  const [baselineHtml, setBaselineHtml] = useState('')
  const [item, setItem] = useState<AssistantItem>({
    kind: 'assistant',
    id: 'h1',
    text: '',
    thinking: '',
    streaming: false,
  })
  const [status, setStatus] = useState('prêt')
  const rootRef = useRef<HTMLDivElement>(null)

  // Browser-only controls to verify source replacement and cancellation between
  // throttled updates without a provider, real session or production fixture.
  ;(window as unknown as { __markdownControl: unknown }).__markdownControl = {
    replace(text: string, streaming = false) {
      flushSync(() => {
        setItem((prev) => ({ ...prev, text, streaming }))
      })
    },
    stop() {
      flushSync(() => {
        setItem((prev) => ({ ...prev, streaming: false }))
      })
    },
  }

  async function run() {
    const text = fixtures[name] ?? ''
    setStatus('streaming')
    const longTasks: number[] = []
    let observer: PerformanceObserver | null = null
    try {
      observer = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(e.duration)))
      observer.observe({ type: 'longtask', buffered: false })
    } catch {
      observer = null
    }
    const id = `h${Date.now()}`
    flushSync(() => {
      setItem({ kind: 'assistant', id, text: '', thinking: '', streaming: true })
    })
    await Promise.resolve()
    const ticks: number[] = []
    // Mutations of block nodes that already existed before the last update.
    let frozenMutations = 0
    const count = (records: MutationRecord[]) => {
      for (const r of records) {
        if (r.type === 'childList') r.removedNodes.forEach((n) => { if (n.nodeType === 1) frozenMutations += 1 })
      }
    }
    const mutations = new MutationObserver(count)
    const md = () => rootRef.current?.querySelector('.md')
    for (let i = chunk; i < text.length + chunk; i += chunk) {
      const prefix = text.slice(0, Math.min(i, text.length))
      const target = md()
      if (target) mutations.observe(target, { childList: true })
      const t0 = performance.now()
      flushSync(() => {
        if (baseline) setBaselineHtml(renderBaseline(prefix))
        else setItem((prev) => ({ ...prev, text: prefix }))
      })
      ticks.push(performance.now() - t0)
      count(mutations.takeRecords())
      mutations.disconnect()
      // Past the 80 ms throttle: each step is one real render.
      if (fast) {
        fakeNow += 85
        await yieldTask()
      } else {
        await new Promise((r) => setTimeout(r, 85))
      }
    }
    const t0 = performance.now()
    flushSync(() => {
      if (baseline) setBaselineHtml(renderBaseline(text))
      else setItem((prev) => ({ ...prev, streaming: false }))
    })
    const finalMs = performance.now() - t0
    await new Promise((r) => setTimeout(r, fast ? 3000 : 1500))
    observer?.disconnect()
    const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
    const result = {
      fixture: name,
      engine: baseline ? 'baseline' : 'blocks',
      chars: text.length,
      updates: ticks.length,
      totalMs: Math.round(ticks.reduce((a, b) => a + b, 0)),
      p50: +percentile(ticks, 50).toFixed(2),
      p95: +percentile(ticks, 95).toFixed(2),
      max: +Math.max(...ticks).toFixed(2),
      finalMs: +finalMs.toFixed(2),
      longTasks: longTasks.length,
      longTaskMs: Math.round(longTasks.reduce((a, b) => a + b, 0)),
      removedElements: frozenMutations,
      heapMB: memory ? +(memory.usedJSHeapSize / 1048576).toFixed(1) : null,
      katexLoaded: loaded(/deps\/katex|katex(\.min)?\.(css|js|mjs)/i),
      mermaidLoaded: loaded(/deps\/mermaid|mermaid\.core|node_modules\/mermaid/i),
      katexNodes: document.querySelectorAll('.katex').length,
      mermaidSvgs: document.querySelectorAll('.mermaid-block svg').length,
      mathErrors: document.querySelectorAll('.math-error').length,
    }
    ;(window as unknown as { __harness: unknown }).__harness = result
    setStatus('fini')
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-3 p-4">
      <div className="flex items-center gap-2 text-xs">
        <select value={name} onChange={(e) => setName(e.target.value)} className="rounded border px-1">
          {Object.keys(fixtures).map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button type="button" className="rounded border px-2" onClick={run}>
          Lancer
        </button>
        <span data-status>{status}</span>
      </div>
      <div ref={rootRef} data-conversation-scroll>
        {baseline ? (
          <div className="md text-sm leading-relaxed" dangerouslySetInnerHTML={{ __html: baselineHtml }} />
        ) : (
          <AssistantMessage item={item} conversation={conversation} />
        )}
      </div>
    </div>
  )
}

export default MarkdownHarness
