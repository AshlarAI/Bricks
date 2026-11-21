// The left column of « Modèles »: the providers, those of a known brand first, each with its
// logo and a dot (green: usable; orange: no key or no model). Narrow, only the logos show.
import { CircleIcon } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '$lib/components/ui/tooltip'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { ProviderView } from '$lib/ipc/bindings/ProviderView'
import { cn } from '$lib/utils'
import ProviderLogo from './ProviderLogo'
import { displayName, providerGroups, providerReady, providerStatusLabel } from './models'

export interface ProviderNavProps {
  providers: ProviderView[]
  selected: string | null
  onSelect: (id: string) => void
}

export function ProviderNav({ providers, selected, onSelect }: ProviderNavProps) {
  useLanguage()
  const groups = providerGroups(providers)

  return (
    <TooltipProvider delayDuration={0}>
      <nav className="flex flex-col gap-3 px-1.5 py-2 md:px-2" aria-label={t('settings.providers')}>
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-1 max-md:items-center">
            <h4 className="flex h-7 items-center px-2 text-xs font-semibold text-muted-foreground max-md:sr-only">
              {group.id === 'custom' ? t('settings.customProviders') : group.title}
            </h4>
            {group.providers.map((provider) => {
              const title = displayName(provider.name, provider.id)
              const ready = providerReady(provider)
              return (
                <Tooltip key={provider.id}>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-current={selected === provider.id ? 'true' : undefined}
                      className={cn(
                        'relative flex h-8 w-full items-center gap-2 rounded-lg border px-2 text-left text-ui font-medium text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:size-8 max-md:justify-center max-md:px-0',
                        selected === provider.id
                          ? 'border-border-strong bg-element-selected'
                          : 'border-transparent hover:border-border hover:bg-element-hover',
                      )}
                      onClick={() => onSelect(provider.id)}
                    >
                      <ProviderLogo logo={provider.logo} className="size-4" />
                      <span className="min-w-0 flex-1 truncate max-md:sr-only">{title}</span>
                      <CircleIcon
                        className={cn(
                          'size-2 shrink-0 fill-current max-md:absolute max-md:right-0.5 max-md:bottom-0.5',
                          ready ? 'text-success' : 'text-warning',
                        )}
                        aria-label={providerStatusLabel(provider)}
                      />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="md:hidden">
                    {title}
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        ))}
      </nav>
    </TooltipProvider>
  )
}

export default ProviderNav
