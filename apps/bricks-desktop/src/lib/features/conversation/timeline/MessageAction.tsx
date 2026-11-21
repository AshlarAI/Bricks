// One action under a message: a ghost icon button named by its tooltip.
import type * as React from 'react'
import { Button } from '$lib/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip'

export interface MessageActionProps {
  /** Accessible name and tooltip. */
  label: string
  onclick: () => void
  disabled?: boolean
  ref?: React.Ref<HTMLButtonElement>
  children?: React.ReactNode
}

export function MessageAction({
  label,
  onclick,
  disabled = false,
  ref,
  children,
}: MessageActionProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          ref={ref}
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          disabled={disabled}
          onClick={onclick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export default MessageAction
