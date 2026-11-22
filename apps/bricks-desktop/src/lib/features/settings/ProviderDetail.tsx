// The right column of « Modèles »: one provider, edited in place. Its URL, API format and key
// are saved when they change (a field leaves or Enter), then come its models: test, edit,
// delete and the switch that offers each one in the model lists.
import { Fragment, useEffect, useId, useState, type KeyboardEvent } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  EllipsisIcon,
  ExternalLinkIcon,
  PencilIcon,
  PlusIcon,
  TrashIcon,
} from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '$lib/components/ui/dropdown-menu'
import { Field, FieldError, FieldGroup, FieldLabel } from '$lib/components/ui/field'
import { Input } from '$lib/components/ui/input'
import {
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
} from '$lib/components/ui/password-input'
import { ItemGroup, ItemSeparator } from '$lib/components/ui/item'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from '$lib/components/ui/select'
import { t, useLanguage } from '$lib/i18n/i18n'
import { errorMessage, modelTest } from '$lib/ipc/client'
import type { ModelView } from '$lib/ipc/bindings/ModelView'
import type { ProviderPatch } from '$lib/ipc/bindings/ProviderPatch'
import type { ProviderView } from '$lib/ipc/bindings/ProviderView'
import { cn } from '$lib/utils'
import { resolveChatError } from '../conversation/chat-error'
import ModelRow, { type ModelTest } from './ModelRow'
import ProviderLogo from './ProviderLogo'
import {
  KEY_URLS,
  PROTOCOL_OPTIONS,
  displayName,
  keyProblem,
  modelCountLabel,
  protocolLabel,
  providerFieldPatch,
  type WriteOutcome,
} from './models'

export interface ProviderDetailProps {
  provider: ProviderView
  onSave: (patch: ProviderPatch) => Promise<WriteOutcome>
  onToggleModel: (model: ModelView, enabled: boolean) => Promise<WriteOutcome>
  onEditProvider: () => void
  onDeleteProvider: () => void
  onEditModel: (model: ModelView) => void
  onDeleteModel: (model: ModelView) => void
  onAddModel: () => void
}

