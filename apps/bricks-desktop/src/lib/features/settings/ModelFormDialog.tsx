// Form of a model: a new one (`model` null) or an existing one, from its values when opened.
// Cancel discards.
// Only counts above zero are checked here; the engine checks the rest. The reasoning levels are
// edited as a whole list and saved with the model: a level is a name, the first one applies
// until another is chosen.
import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { ButtonGroup } from '$lib/components/ui/button-group'
import { Checkbox } from '$lib/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
import { Field, FieldError, FieldLabel, FieldLegend, FieldSet } from '$lib/components/ui/field'
import { Input } from '$lib/components/ui/input'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Switch } from '$lib/components/ui/switch'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { ModelPatch } from '$lib/ipc/bindings/ModelPatch'
import type { ModelView } from '$lib/ipc/bindings/ModelView'
import { MODALITY_LABELS } from './format'
import {
  MODALITY_OPTIONS,
  PROFILE_ID_DUPLICATE,
  buildModelCreatePatch,
  buildModelPatch,
  displayName,
  draftLabel,
  hasFormErrors,
  isEmptyModelPatch,
  modelForm,
  newLevelDraft,
  newModelForm,
  profilesPatch,
  validateModelForm,
  type ModelForm,
  type WriteOutcome,
} from './models'

export interface ModelFormDialogProps {
  /** `null`: a new model. */
  model: ModelView | null
  /** The protocol the model speaks: a new level sends its effort in this protocol's field. */
  protocol: string
  /** Set when the dialog was reopened after the file changed elsewhere. */
  notice?: string | null
  /** Writes the patch (every field for a new model, else only the changed ones). */
  onSave: (patch: ModelPatch, id: string) => Promise<WriteOutcome>
  /** The dialog must go: closed by the user, or after a successful save. */
  onClose: () => void
}

