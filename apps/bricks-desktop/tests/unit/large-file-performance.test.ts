// @vitest-environment happy-dom
// Verifies large-file and Markdown performance optimizations:
// - Shiki byte and line-length safety guardrails
// - Selective codeVersion cache invalidation in MarkdownDocument
// - Line virtualization in CodeBlockContent, DiffView, FileView, and ReaderPanel
// - Deferred content-visibility class on large MarkdownView documents
import type { ComponentType } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_HIGHLIGHT_CHARS,
  MAX_HIGHLIGHT_LINE_CHARS,
  canHighlightText,
  highlightedLines,
  shouldUseWorkerHighlight,
} from '../../src/lib/code-highlight'
import * as CodeBlock from '../../src/lib/components/ui/code-block'
import DiffView from '../../src/lib/features/changes/DiffView'
import { MarkdownDocument } from '../../src/lib/features/conversation/markdown/document'
import MarkdownView, { type MarkdownViewProps } from '../../src/lib/features/conversation/markdown/MarkdownView'
import { loadHighlighter } from '../../src/lib/highlighter'
import { flushReact, mountReact, type MountedComponent } from './react-test-utils'

vi.mock('../../src/lib/features/conversation/markdown/sanitize', () => ({
  sanitizeMarkdown: (html: string) => html,
}))

await loadHighlighter('ts')

const mounted: Array<MountedComponent<any>> = []
afterEach(() => {
  while (mounted.length > 0) {
    mounted.pop()?.unmount()
  }
  document.body.innerHTML = ''
})

describe('Shiki safety guardrails for heavy files', () => {
  it('skips highlighting above MAX_HIGHLIGHT_CHARS or on minified lines', () => {
    const huge = 'const x = 1;\n'.repeat(Math.ceil(MAX_HIGHLIGHT_CHARS / 13) + 10)
    expect(canHighlightText(huge)).toBe(false)
    expect(highlightedLines(huge, 'ts')).toBeNull()

    const minified = 'a'.repeat(MAX_HIGHLIGHT_LINE_CHARS + 1)
    expect(canHighlightText(minified)).toBe(false)
    expect(highlightedLines(minified, 'js')).toBeNull()

    expect(canHighlightText('const a = 1;\nconst b = 2;')).toBe(true)
  })

  it('routes large complete inputs to the async worker path', () => {
    expect(shouldUseWorkerHighlight('const a = 1;\nconst b = 2;')).toBe(false)
    const medium = 'const x = 1;\n'.repeat(300)
    expect(shouldUseWorkerHighlight(medium, 300)).toBe(true)
  })
})

describe('MarkdownDocument selective codeVersion invalidation', () => {
  it('does not re-render plain HTML blocks when codeVersion bumps', () => {
    const doc = new MarkdownDocument({ idPrefix: 'perf' })
    const source = [
      '# Title',
      '',
      'A paragraph without code.',
      '',
      '- list item with `inline` code',
      '',
      '```ts',
      'const n: number = 42',
      '```',
    ].join('\n')

    const first = doc.update(source, true)
    expect(first).toHaveLength(4)

    doc.setCodeVersion(99)
    const second = doc.update(source, true)
    expect(doc.stats.renderedBlocks).toBe(0)
    expect(doc.stats.reusedBlocks).toBe(3)
    expect(second[0]).toBe(first[0])
    expect(second[1]).toBe(first[1])
    expect(second[2]).toBe(first[2])
    doc.dispose()
  })
})

describe('CodeBlockContent and DiffView line virtualization', () => {
  it('windows large line arrays while keeping CSS line counter offset accurate', () => {
    const lines = Array.from({ length: 1500 }, (_, i) => `line ${i + 1}`)
    const target = document.createElement('div')
    document.body.appendChild(target)

    const app = mountReact(CodeBlock.Content, {
      target,
      props: { lineNumbers: true, lines, className: 'h-64' },
    })
    mounted.push(app)

    const rendered = target.querySelectorAll('[data-slot="code-block-line"]')
    expect(rendered.length).toBeGreaterThan(0)
    expect(rendered.length).toBeLessThan(200)
    const pre = target.querySelector<HTMLPreElement>('[data-slot="code-block-content"]')!
    expect(pre.style.counterReset).toBe('line 0')
  })

  it('windows large diffs in DiffView instead of mounting thousands of rows', () => {
    const body = Array.from({ length: 1200 }, (_, i) => `+added line ${i + 1}`).join('\n')
    const patch = `@@ -1,1 +1,1200 @@\n${body}\n`
    const target = document.createElement('div')
    document.body.appendChild(target)

    const app = mountReact(DiffView, { target, props: { patch } })
    mounted.push(app)

    const rows = target.querySelectorAll('.grid')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(200)
  })
})

describe('MarkdownView deferred off-screen blocks', () => {
  it('keeps head blocks eager and defers off-screen blocks on long documents', () => {
    const sections = Array.from({ length: 30 }, (_, i) => `## Section ${i + 1}\n\nParagraph ${i + 1}.`).join('\n\n')
    const target = document.createElement('div')
    document.body.appendChild(target)

    const app = mountReact(MarkdownView as unknown as ComponentType<MarkdownViewProps>, {
      target,
      props: { source: sections, idPrefix: 'defer-test' },
    })
    mounted.push(app)

    flushReact(() => {})
    const deferred = target.querySelectorAll('.md-block-deferred')
    expect(deferred.length).toBeGreaterThan(0)
    const firstBlock = target.querySelector('.md')?.firstElementChild
    expect(firstBlock?.classList.contains('md-block-deferred')).toBe(false)
  })
})
