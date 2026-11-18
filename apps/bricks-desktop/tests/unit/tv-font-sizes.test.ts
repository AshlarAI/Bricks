// The theme's font sizes (text-ui, text-caption, text-code, text-compact) are sizes for the class
// merge of both `cn` and the components' variants: merged with a text colour, the colour stays.
import { describe, expect, it } from 'vitest'
import { cn } from '../../src/lib/utils'
import { tv } from 'tailwind-variants'

describe('theme font sizes and text colours', () => {
  it('cn keeps the colour next to a theme size', () => {
    expect(cn('text-primary-foreground', 'text-compact')).toBe('text-primary-foreground text-compact')
  })

  it('a tv() variant keeps the colour next to a theme size', () => {
    const button = tv({
      base: 'inline-flex',
      variants: { variant: { default: 'text-primary-foreground' }, size: { sm: 'text-compact' } },
    })
    const classes = button({ variant: 'default', size: 'sm' })
    expect(classes).toContain('text-primary-foreground')
    expect(classes).toContain('text-compact')
  })
})
