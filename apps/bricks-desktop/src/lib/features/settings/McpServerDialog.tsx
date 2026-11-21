// Adds a server of the person's: a command (stdio) or a URL (Streamable HTTP).
import { useId, useState, type FormEvent } from 'react'
import { Button } from '$lib/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
import { Field, FieldError, FieldLabel } from '$lib/components/ui/field'
import { Input } from '$lib/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '$lib/components/ui/tabs'
import { Textarea } from '$lib/components/ui/textarea'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { McpServerInput } from '$lib/ipc/client'

export interface McpServerDialogProps {
  /** Resolves with the refusal, or `null` once added. */
  onSave: (input: McpServerInput) => Promise<string | null>
  onClose: () => void
}

const lines = (text: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '')

export function McpServerDialog({ onSave, onClose }: McpServerDialogProps) {
  useLanguage()
  const uid = useId()
  const [name, setName] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [url, setUrl] = useState('')
  const [pairs, setPairs] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /** Field errors, shown once an add has been tried, then kept up to date. */
  const [tried, setTried] = useState(false)

  const errors: Partial<Record<'name' | 'command' | 'url' | 'pairs', string>> = {}
  if (name.trim() === '') errors.name = t('settings.thisFieldIsRequired')
  if (transport === 'stdio' && command.trim() === '') errors.command = t('settings.thisFieldIsRequired')
  if (transport === 'http') {
    const address = url.trim()
    if (address === '') errors.url = t('settings.thisFieldIsRequired')
    else if (!/^https?:\/\/[^\s/]+/i.test(address)) errors.url = t('settings.mcpUrlInvalid')
  }
  const badPair = pairs.split('\n').findIndex((l) => l.trim() !== '' && !/^[^=\s]+=/.test(l.trim()))
  if (badPair >= 0) errors.pairs = t('settings.mcpPairInvalid', { line: badPair + 1 })

  const shown = tried ? errors : {}

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setTried(true)
    if (Object.keys(errors).length > 0) return
    setSaving(true)
    setError(null)
    const nextError = await onSave({
      name: name.trim(),
      transport,
      command: transport === 'stdio' ? command : '',
      url: transport === 'http' ? url.trim() : '',
      headers: transport === 'http' ? lines(pairs) : [],
      env: transport === 'stdio' ? lines(pairs) : [],
    })
    setSaving(false)
    if (nextError === null) onClose()
    else setError(nextError)
  }

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>{t('settings.mcpAdd')}</DialogTitle>
          </DialogHeader>

          <Field data-invalid={shown.name ? 'true' : undefined}>
            <FieldLabel htmlFor={`${uid}-name`}>{t('settings.name')}</FieldLabel>
            <Input
              id={`${uid}-name`}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              className="font-mono text-sm"
              aria-invalid={shown.name ? 'true' : undefined}
              aria-describedby={shown.name ? `${uid}-name-error` : undefined}
            />
            {shown.name && <FieldError id={`${uid}-name-error`}>{shown.name}</FieldError>}
          </Field>

          <Tabs value={transport} onValueChange={(v) => setTransport(v as 'stdio' | 'http')}>
            <TabsList className="w-full">
              <TabsTrigger value="stdio" className="flex-1">
                {t('settings.mcpCommand')}
              </TabsTrigger>
              <TabsTrigger value="http" className="flex-1">
                {t('settings.mcpUrl')}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {transport === 'stdio' ? (
            <Field data-invalid={shown.command ? 'true' : undefined}>
              <FieldLabel htmlFor={`${uid}-command`}>{t('settings.mcpCommand')}</FieldLabel>
              <Input
                aria-invalid={shown.command ? 'true' : undefined}
                aria-describedby={shown.command ? `${uid}-command-error` : undefined}
                id={`${uid}-command`}
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="npx -y @modelcontextprotocol/server-filesystem ."
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-sm"
              />
              {shown.command && <FieldError id={`${uid}-command-error`}>{shown.command}</FieldError>}
            </Field>
          ) : (
            <Field data-invalid={shown.url ? 'true' : undefined}>
              <FieldLabel htmlFor={`${uid}-url`}>{t('settings.mcpUrl')}</FieldLabel>
              <Input
                aria-invalid={shown.url ? 'true' : undefined}
                aria-describedby={shown.url ? `${uid}-url-error` : undefined}
                id={`${uid}-url`}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com/mcp"
                autoComplete="off"
                spellCheck={false}
                className="font-mono text-sm"
              />
              {shown.url && <FieldError id={`${uid}-url-error`}>{shown.url}</FieldError>}
            </Field>
          )}

          <Field data-invalid={shown.pairs ? 'true' : undefined}>
            <FieldLabel htmlFor={`${uid}-pairs`}>
              {transport === 'http' ? t('settings.mcpHeaders') : t('settings.mcpEnv')}
            </FieldLabel>
            <Textarea
              aria-invalid={shown.pairs ? 'true' : undefined}
              aria-describedby={shown.pairs ? `${uid}-pairs-error` : undefined}
              id={`${uid}-pairs`}
              value={pairs}
              onChange={(e) => setPairs(e.target.value)}
              rows={3}
              placeholder={transport === 'http' ? 'Authorization=Bearer ${TOKEN}' : 'NAME=value'}
              spellCheck={false}
              className="font-mono text-sm"
            />
            {shown.pairs && <FieldError id={`${uid}-pairs-error`}>{shown.pairs}</FieldError>}
          </Field>

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
              {t('common.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default McpServerDialog
