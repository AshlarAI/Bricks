import { t, useLanguage } from '$lib/i18n/i18n'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'

export interface PagerProps {
  /** Page shown, counted from 0. */
  page: number
  pages: number
  disabled?: boolean
  onchange: (page: number) => void
}

export function Pager({ page, pages, disabled = false, onchange }: PagerProps) {
  useLanguage()

  if (pages <= 1) return null

  return (
    <nav aria-label={t('catalog.pages')} className="flex items-center justify-between gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page <= 0}
        onClick={() => onchange(page - 1)}
      >
        <ChevronLeftIcon aria-hidden="true" />
        {t('catalog.previous')}
      </Button>
      <span className="text-xs tabular-nums text-muted-foreground">
        {t('common.pageOf', { value: page + 1, pages })}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled || page >= pages - 1}
        onClick={() => onchange(page + 1)}
      >
        {t('catalog.next')}
        <ChevronRightIcon aria-hidden="true" />
      </Button>
    </nav>
  )
}

export default Pager
