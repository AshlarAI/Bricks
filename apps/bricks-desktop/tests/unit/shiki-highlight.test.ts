// Shiki as HTML for code: the lines of a language once it is loaded (escaped text and theme
// variables), escaped text while it is not (and requested in the background), the names and
// aliases Shiki lists, the placeholders of Markdown code bodies, and a fence rendered as a whole.
// Shiki loads its grammars asynchronously: a test that needs colours waits for the load first.
import { describe, expect, it, vi } from 'vitest'
import { codeLanguages, highlightedLines, isHighlightable, plainLines } from '../../src/lib/code-highlight'
import { renderReference } from '../../src/lib/features/conversation/markdown/document'
import { withHighlights } from '../../src/lib/features/conversation/markdown/render'
import type { RenderedBlock } from '../../src/lib/features/conversation/markdown/types'
import { loadHighlighter } from '../../src/lib/highlighter'

// Without a DOM the sanitizer returns nothing. The placeholders of code are replaced after it, so
// the sanitizer is stubbed here, as in the other Markdown suites.
vi.mock('../../src/lib/features/conversation/markdown/sanitize', () => ({
  sanitizeMarkdown: (html: string) => html,
}))

const OPTIONS = { idPrefix: 'sh' }
const LOAD_TIMEOUT = { timeout: 10_000 }

/** The visible text of an HTML fragment: tags dropped, entities decoded. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function htmlOf(blocks: RenderedBlock[]): string {
  return blocks.map((block) => (block.kind === 'html' ? block.html : '')).join('')
}

describe('a language that is not loaded yet', () => {
  it('is null and requested, then its lines are escaped and coloured once it is loaded', async () => {
    const code = 'const html = "<script>alert(1)</script>";\nconst n = 1;'
    const before = codeLanguages.version
    expect(highlightedLines(code, 'javascript')).toBeNull()
    // The request is the load: the version changes once the grammar is in.
    await vi.waitFor(() => expect(codeLanguages.version).toBeGreaterThan(before), LOAD_TIMEOUT)

    const lines = highlightedLines(code, 'javascript') ?? []
    expect(lines).toHaveLength(2)
    expect(lines.map(textOf)).toEqual(code.split('\n'))
    expect(lines[0]).not.toMatch(/<script/)
    expect(lines[0]).toContain('&lt;')
    expect(lines.join('')).toContain('--shiki-light:')
  })
})

describe('the names of a language', () => {
  it('accepts the names Shiki lists and their aliases, and nothing else', () => {
    for (const name of ['javascript', 'ts', 'rs', 'c++', 'yml', 'py', 'sh']) {
      expect(isHighlightable(name), name).toBe(true)
    }
    expect(isHighlightable('nope')).toBe(false)
    expect(isHighlightable('')).toBe(false)
    expect(isHighlightable(null)).toBe(false)
    expect(isHighlightable(undefined)).toBe(false)
  })

  it('a name that is not listed is null and loads nothing', async () => {
    const before = codeLanguages.version
    expect(highlightedLines('let x = 1', 'nope')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(codeLanguages.version).toBe(before)
  })
})

describe('plainLines', () => {
  it('escapes each line and keeps no colour', () => {
    expect(plainLines('a<b\n"c" & d')).toEqual(['a&lt;b', '&quot;c&quot; &amp; d'])
  })
})

describe('a Markdown fence nested in a list', () => {
  it('is escaped text until its language loads, then Shiki tokens with theme variables and no placeholder', async () => {
    const source = '- étape\n\n  ```py\n  print("<b>hi</b>")\n  ```\n'
    const before = codeLanguages.version
    const plain = htmlOf(renderReference(source, OPTIONS))
    expect(plain).toContain('print(&quot;&lt;b&gt;hi&lt;/b&gt;&quot;)')
    expect(plain).not.toContain('--shiki')
    await vi.waitFor(() => expect(codeLanguages.version).toBeGreaterThan(before), LOAD_TIMEOUT)

    const html = htmlOf(renderReference(source, OPTIONS))
    expect(html).toContain('<code class="font-mono">')
    expect(html).toContain('class="text-(--shiki-light) dark:text-(--shiki-dark)"')
    expect(html).toContain('style="--shiki-light:')
    expect(html).not.toContain('data-shiki')
    expect(html).not.toContain('hljs')
    expect(textOf(html)).toContain('print("<b>hi</b>")')
  })
})

describe('withHighlights', () => {
  it('leaves a placeholder it does not know as its plain text', () => {
    const html = '<code class="font-mono"><span data-shiki="999999">a &lt; b</span></code>'
    expect(withHighlights(html)).toBe('<code class="font-mono">a &lt; b</code>')
  })

  it('returns HTML without placeholders untouched', () => {
    const html = '<p>texte <code>x</code></p>'
    expect(withHighlights(html)).toBe(html)
  })
})