export function ModelFormDialog({
  model,
  protocol,
  notice = null,
  onSave,
  onClose,
}: ModelFormDialogProps) {
  useLanguage()
  const uid = useId()
  const [original] = useState(() => model)
  const [form, setForm] = useState<ModelForm>(() => (original ? modelForm(original) : newModelForm()))
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The level being typed, added on Enter or with the button. */
  const [level, setLevel] = useState('')
  const [levelError, setLevelError] = useState<string | null>(null)

  const errors = validateModelForm(form)
  /** Field errors show once the user tried to save. */
  const shown = attempted ? errors : {}

  function addLevel() {
    const name = level.trim()
    if (name === '') return
    if (form.profiles.some((p) => p.id.trim() === name)) {
      setLevelError(PROFILE_ID_DUPLICATE())
      return
    }
    setForm((prev) => ({
      ...prev,
      profiles: [...prev.profiles, newLevelDraft(name, protocol)],
    }))
    setLevel('')
    setLevelError(null)
  }

  function onLevelKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    // Enter adds the level, it does not save the form.
    event.preventDefault()
    addLevel()
  }

  function removeLevel(index: number) {
    setForm((prev) => ({
      ...prev,
      profiles: prev.profiles.filter((_, i) => i !== index),
    }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setAttempted(true)

    let currentProfiles = form.profiles
    const pendingLevel = level.trim()
    if (pendingLevel !== '') {
      if (currentProfiles.some((p) => p.id.trim() === pendingLevel)) {
        setLevelError(PROFILE_ID_DUPLICATE())
        return
      }
      currentProfiles = [...currentProfiles, newLevelDraft(pendingLevel, protocol)]
      setForm((prev) => ({ ...prev, profiles: currentProfiles }))
      setLevel('')
      setLevelError(null)
    } else if (levelError) {
      return
    }

    if (hasFormErrors(errors)) return
    const nextForm = currentProfiles === form.profiles ? form : { ...form, profiles: currentProfiles }
    const profiles = profilesPatch(original?.profiles ?? [], nextForm.profiles)
    if (!profiles.ok) {
      setError(profiles.message)
      return
    }
    const patch = original
      ? buildModelPatch(original, nextForm, profiles.edits)
      : buildModelCreatePatch(nextForm, profiles.edits)
    if (original && isEmptyModelPatch(patch)) {
      onClose()
      return
    }
    setSaving(true)
    setError(null)
    const outcome = await onSave(patch, original ? original.id : '')
    setSaving(false)
    if (outcome.ok) onClose()
    else setError(outcome.message)
  }

  const priceFields = [
    { key: 'priceInput', label: t('common.enter') },
    { key: 'priceOutput', label: t('common.output') },
    { key: 'priceCache', label: t('settings.cache') },
  ] as const

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-h-[min(46rem,calc(100dvh-2rem))] overflow-hidden p-0 sm:max-w-lg">
        <ScrollArea viewportClass="max-h-[min(46rem,calc(100dvh-2rem))]">
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5 p-6" noValidate>
            <DialogHeader>
              <DialogTitle>
                {original
                  ? t('settings.editModel', { id: displayName(original.name, original.id) })
                  : t('settings.addAModel')}
              </DialogTitle>
            </DialogHeader>

            {notice && (
              <p role="alert" className="text-sm text-pretty text-destructive">
                {notice}
              </p>
            )}

            <Field data-invalid={shown.name ? 'true' : undefined}>
              <FieldLabel htmlFor={`${uid}-name`}>{t('settings.name')}</FieldLabel>
              <Input
                id={`${uid}-name`}
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                maxLength={120}
                autoComplete="off"
                aria-invalid={shown.name ? 'true' : undefined}
                aria-describedby={shown.name ? `${uid}-name-error` : undefined}
              />
              {shown.name && <FieldError id={`${uid}-name-error`}>{shown.name}</FieldError>}
            </Field>

            <Field data-invalid={shown.apiModel ? 'true' : undefined}>
              <FieldLabel htmlFor={`${uid}-api-model`}>{t('settings.apiName')}</FieldLabel>
              <Input
                id={`${uid}-api-model`}
                value={form.apiModel}
                onChange={(e) => setForm((prev) => ({ ...prev, apiModel: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-sm"
                aria-invalid={shown.apiModel ? 'true' : undefined}
                aria-describedby={shown.apiModel ? `${uid}-api-model-error` : undefined}
              />
              {shown.apiModel && (
                <FieldError id={`${uid}-api-model-error`}>{shown.apiModel}</FieldError>
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field data-invalid={shown.maxInput ? 'true' : undefined}>
                <FieldLabel htmlFor={`${uid}-max-input`}>
                  {t('settings.maximumInputTokens')}
                </FieldLabel>
                <Input
                  id={`${uid}-max-input`}
                  value={form.maxInput}
                  onChange={(e) => setForm((prev) => ({ ...prev, maxInput: e.target.value }))}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={shown.maxInput ? 'true' : undefined}
                  aria-describedby={shown.maxInput ? `${uid}-max-input-error` : undefined}
                />
                {shown.maxInput && (
                  <FieldError id={`${uid}-max-input-error`}>{shown.maxInput}</FieldError>
                )}
              </Field>

              <Field data-invalid={shown.maxOutput ? 'true' : undefined}>
                <FieldLabel htmlFor={`${uid}-max-output`}>
                  {t('settings.maximumOutputTokens')}
                </FieldLabel>
                <Input
                  id={`${uid}-max-output`}
                  value={form.maxOutput}
                  onChange={(e) => setForm((prev) => ({ ...prev, maxOutput: e.target.value }))}
                  inputMode="numeric"
                  autoComplete="off"
                  aria-invalid={shown.maxOutput ? 'true' : undefined}
                  aria-describedby={shown.maxOutput ? `${uid}-max-output-error` : undefined}
                />
                {shown.maxOutput && (
                  <FieldError id={`${uid}-max-output-error`}>{shown.maxOutput}</FieldError>
                )}
              </Field>
            </div>

            <FieldSet data-invalid={shown.modalities ? 'true' : undefined}>
              <FieldLegend variant="label">{t('settings.acceptedInputs')}</FieldLegend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MODALITY_OPTIONS.map((modality) => (
                  <Field key={modality} orientation="horizontal">
                    <Checkbox
                      id={`${uid}-modality-${modality}`}
                      checked={form.modalities.includes(modality)}
                      onCheckedChange={(on) => {
                        const checked = on === true
                        setForm((prev) => ({
                          ...prev,
                          modalities: checked
                            ? prev.modalities.includes(modality)
                              ? prev.modalities
                              : [...prev.modalities, modality]
                            : prev.modalities.filter((m) => m !== modality),
                        }))
                      }}
                    />
                    <FieldLabel htmlFor={`${uid}-modality-${modality}`} className="font-normal">
                      {MODALITY_LABELS[modality] ?? modality}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
              {shown.modalities && <FieldError>{shown.modalities}</FieldError>}
            </FieldSet>

            <FieldSet>
              <FieldLegend variant="label">{t('settings.costPerMtok')}</FieldLegend>
              <div className="grid gap-4 sm:grid-cols-3">
                {priceFields.map((field) => (
                  <Field key={field.key} data-invalid={shown[field.key] ? 'true' : undefined}>
                    <FieldLabel htmlFor={`${uid}-${field.key}`}>{field.label}</FieldLabel>
                    <Input
                      id={`${uid}-${field.key}`}
                      value={form[field.key]}
                      onChange={(e) =>
                        setForm((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                      inputMode="decimal"
                      autoComplete="off"
                      className="tabular-nums"
                      aria-invalid={shown[field.key] ? 'true' : undefined}
                      aria-describedby={shown[field.key] ? `${uid}-${field.key}-error` : undefined}
                    />
                    {shown[field.key] && (
                      <FieldError id={`${uid}-${field.key}-error`}>{shown[field.key]}</FieldError>
                    )}
                  </Field>
                ))}
              </div>
            </FieldSet>

            <Field data-invalid={levelError ? 'true' : undefined}>
              <FieldLabel htmlFor={`${uid}-level`}>{t('settings.reasoningLevels')}</FieldLabel>
              {form.profiles.length > 0 && (
                <ul
                  className="flex flex-wrap items-center gap-1.5"
                  aria-label={t('settings.reasoningLevels')}
                >
                  {form.profiles.map((profile, index) => (
                    <li
                      key={profile.id}
                      className="inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-border bg-background pr-1 pl-2.5 text-xs text-foreground"
                    >
                      <span className="truncate">{draftLabel(profile)}</span>
                      <button
                        type="button"
                        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-element-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        aria-label={t('settings.removeLevel', { level: draftLabel(profile) })}
                        onClick={() => removeLevel(index)}
                      >
                        <XIcon className="size-3" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <ButtonGroup className="w-full">
                <Input
                  id={`${uid}-level`}
                  value={level}
                  onChange={(e) => {
                    setLevel(e.target.value)
                    setLevelError(null)
                  }}
                  onKeyDown={onLevelKey}
                  maxLength={64}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                  placeholder={t('settings.level')}
                  aria-invalid={levelError ? 'true' : undefined}
                  aria-describedby={levelError ? `${uid}-level-error` : undefined}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={level.trim() === ''}
                  onClick={addLevel}
                >
                  {t('common.add')}
                </Button>
              </ButtonGroup>
              {levelError && <FieldError id={`${uid}-level-error`}>{levelError}</FieldError>}
            </Field>

            <label className="flex items-center justify-between gap-3 text-sm">
              {t('settings.asynchronousToolCalls')}
              <Switch
                checked={form.asyncToolCalls}
                onCheckedChange={(on) => setForm((prev) => ({ ...prev, asyncToolCalls: on }))}
              />
            </label>

            {error && (
              <p role="alert" className="text-sm text-pretty text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" disabled={saving}>
                {t('common.save')}
              </Button>
            </DialogFooter>
          </form>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  )
}

export default ModelFormDialog
