// Form of a provider: a new one (`provider` null) or an existing one, from its values when opened.
// Cancel discards.
import { useId, useState, type FormEvent } from 'react'
import { LockKeyholeIcon, LockKeyholeOpenIcon } from 'lucide-react'
import { Button } from '$lib/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '$lib/components/ui/field'
import { Input } from '$lib/components/ui/input'
import { InputGroup, InputGroupAddon, InputGroupInput } from '$lib/components/ui/input-group'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select'
import { Toggle } from '$lib/components/ui/toggle'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { ProviderPatch } from '$lib/ipc/bindings/ProviderPatch'
import type { ProviderView } from '$lib/ipc/bindings/ProviderView'
import { cn } from '$lib/utils'
import {
  AUTH_OPTIONS,
  PROTOCOL_OPTIONS,
  authLabel,
  buildProviderCreatePatch,
  buildProviderPatch,
  displayName,
  hasFormErrors,
  isEmptyProviderPatch,
  newProviderForm,
  protocolLabel,
  providerForm,
  validateProviderForm,
  type ProviderForm,
  type WriteOutcome,
} from './models'

export interface ProviderFormDialogProps {
  /** `null`: a new provider. */
  provider: ProviderView | null
  /** Set when the dialog was reopened after the file changed elsewhere. */
  notice?: string | null
  /** Writes the patch: every field for a new provider, else only the changed ones. */
  onSave: (patch: ProviderPatch, id: string) => Promise<WriteOutcome>
  /** The dialog must go: closed by the user, or after a successful save. */
  onClose: () => void
}

export function ProviderFormDialog({
  provider,
  notice = null,
  onSave,
  onClose,
}: ProviderFormDialogProps) {
  useLanguage()
  const uid = useId()
  const [original] = useState(() => provider)
  const [form, setForm] = useState<ProviderForm>(() =>
    original ? providerForm(original) : newProviderForm(),
  )
  const [attempted, setAttempted] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** The key shows in clear while this is on. */
  const [revealed, setRevealed] = useState(false)

  const needsKey = form.auth !== 'none'
  const errors = validateProviderForm(form)
  /** Field messages show once the user tried to save. */
  const shown = attempted ? errors : {}

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setAttempted(true)
    if (hasFormErrors(errors)) return
    const patch = original ? buildProviderPatch(original, form) : buildProviderCreatePatch(form)
    if (original && isEmptyProviderPatch(patch)) {
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

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-h-[min(44rem,calc(100dvh-2rem))] overflow-hidden p-0 sm:max-w-lg">
        <ScrollArea viewportClass="max-h-[min(44rem,calc(100dvh-2rem))]">
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5 p-6">
            <DialogHeader>
              <DialogTitle>
                {original
                  ? t('settings.editProvider', { id: displayName(original.name, original.id) })
                  : t('settings.addAProvider')}
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

            <Field data-invalid={shown.endpoint ? 'true' : undefined}>
              <FieldLabel htmlFor={`${uid}-endpoint`}>{t('settings.apiUrl')}</FieldLabel>
              <Input
                id={`${uid}-endpoint`}
                value={form.endpoint}
                onChange={(e) => setForm((prev) => ({ ...prev, endpoint: e.target.value }))}
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-sm"
                aria-invalid={shown.endpoint ? 'true' : undefined}
                aria-describedby={shown.endpoint ? `${uid}-endpoint-error` : undefined}
              />
              {shown.endpoint && (
                <FieldError id={`${uid}-endpoint-error`}>{shown.endpoint}</FieldError>
              )}
            </Field>

            <Field>
              <FieldLabel htmlFor={`${uid}-protocol`}>{t('settings.protocol')}</FieldLabel>
              <Select
                value={form.protocol}
                onValueChange={(next) => {
                  if (next !== undefined) setForm((prev) => ({ ...prev, protocol: next }))
                }}
              >
                <SelectTrigger id={`${uid}-protocol`} className="w-full">
                  <span className="truncate">{protocolLabel(form.protocol)}</span>
                </SelectTrigger>
                <SelectContent>
                  {PROTOCOL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            <Field>
              <FieldLabel htmlFor={`${uid}-auth`}>{t('settings.authentication')}</FieldLabel>
              <Select
                value={form.auth}
                onValueChange={(next) => {
                  if (next !== undefined) setForm((prev) => ({ ...prev, auth: next }))
                }}
              >
                <SelectTrigger id={`${uid}-auth`} className="w-full">
                  <span className="truncate">{authLabel(form.auth)}</span>
                </SelectTrigger>
                <SelectContent>
                  {AUTH_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>

            {form.auth === 'api_key_header' && (
              <Field>
                <FieldLabel htmlFor={`${uid}-header`}>{t('settings.keyHeader')}</FieldLabel>
                <Input
                  id={`${uid}-header`}
                  value={form.authHeader}
                  onChange={(e) => setForm((prev) => ({ ...prev, authHeader: e.target.value }))}
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono text-sm"
                />
              </Field>
            )}

            {needsKey && (
              <Field data-invalid={shown.apiKey ? 'true' : undefined}>
                <FieldLabel htmlFor={`${uid}-key`}>{t('settings.apiKey')}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id={`${uid}-key`}
                    type={revealed ? 'text' : 'password'}
                    value={form.apiKey}
                    onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                    autoComplete="off"
                    spellCheck={false}
                    className={cn(
                      'font-mono text-sm transition-colors',
                      revealed ? 'text-foreground' : 'tracking-[0.2em] text-muted-foreground',
                    )}
                    aria-invalid={shown.apiKey ? 'true' : undefined}
                    aria-describedby={shown.apiKey ? `${uid}-key-error` : undefined}
                  />
                  <InputGroupAddon align="inline-end">
                    <Toggle
                      size="sm"
                      aria-label={revealed ? t('settings.hideKey') : t('settings.showKey')}
                      className="size-8 rounded-md px-0 active:scale-[0.96] aria-pressed:bg-muted data-[state=on]:bg-muted"
                      pressed={revealed}
                      onPressedChange={setRevealed}
                    >
                      {revealed ? (
                        <LockKeyholeOpenIcon aria-hidden="true" />
                      ) : (
                        <LockKeyholeIcon aria-hidden="true" />
                      )}
                    </Toggle>
                  </InputGroupAddon>
                </InputGroup>
                {shown.apiKey && (
                  <FieldError id={`${uid}-key-error`}>{shown.apiKey}</FieldError>
                )}
              </Field>
            )}

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

export default ProviderFormDialog
