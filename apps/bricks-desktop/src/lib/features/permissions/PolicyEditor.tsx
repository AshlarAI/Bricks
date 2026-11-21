// Edits a permission policy: the profile, and for CUSTOM an effect per class of
// action and per tool. Every change is handed to `onchange` as a whole policy;
// the caller saves it and passes the policy in force back.
import { useId, useState } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { XIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { Input } from '$lib/components/ui/input'
import { Field, FieldLabel } from '$lib/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select'
import type { PermissionEffect, SessionPolicy } from '$lib/ipc/engine'
import {
  CLASS_ROWS,
  EFFECT_OPTIONS,
  PROFILE_OPTIONS,
  effectLabel,
  isPermissionEffect,
  isPermissionProfile,
  toolRules,
  withClass,
  withProfile,
  withTool,
} from './policy'

export interface PolicyEditorProps {
  policy: SessionPolicy
  /** Tool names offered for a rule of their own; empty: the name is typed. */
  tools?: readonly string[]
  disabled?: boolean
  onchange: (policy: SessionPolicy) => void
}

function EffectSelect({
  id,
  value,
  label,
  disabled,
  onPick,
}: {
  id: string
  value: PermissionEffect
  label: string
  disabled: boolean
  onPick: (next: string | undefined) => void
}) {
  return (
    <Select value={value} onValueChange={onPick} disabled={disabled}>
      <SelectTrigger id={id} className="w-36" aria-label={label}>
        <span className="truncate">{effectLabel(value)}</span>
      </SelectTrigger>
      <SelectContent>
        {EFFECT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function PolicyEditor({ policy, tools = [], disabled = false, onchange }: PolicyEditorProps) {
  useLanguage()
  const uid = useId()
  const [newTool, setNewTool] = useState('')

  const profile = policy.chosen ? policy.profile : undefined
  const selectedProfile = PROFILE_OPTIONS.find((o) => o.value === profile)
  const rules = toolRules(policy)
  const free = tools.filter((name) => !(name in policy.custom.tools))

  function chooseProfile(next: string | undefined) {
    if (!isPermissionProfile(next) || (policy.chosen && next === policy.profile)) return
    onchange(withProfile(policy, next))
  }

  function chooseClass(key: (typeof CLASS_ROWS)[number]['key'], next: string | undefined) {
    if (!isPermissionEffect(next) || next === policy.custom[key]) return
    onchange(withClass(policy, key, next))
  }

  function chooseTool(name: string, next: string | undefined) {
    if (!isPermissionEffect(next) || next === policy.custom.tools[name]) return
    onchange(withTool(policy, name, next))
  }

  function addTool(name: string) {
    const trimmed = name.trim()
    if (!trimmed || trimmed in policy.custom.tools) return
    onchange(withTool(policy, trimmed, 'ask'))
    setNewTool('')
  }

  return (
    <div className="flex flex-col gap-4">
      <Field>
        <FieldLabel htmlFor={`${uid}-profile`} className="text-xs text-muted-foreground">
          {t('permissions.profile')}
        </FieldLabel>
        <Select value={profile ?? ''} onValueChange={chooseProfile} disabled={disabled}>
          <SelectTrigger id={`${uid}-profile`} className="w-full max-w-72">
            <span className="truncate">{selectedProfile ? selectedProfile.label : t('permissions.toChoose')}</span>
          </SelectTrigger>
          <SelectContent>
            {PROFILE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value} title={option.detail}>
                <span className="font-medium">{option.label}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      {profile === 'custom' && (
        <>
          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">{t('permissions.perAction')}</h4>
            <ul className="flex flex-col gap-2">
              {CLASS_ROWS.map((row) => (
                <li key={row.key}>
                  <Field orientation="horizontal" className="justify-between gap-3">
                    <FieldLabel htmlFor={`${uid}-${row.key}`} className="text-sm font-normal">
                      {row.label}
                    </FieldLabel>
                    <EffectSelect
                      id={`${uid}-${row.key}`}
                      value={policy.custom[row.key]}
                      label={row.label}
                      disabled={disabled}
                      onPick={(next) => chooseClass(row.key, next)}
                    />
                  </Field>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <h4 className="text-xs font-medium text-muted-foreground">{t('permissions.perTool')}</h4>
            {rules.length > 0 && (
              <ul className="flex flex-col gap-2">
                {rules.map((rule) => (
                  <li key={rule.name} className="flex items-center justify-between gap-3">
                    <span className="min-w-0 font-mono text-xs break-all">{rule.name}</span>
                    <div className="flex items-center gap-1">
                      <EffectSelect
                        id={`${uid}-tool-${rule.name}`}
                        value={rule.effect}
                        label={rule.name}
                        disabled={disabled}
                        onPick={(next) => chooseTool(rule.name, next)}
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-8"
                        aria-label={t('permissions.removeTheRuleFor', { name: rule.name })}
                        disabled={disabled}
                        onClick={() => onchange(withTool(policy, rule.name, null))}
                      >
                        <XIcon aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {tools.length > 0 ? (
              free.length > 0 && (
                <Select value="" onValueChange={(name) => name && addTool(name)} disabled={disabled}>
                  <SelectTrigger className="w-full max-w-72" aria-label={t('permissions.addARuleForATool')}>
                    <span className="truncate text-muted-foreground">{t('permissions.addATool')}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {free.map((name) => (
                      <SelectItem key={name} value={name}>
                        <span className="font-mono text-xs">{name}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )
            ) : (
              <form
                className="flex max-w-72 items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  addTool(newTool)
                }}
              >
                <Input
                  value={newTool}
                  onChange={(e) => setNewTool(e.target.value)}
                  placeholder={t('permissions.toolName')}
                  aria-label={t('permissions.toolName')}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-xs"
                  disabled={disabled}
                />
                <Button type="submit" size="sm" variant="outline" disabled={disabled || !newTool.trim()}>
                  {t('common.add')}
                </Button>
              </form>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default PolicyEditor