export function ProviderDetail({
  provider,
  onSave,
  onToggleModel,
  onEditProvider,
  onDeleteProvider,
  onEditModel,
  onDeleteModel,
  onAddModel,
}: ProviderDetailProps) {
  useLanguage()
  const uid = useId()
  const title = displayName(provider.name, provider.id)
  const keyUrl = provider.logo ? KEY_URLS[provider.logo] : undefined

  // The fields start from the file and follow it (another window, a conflict reload); what is
  // typed stays until it is saved or the field leaves.
  const savedEndpoint = provider.endpoint
  const savedKey = provider.api_key ?? ''
  const [endpoint, setEndpoint] = useState(savedEndpoint)
  const [apiKey, setApiKey] = useState(savedKey)
  const [revealed, setRevealed] = useState(false)
  const [saving, setSaving] = useState<'endpoint' | 'protocol' | 'key' | null>(null)
  const [fieldError, setFieldError] = useState<{
    field: 'endpoint' | 'protocol' | 'key'
    message: string
  } | null>(null)
  const [toggling, setToggling] = useState<string | null>(null)
  const [toggleError, setToggleError] = useState<string | null>(null)
  const [tests, setTests] = useState<Record<string, ModelTest>>({})

  useEffect(() => {
    setEndpoint(savedEndpoint)
  }, [savedEndpoint])

  useEffect(() => {
    setApiKey(savedKey)
  }, [savedKey])

  async function save(field: 'endpoint' | 'protocol' | 'key', patch: ProviderPatch) {
    if (saving) return
    setSaving(field)
    const outcome = await onSave(patch)
    setSaving(null)
    setFieldError(outcome.ok ? null : { field, message: outcome.message })
  }

  function saveEndpoint() {
    const value = endpoint.trim()
    if (value === '' || value === provider.endpoint) {
      setEndpoint(provider.endpoint)
      return
    }
    void save('endpoint', providerFieldPatch({ endpoint: value }))
  }

  function saveKey() {
    const value = apiKey.trim()
    if (value === savedKey) return
    // A provider that needs a key keeps one: clearing the field restores it.
    if (value === '') {
      setApiKey(savedKey)
      return
    }
    const problem = keyProblem(value)
    if (problem) {
      setFieldError({ field: 'key', message: problem })
      return
    }
    void save('key', providerFieldPatch({ api_key: value }))
  }

  function onEnter(event: KeyboardEvent<HTMLInputElement>, commit: () => void) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      commit()
    }
  }

  async function toggle(model: ModelView, enabled: boolean) {
    setToggling(model.id)
    const outcome = await onToggleModel(model, enabled)
    setToggling(null)
    setToggleError(outcome.ok ? null : outcome.message)
  }

  async function test(model: ModelView) {
    setTests((prev) => ({ ...prev, [model.id]: { state: 'running' } }))
    try {
      const ms = await modelTest(provider.id, model.id)
      setTests((prev) => ({ ...prev, [model.id]: { state: 'passed', ms } }))
    } catch (e) {
      setTests((prev) => ({
        ...prev,
        [model.id]: { state: 'failed', error: resolveChatError(errorMessage(e)).message },
      }))
    }
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby={`${uid}-name`}>
      <header className="flex items-center gap-2.5">
        <ProviderLogo logo={provider.logo} className="size-6" />
        <h4 id={`${uid}-name`} className="min-w-0 flex-1 truncate text-base font-semibold text-foreground">
          {title}
        </h4>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              aria-label={t('settings.moreProviderActions', { title })}
            >
              <EllipsisIcon />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onSelect={onEditProvider}>
                <PencilIcon />
                {t('common.edit')}
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={onDeleteProvider}>
                <TrashIcon />
                {t('common.delete')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      <FieldGroup>
        <Field data-invalid={fieldError?.field === 'endpoint' ? 'true' : undefined}>
          <FieldLabel htmlFor={`${uid}-endpoint`}>{t('settings.apiUrl')}</FieldLabel>
          <Input
            id={`${uid}-endpoint`}
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            disabled={saving === 'endpoint'}
            aria-invalid={fieldError?.field === 'endpoint' ? 'true' : undefined}
            onBlur={saveEndpoint}
            onKeyDown={(e) => onEnter(e, saveEndpoint)}
          />
          {fieldError?.field === 'endpoint' && <FieldError>{fieldError.message}</FieldError>}
        </Field>

        <Field data-invalid={fieldError?.field === 'protocol' ? 'true' : undefined}>
          <FieldLabel htmlFor={`${uid}-protocol`}>{t('settings.protocol')}</FieldLabel>
          <Select
            value={provider.protocol}
            onValueChange={(value) => {
              if (value && value !== provider.protocol) {
                void save('protocol', providerFieldPatch({ protocol: value }))
              }
            }}
            disabled={saving === 'protocol'}
          >
            <SelectTrigger id={`${uid}-protocol`} className="w-full">
              {protocolLabel(provider.protocol)}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {PROTOCOL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          {fieldError?.field === 'protocol' && <FieldError>{fieldError.message}</FieldError>}
        </Field>

        {provider.auth !== 'none' && (
          <Field data-invalid={fieldError?.field === 'key' ? 'true' : undefined}>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`${uid}-key`}>{t('settings.apiKey')}</FieldLabel>
              {keyUrl && (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  className="h-auto p-0"
                  onClick={() => void openUrl(keyUrl)}
                >
                  {t('settings.createAKey')}
                  <ExternalLinkIcon data-icon="inline-end" />
                </Button>
              )}
            </div>
            <PasswordInput visible={revealed} onVisibleChange={setRevealed}>
              <PasswordInputGroup>
                <PasswordInputInput
                  id={`${uid}-key`}
                  className={cn(!revealed && 'text-muted-foreground')}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={saving === 'key'}
                  aria-invalid={fieldError?.field === 'key' ? 'true' : undefined}
                  onBlur={saveKey}
                  onKeyDown={(e) => onEnter(e, saveKey)}
                />
                <PasswordInputTrigger />
              </PasswordInputGroup>
            </PasswordInput>
            {fieldError?.field === 'key' && <FieldError>{fieldError.message}</FieldError>}
          </Field>
        )}
      </FieldGroup>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-baseline gap-2">
            <h5 className="text-ui text-muted-foreground">{t('settings.models')}</h5>
            <span className="text-xs text-muted-foreground tabular-nums">
              {modelCountLabel(provider.models.length)}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            aria-label={t('settings.addAModelTo', { title })}
            onClick={onAddModel}
          >
            <PlusIcon data-icon="inline-start" />
            {t('settings.addAModel')}
          </Button>
        </div>

        {toggleError && (
          <p role="alert" className="text-ui text-destructive">
            {toggleError}
          </p>
        )}

        {provider.models.length > 0 && (
          <ItemGroup
            className="gap-0 rounded-lg border border-border has-data-[size=sm]:gap-0"
            aria-label={t('settings.modelsOf', { title })}
          >
            {provider.models.map((model, index) => (
              <Fragment key={model.id}>
                {index > 0 && <ItemSeparator className="my-0" />}
                <ModelRow
                  model={model}
                  test={tests[model.id] ?? null}
                  busy={toggling === model.id}
                  onTest={() => void test(model)}
                  onEdit={() => onEditModel(model)}
                  onDelete={() => onDeleteModel(model)}
                  onToggle={(enabled) => void toggle(model, enabled)}
                />
              </Fragment>
            ))}
          </ItemGroup>
        )}
      </div>
    </section>
  )
}

export default ProviderDetail
