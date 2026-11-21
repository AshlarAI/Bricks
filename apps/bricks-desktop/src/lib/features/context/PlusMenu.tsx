// « Plus »: the ADK inspectors of the shown conversation, from the top bar.
import { Fragment } from 'react'
import { EllipsisVerticalIcon } from 'lucide-react'
import { DropdownMenu as DropdownMenuPrimitive } from 'radix-ui'
import { t, useLanguage } from '$lib/i18n/i18n'
import { buttonVariants } from '$lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '$lib/components/ui/dropdown-menu'
import { Switch } from '$lib/components/ui/switch'
import { useApp } from '$lib/state/app'
import { useConversation } from '$lib/state/conversation'
import { ui } from '$lib/state/ui'
import { cn } from '$lib/utils'
import { ADK_ACCESS_GROUPS } from './adkAccess'

export function PlusMenu() {
  useLanguage()
  const current = useApp((s) => s.current)
  const keepAwake = useConversation(current, (c) => c.keepAwake) ?? false

  // The menu opens inspectors that read the shown conversation: none without one.
  const enabled = current !== null

  function setKeepAwake(on: boolean) {
    current?.setKeepAwake(on)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-muted-foreground')}
        disabled={!enabled}
        aria-label={t('context.more')}
        title={t('context.more')}
      >
        <EllipsisVerticalIcon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64">
        {ADK_ACCESS_GROUPS.map((group, i) => (
          <Fragment key={group.items[0]?.view ?? i}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel>{group.label}</DropdownMenuLabel>
              {group.items.map((item) => (
                <DropdownMenuItem key={item.view} onSelect={() => ui.open(item.view)}>
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuPrimitive.CheckboxItem
          checked={keepAwake}
          onCheckedChange={(checked) => setKeepAwake(checked === true)}
          onSelect={(e) => e.preventDefault()}
          className="flex cursor-default items-center gap-3 rounded-sm px-2 py-1.5 outline-hidden select-none focus:bg-accent focus:text-accent-foreground"
        >
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-sm">{t('common.keepTheComputerAwake')}</span>
            <span className="text-xs text-muted-foreground">{t('context.onlyForThisSession')}</span>
          </span>
          {/* The settings' Switch, as the item's picture: the item itself is the control. */}
          <Switch checked={keepAwake} tabIndex={-1} aria-hidden="true" className="pointer-events-none" />
        </DropdownMenuPrimitive.CheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default PlusMenu
