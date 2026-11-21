import type { ReactNode } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import {
  BookOpenIcon,
  GitCompareIcon,
  MoveLeftIcon,
  MoveRightIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  TerminalIcon,
} from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '$lib/components/ui/tooltip'
import { Separator } from '$lib/components/ui/separator'
import PanelToggle from './PanelToggle'
import { TOP_BAR } from './constants'
import type { IconComponent } from './types'
import { cn } from '$lib/utils'

export interface TopBarProps {
  /** Where you are: the conversation and its project, left-aligned after the navigation. Truncated when long. */
  title?: ReactNode
  /** After the history arrows: the search of conversations. */
  search?: ReactNode
  /** History of the conversations visited. The arrows show only when onBack is set. */
  onBack?: () => void
  onForward?: () => void
  canGoBack?: boolean
  canGoForward?: boolean
  /** Right slot: actions, rendered before the panel toggles. */
  actions?: ReactNode
  /** Last slot, after the panel toggles (the « Plus » menu). */
  trailing?: ReactNode
  /** Visibility of the left panel. Its toggle sits at the top left, shown only when onToggleLeft is set. */
  leftPressed?: boolean
  onToggleLeft?: () => void
  rightPressed?: boolean
  onToggleRight?: () => void
  terminalPressed?: boolean
  onToggleTerminal?: () => void
  /** Visibility of the changes view (independent of the right panel). Toggle shown only when onToggleChanges is provided. */
  changesPressed?: boolean
  onToggleChanges?: () => void
  /** Visibility of the reader view of the right column. Toggle shown only when onToggleReader is provided. */
  readerPressed?: boolean
  onToggleReader?: () => void
  /** Leaves room on the left for the macOS window buttons drawn over the bar. */
  systemButtons?: boolean
  className?: string
}

function HistoryArrow({
  label,
  icon: Icon,
  enabled,
  onClick,
}: {
  label: string
  icon: IconComponent
  enabled: boolean
  onClick?: () => void
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label={label}
          disabled={!enabled}
          onClick={onClick}
        >
          <Icon aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function TopBar({
  title,
  search,
  onBack,
  onForward,
  canGoBack = false,
  canGoForward = false,
  actions,
  trailing,
  leftPressed = false,
  onToggleLeft,
  rightPressed = false,
  onToggleRight,
  terminalPressed = false,
  onToggleTerminal,
  changesPressed = false,
  onToggleChanges,
  readerPressed = false,
  onToggleReader,
  systemButtons = false,
  className,
}: TopBarProps) {
  useLanguage()
  const hasRightToggles = Boolean(onToggleRight || onToggleTerminal || onToggleChanges || onToggleReader)

  return (
    <header
      data-tauri-drag-region
      className={cn('flex shrink-0 items-center gap-2 bg-sidebar px-3', className)}
      style={{
        height: `${TOP_BAR.height}px`,
        paddingLeft: systemButtons ? `${TOP_BAR.macSystemButtons}px` : undefined,
      }}
    >
      <div data-tauri-drag-region className="flex shrink-0 items-center gap-0.5">
        {onToggleLeft && (
          <PanelToggle
            ariaLabel={t('layout.leftPanel')}
            tooltipShow={t('layout.showTheLeftPanel')}
            tooltipHide={t('layout.hideTheLeftPanel')}
            pressed={leftPressed}
            icon={leftPressed ? PanelLeftCloseIcon : PanelLeftOpenIcon}
            onclick={onToggleLeft}
          />
        )}
        {onBack && (
          <TooltipProvider delayDuration={400}>
            <HistoryArrow label={t('common.previous')} icon={MoveLeftIcon} enabled={canGoBack} onClick={onBack} />
            <HistoryArrow label={t('common.next')} icon={MoveRightIcon} enabled={canGoForward} onClick={onForward} />
            {search}
          </TooltipProvider>
        )}
      </div>

      <div data-tauri-drag-region className="ml-3 flex min-w-0 flex-1 items-center">
        {title}
      </div>

      <div data-tauri-drag-region className="flex shrink-0 items-center gap-1">
        {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}

        {hasRightToggles && (
          <div role="group" aria-label={t('layout.view')} className="ml-1 flex shrink-0 items-center gap-0.5">
            {onToggleRight && (
              <PanelToggle
                ariaLabel={t('layout.rightPanel')}
                tooltipShow={t('layout.showTheRightPanel')}
                tooltipHide={t('layout.hideTheRightPanel')}
                pressed={rightPressed}
                icon={rightPressed ? PanelRightCloseIcon : PanelRightOpenIcon}
                onclick={onToggleRight}
              />
            )}
            {onToggleRight && (onToggleTerminal || onToggleChanges || onToggleReader) && (
              <Separator orientation="vertical" decorative className="mx-1 h-5 self-center" />
            )}
            {onToggleTerminal && (
              <PanelToggle
                ariaLabel={t('common.terminal')}
                tooltipShow={t('layout.showTheTerminal')}
                tooltipHide={t('common.hideTheTerminal')}
                pressed={terminalPressed}
                icon={TerminalIcon}
                onclick={onToggleTerminal}
              />
            )}
            {onToggleChanges && (
              <PanelToggle
                ariaLabel={t('common.changes')}
                tooltipShow={t('layout.showChanges')}
                tooltipHide={t('layout.hideChanges')}
                pressed={changesPressed}
                icon={GitCompareIcon}
                onclick={onToggleChanges}
              />
            )}
            {onToggleReader && (
              <PanelToggle
                ariaLabel={t('common.reader')}
                tooltipShow={t('layout.showTheReader')}
                tooltipHide={t('layout.hideTheReader')}
                pressed={readerPressed}
                icon={BookOpenIcon}
                onclick={onToggleReader}
              />
            )}
          </div>
        )}

        {trailing && <div className="ml-1 flex shrink-0 items-center">{trailing}</div>}
      </div>
    </header>
  )
}

export default TopBar
