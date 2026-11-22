import { Toggle } from '$lib/components/ui/toggle'
import { Kbd } from '$lib/components/ui/kbd'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '$lib/components/ui/tooltip'
import type { IconComponent } from './types'
import { cn } from '$lib/utils'

export interface PanelToggleProps {
  /** Stable accessible name, e.g. "Panneau de gauche". Does not change with state. */
  ariaLabel: string
  /** Tooltip shown while the panel is hidden (the action opens it). */
  tooltipShow: string
  /** Tooltip shown while the panel is visible. */
  tooltipHide: string
  /** Whether the panel is currently visible. The toggle's pressed state. */
  pressed: boolean
  icon: IconComponent
  onclick: () => void
  /** Keyboard shortcut to show in the tooltip. Pass only when the shortcut really exists. */
  shortcut?: string
  disabled?: boolean
  className?: string
}

export function PanelToggle({
  ariaLabel,
  tooltipShow,
  tooltipHide,
  pressed,
  icon: Icon,
  onclick,
  shortcut,
  disabled = false,
  className,
}: PanelToggleProps) {
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Toggle
            size="sm"
            aria-label={ariaLabel}
            pressed={pressed}
            onPressedChange={() => onclick()}
            disabled={disabled}
            className={cn('size-8 min-w-8 px-0', className)}
          >
            <Icon aria-hidden="true" />
          </Toggle>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          <span>{pressed ? tooltipHide : tooltipShow}</span>
          {shortcut && <Kbd>{shortcut}</Kbd>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export default PanelToggle
