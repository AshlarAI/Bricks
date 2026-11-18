// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { terminalFont, terminalFontSize, terminalTheme } from '../../src/lib/features/terminal/terminal-theme'
import { readThemeTokens } from '../../src/lib/theme/resolved-theme'

afterEach(() => document.documentElement.removeAttribute('style'))

describe('library themes use the effective CSS variables', () => {
  it('reads the theme afresh: the cursor follows the text colour, the background the code one', () => {
    const root = document.documentElement
    root.style.setProperty('--foreground', '#1d1d1d')
    root.style.setProperty('--code-bg', '#f5f5f5')
    expect(terminalTheme()).toMatchObject({ cursor: '#1d1d1d', background: '#f5f5f5' })
    root.style.setProperty('--foreground', '#ebebeb')
    root.style.setProperty('--code-bg', '#0a0a0a')
    expect(terminalTheme()).toMatchObject({ cursor: '#ebebeb', background: '#0a0a0a' })
    root.style.removeProperty('--foreground')
    expect(terminalTheme()).not.toHaveProperty('cursor')
  })

  it('uses the resolved mono font and preserves the fallback without a value', () => {
    expect(terminalFont()).toBe('monospace')
    document.documentElement.style.setProperty('--code-font-family', '"Google Sans Code", monospace')
    expect(terminalFont()).toBe('"Google Sans Code", monospace')
  })

  it('uses the shared code size for xterm without changing its default', () => {
    expect(terminalFontSize()).toBe(13)
    document.documentElement.style.setProperty('--code-font-size', '15px')
    expect(terminalFontSize()).toBe(15)
  })

  it('omits missing values and colours an adapter cannot resolve', () => {
    document.documentElement.style.setProperty('--primary', '#a4512c')
    const mapping = { accent: '--primary', missing: '--missing' }
    expect(readThemeTokens(mapping)).toEqual({ accent: '#a4512c' })
    expect(readThemeTokens(mapping, () => null)).toEqual({})
  })
})
