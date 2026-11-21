import * as React from "react"
import { CheckIcon, CopyIcon } from "lucide-react"
import { Button } from "$lib/components/ui/button"
import { t, useLanguage } from "$lib/i18n/i18n"
import { cn } from "$lib/utils"

function CodeBlockCopyButton({
  className,
  value,
  variant = "ghost",
  size = "icon-xs",
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "value"> & {
  value: string
}) {
  useLanguage()

  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
  const mountedRef = React.useRef(true)

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(timeoutRef.current)
    }
  }, [])

  function copy() {
    if (!navigator.clipboard) return
    navigator.clipboard
      .writeText(value)
      .then(() => {
        if (!mountedRef.current) return
        setCopied(true)
        clearTimeout(timeoutRef.current)
        timeoutRef.current = setTimeout(() => {
          if (mountedRef.current) setCopied(false)
        }, 2000)
      })
      .catch(() => {})
  }

  return (
    <>
      <Button
        data-slot="code-block-copy-button"
        data-copied={copied || undefined}
        variant={variant}
        size={size}
        aria-label={copied ? t("common.copied") : t("common.copy")}
        className={cn(className)}
        {...props}
        onClick={(e) => {
          onClick?.(e)
          copy()
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
      <span aria-live="polite" className="sr-only">
        {copied ? t("common.copied") : ""}
      </span>
    </>
  )
}

export { CodeBlockCopyButton }
