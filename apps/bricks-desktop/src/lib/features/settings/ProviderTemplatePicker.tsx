// « Ajouter un fournisseur », in the right column: the providers Bricks adds in one step (a card
// each, grouped by brand), then « Créer un fournisseur personnalisé » (the provider form).
// A card opens its key form; « Ajouter » writes the provider with its current models.
import { useId, useState, type FormEvent } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ArrowLeftIcon,
  ChevronRightIcon,
  ExternalLinkIcon,
  PlusIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Alert, AlertDescription } from '$lib/components/ui/alert'
import { Button } from '$lib/components/ui/button'
import { Field, FieldLabel } from '$lib/components/ui/field'
import {
  PasswordInput,
  PasswordInputGroup,
  PasswordInputInput,
  PasswordInputTrigger,
} from '$lib/components/ui/password-input'
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from '$lib/components/ui/item'
import { Spinner } from '$lib/components/ui/spinner'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { ProviderTemplate } from '$lib/ipc/bindings/ProviderTemplate'
import ProviderLogo from './ProviderLogo'
import { keyProblem, protocolLabel } from './models'

export interface ProviderTemplatePickerProps {
  templates: ProviderTemplate[] | null
  loadError: string | null
  canGoBack: boolean
  onBack: () => void
  onCustom: () => void
  /** Resolves with an error message, or null once the provider is written. */
  onCreate: (template: ProviderTemplate, apiKey: string) => Promise<string | null>
}

export function ProviderTemplatePicker({
  templates,
  loadError,
  canGoBack,
  onBack,
  onCustom,
  onCreate,
}: ProviderTemplatePickerProps) {
  useLanguage()
  const uid = useId()
  const [chosen, setChosen] = useState<ProviderTemplate | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const brands: { brand: string; templates: ProviderTemplate[] }[] = []
  for (const template of templates ?? []) {
    let group = brands.find((g) => g.brand === template.brand)
    if (!group) {
      group = { brand: template.brand, templates: [] }
      brands.push(group)
    }
    group.templates.push(template)
  }

  function choose(template: ProviderTemplate) {
    setChosen(template)
    setApiKey('')
    setError(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!chosen || busy) return
    const problem = keyProblem(apiKey)
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    const nextError = await onCreate(chosen, apiKey.trim())
    setError(nextError)
    setBusy(false)
  }

  return (
    <section className="flex flex-col gap-5" aria-labelledby={`${uid}-title`}>
      <header className="flex items-center gap-2">
        {(chosen || canGoBack) && (
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={chosen ? t('settings.addAProvider') : t('settings.backToProviders')}
            onClick={() => (chosen ? setChosen(null) : onBack())}
            disabled={busy}
          >
            <ArrowLeftIcon />
          </Button>
        )}
        <h4 id={`${uid}-title`} className="text-base font-semibold text-foreground">
          {chosen ? chosen.name : t('settings.addAProvider')}
        </h4>
      </header>

      {chosen ? (
        <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)}>
          <div className="flex items-center gap-3">
            <ProviderLogo logo={chosen.logo} className="size-9" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-mono text-xs text-foreground">{chosen.endpoint}</span>
              <span className="text-xs text-muted-foreground">{protocolLabel(chosen.protocol)}</span>
            </div>
          </div>

          <Field>
            <div className="flex items-center justify-between gap-2">
              <FieldLabel htmlFor={`${uid}-key`}>{t('settings.apiKey')}</FieldLabel>
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto p-0"
                onClick={() => chosen && void openUrl(chosen.key_url)}
              >
                {t('settings.createAKey')}
                <ExternalLinkIcon data-icon="inline-end" />
              </Button>
            </div>
            <PasswordInput>
              <PasswordInputGroup>
                <PasswordInputInput
                  id={`${uid}-key`}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  disabled={busy}
                />
                <PasswordInputTrigger />
              </PasswordInputGroup>
            </PasswordInput>
          </Field>

          {error && (
            <Alert variant="destructive">
              <TriangleAlertIcon />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button type="submit" disabled={busy}>
              {busy && <Spinner data-icon="inline-start" />}
              {t('common.add')}
            </Button>
          </div>
        </form>
      ) : (
        <>
          {loadError && (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertDescription>{loadError}</AlertDescription>
            </Alert>
          )}

          {brands.map((group) => (
            <div key={group.brand} className="flex flex-col gap-2">
              <h5 className="text-ui text-muted-foreground">{group.brand}</h5>
              <ItemGroup className="grid grid-cols-1 gap-2 perspective-midrange sm:grid-cols-2">
                {group.templates.map((template) => (
                  <Item
                    key={template.id}
                    variant="outline"
                    asChild
                    className="bg-card text-left shadow-xs transition-[box-shadow,translate,rotate] duration-200 ease-out transform-3d hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-safe:hover:rotate-x-6"
                  >
                    <button type="button" onClick={() => choose(template)}>
                      <ItemMedia>
                        <ProviderLogo logo={template.logo} className="size-8" />
                      </ItemMedia>
                      <ItemContent>
                        <ItemTitle>{template.name}</ItemTitle>
                      </ItemContent>
                      <ItemActions>
                        <ChevronRightIcon className="text-muted-foreground" />
                      </ItemActions>
                    </button>
                  </Item>
                ))}
              </ItemGroup>
            </div>
          ))}

          <div className="flex flex-col gap-2">
            <h5 className="text-ui text-muted-foreground">{t('settings.otherProviders')}</h5>
            <ItemGroup className="grid grid-cols-1 gap-2 perspective-midrange sm:grid-cols-2">
              <Item
                variant="outline"
                asChild
                className="bg-card text-left shadow-xs transition-[box-shadow,translate,rotate] duration-200 ease-out transform-3d hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-safe:hover:rotate-x-6"
              >
                <button type="button" onClick={onCustom}>
                  <ItemMedia variant="icon" className="size-8 rounded-md bg-muted">
                    <PlusIcon />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{t('settings.createCustomProvider')}</ItemTitle>
                  </ItemContent>
                  <ItemActions>
                    <ChevronRightIcon className="text-muted-foreground" />
                  </ItemActions>
                </button>
              </Item>
            </ItemGroup>
          </div>
        </>
      )}
    </section>
  )
}

export default ProviderTemplatePicker
