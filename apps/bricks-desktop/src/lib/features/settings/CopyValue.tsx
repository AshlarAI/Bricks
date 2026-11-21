import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { CheckIcon, CopyIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { t, useLanguage } from '$lib/i18n/i18n'

export interface CopyValueProps {
  /** Visible name of the value, used in the button label. */
  label: string
  value: string
}

export function CopyValue({ label, value }: CopyValueProps) {
  useLanguage()
  const [copied, setCopied] = useState(false)
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
    }
  }, [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => setCopied(false), 1500)
      toast.success(t('settings.copied', { label }))
    } catch {
      toast.error(t('settings.couldNotCopy', { label }))
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2">
      <code
        className="min-w-0 flex-1 truncate rounded-md px-0 py-1 font-mono text-xs text-foreground"
        title={value}
      >
        {value}
      </code>
      <Button
        variant="outline"
        size="sm"
        onClick={() => void copy()}
        aria-label={t('settings.copy', { label })}
      >
        {copied ? (
          <CheckIcon aria-hidden="true" data-icon="inline-start" />
        ) : (
          <CopyIcon aria-hidden="true" data-icon="inline-start" />
        )}
        {copied ? t('common.copied') : t('common.copy')}
      </Button>
    </div>
  )
}

export default CopyValue
