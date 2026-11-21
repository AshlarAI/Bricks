// The model and its reasoning level, in one control: the model's name, then the level in a
// quieter tone. The menu lists the models by provider; a model with several levels opens them
// to its right, and picking a level picks the model with it and closes the menu.
import { Fragment, useEffect, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '$lib/components/ui/dropdown-menu'
import { CheckIcon, ChevronDownIcon } from 'lucide-react'
import type { ModelChoice } from '$lib/ipc/engine'

export interface ModelSelectProps {
  /** Opened from outside (`/model`, `/effort`); the menu reports its own state. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Selected `provider/model`, or `null` when none is chosen yet. */
  value: string | null
  /** The level in force for the selected model, `null` when it has none. */
  level: string | null
  models: ModelChoice[]
  disabled?: boolean
  /** Resolves with the refusal message, or `null` when the change is accepted. */
  onPick: (selection: string, level: string | null) => Promise<string | null>
}

export function ModelSelect({
  open: openProp,
  onOpenChange,
  value,
  level,
  models,
  disabled = false,
  onPick,
}: ModelSelectProps) {
  useLanguage()

  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen

  function handleOpenChange(next: boolean) {
    if (!isControlled) setInternalOpen(next)
    onOpenChange?.(next)
  }

  /** Shown choice: follows the props, shows a pick at once, reverts if refused. */
  const propSelection = value ?? ''
  const [optimistic, setOptimistic] = useState<{
    selection: string
    level: string | null
    forValue: string
    forLevel: string | null
  } | null>(null)

  useEffect(() => {
    setOptimistic(null)
  }, [propSelection, level])

  const shown =
    optimistic && optimistic.forValue === propSelection && optimistic.forLevel === level
      ? { selection: optimistic.selection, level: optimistic.level }
      : { selection: propSelection, level }

  /** Models grouped by provider, in catalogue order. */
  const groups: { provider: string; items: ModelChoice[] }[] = []
  for (const m of models) {
    const group = groups.find((g) => g.provider === m.provider)
    if (group) group.items.push(m)
    else groups.push({ provider: m.provider, items: [m] })
  }

  const current = models.find((m) => m.selection === shown.selection)

  function levelLabel(model: ModelChoice | undefined, id: string | null): string {
    if (!model || !id) return ''
    return model.profiles.find((p) => p.id === id)?.label ?? id
  }

  /** The level a model would run with: the one in force for the selected model, else its first. */
  function levelOf(model: ModelChoice): string | null {
    if (model.selection === shown.selection && shown.level) return shown.level
    return model.default_profile ?? model.profiles[0]?.id ?? null
  }

  const name =
    models.length === 0 ? t('composer.noModelConfigured2') : (current?.name ?? t('composer.chooseAModel'))
  const currentLevel = current ? levelLabel(current, levelOf(current)) : ''

  async function pick(selection: string, next: string | null) {
    if (selection === shown.selection && next === shown.level) return
    const before = shown
    setOptimistic({ selection, level: next, forValue: propSelection, forLevel: level })
    const refusal = await onPick(selection, next)
    if (refusal) {
      setOptimistic((curr) => {
        if (!curr || curr.selection !== selection || curr.level !== next) return curr
        return { selection: before.selection, level: before.level, forValue: propSelection, forLevel: level }
      })
    }
  }

  return (
    <DropdownMenu open={open} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger
        disabled={disabled || models.length === 0}
        className="group/model inline-flex h-control-md max-w-72 min-w-0 items-center gap-1.5 rounded-lg px-2 text-ui text-foreground outline-none hover:bg-element-hover focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=open]:bg-element-selected"
        aria-label={t('composer.model', { label: currentLevel ? `${name} ${currentLevel}` : name })}
      >
        <span className="truncate">{name}</span>
        {currentLevel && <span className="shrink-0 text-muted-foreground">{currentLevel}</span>}
        <ChevronDownIcon
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]/model:rotate-180"
          aria-hidden="true"
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-auto min-w-64 rounded-xl p-1.5 shadow-float">
        {groups.map((group, index) => (
          <Fragment key={group.provider}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup>
              <DropdownMenuLabel className="px-2 pt-1.5 pb-1 text-caption font-medium text-muted-foreground">
                {group.provider}
              </DropdownMenuLabel>
              {group.items.map((model) => {
                const selected = model.selection === shown.selection
                const modelLevel = levelOf(model)
                if (model.profiles.length > 1) {
                  return (
                    <DropdownMenuSub key={model.selection}>
                      <DropdownMenuSubTrigger className="h-8 gap-2 rounded-lg px-2 text-ui">
                        <span className="truncate">{model.name}</span>
                        <span className="shrink-0 text-muted-foreground">{levelLabel(model, modelLevel)}</span>
                        {selected && <CheckIcon className="ml-auto size-4 shrink-0" aria-hidden="true" />}
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className="min-w-40 rounded-xl p-1.5 shadow-float">
                        {model.profiles.map((profile) => (
                          <DropdownMenuItem
                            key={profile.id}
                            className="h-8 gap-2 rounded-lg px-2 text-ui"
                            onSelect={() => void pick(model.selection, profile.id)}
                          >
                            <span className="truncate">{profile.label}</span>
                            {selected && profile.id === modelLevel && (
                              <CheckIcon className="ml-auto size-4 shrink-0" aria-hidden="true" />
                            )}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )
                }
                return (
                  <DropdownMenuItem
                    key={model.selection}
                    className="h-8 gap-2 rounded-lg px-2 text-ui"
                    onSelect={() => void pick(model.selection, model.profiles[0]?.id ?? null)}
                  >
                    <span className="truncate">{model.name}</span>
                    {modelLevel && (
                      <span className="shrink-0 text-muted-foreground">{levelLabel(model, modelLevel)}</span>
                    )}
                    {selected && <CheckIcon className="ml-auto size-4 shrink-0" aria-hidden="true" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export default ModelSelect
