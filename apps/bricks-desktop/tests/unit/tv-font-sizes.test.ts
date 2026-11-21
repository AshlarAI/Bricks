// The theme's font sizes (text-ui, text-caption, text-code, text-compact) are sizes for the class
// merge of both `cn` and the components' cva() variants: merged with a text colour, the colour stays.
import { cva } from 'class-variance-authority'
import { describe, expect, it } from 'vitest'
import { buttonVariants } from '../../src/lib/components/ui/button'
import { cn } from '../../src/lib/utils'

describe('theme font sizes and text colours', () => {
  it('cn keeps the colour next to a theme size', () => {
    expect(cn('text-primary-foreground', 'text-compact')).toBe('text-primary-foreground text-compact')
  })

  it('a cva() variant merged with cn keeps the colour next to a theme size', () => {
    const button = cva('inline-flex', {
      variants: { variant: { default: 'text-primary-foreground' }, size: { sm: 'text-compact' } },
    })
    const classes = cn(button({ variant: 'default', size: 'sm' }))
    expect(classes).toContain('text-primary-foreground')
    expect(classes).toContain('text-compact')
  })

  it('buttonVariants merged with cn keeps text-primary-foreground alongside compact text-ui', () => {
    const classes = cn(buttonVariants({ variant: 'default', size: 'compact' }))
    expect(classes).toContain('text-primary-foreground')
    expect(classes).toContain('text-ui')
  })
})
