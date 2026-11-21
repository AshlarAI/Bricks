import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The font sizes of the theme (`text-ui`, `text-caption`...) are sizes, not colours: without this,
 * merging `text-compact` with `text-primary-foreground` drops the colour.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: ['ui', 'caption', 'code', 'compact'] }],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
