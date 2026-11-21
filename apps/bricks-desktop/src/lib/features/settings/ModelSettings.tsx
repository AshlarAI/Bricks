// « Modèles » of the settings: the providers of the providers file in two columns (the list,
// then the selected provider or « Ajouter un fournisseur »). Reads and writes the file through
// the IPC; every write carries the revision last read.
import { useCallback, useEffect, useRef, useState } from 'react'
import { PlusIcon, RefreshCwIcon, TriangleAlertIcon } from 'lucide-react'
import { Alert, AlertDescription } from '$lib/components/ui/alert'
import { Button } from '$lib/components/ui/button'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { ModelPatch } from '$lib/ipc/bindings/ModelPatch'
import type { ModelView } from '$lib/ipc/bindings/ModelView'
import type { ProviderPatch } from '$lib/ipc/bindings/ProviderPatch'
import type { ProviderTemplate } from '$lib/ipc/bindings/ProviderTemplate'
import type { ProviderView } from '$lib/ipc/bindings/ProviderView'
import type { ProvidersFile } from '$lib/ipc/bindings/ProvidersFile'
import {
  errorMessage,
  modelCreate,
  modelDelete,
  modelUpdate,
  providerCreate,
  providerCreateFromTemplate,
  providerDelete,
  providerTemplates,
  providerUpdate,
  providersConfig,
  providersFillMissingPrices,
} from '$lib/ipc/client'
import { app } from '$lib/state/app'
import { cn } from '$lib/utils'
import DeleteDialog from './DeleteDialog'
import ModelFormDialog from './ModelFormDialog'
import ProviderDetail from './ProviderDetail'
import ProviderFormDialog from './ProviderFormDialog'
import ProviderNav from './ProviderNav'
import ProviderTemplatePicker from './ProviderTemplatePicker'
import {
  CONFLICT_MESSAGE,
  displayName,
  enabledPatch,
  providerDeletionDetail,
  unpricedModels,
  writeFailure,
  type WriteOutcome,
} from './models'

/**
 * The one dialog open at a time, with the provider (and model) it concerns. `notice` is set when
 * the dialog was reopened after the file changed elsewhere.
 */
type DialogState =
  | { kind: 'create-provider'; notice?: string }
  | { kind: 'create-model'; provider: ProviderView; notice?: string }
  | { kind: 'edit-provider'; provider: ProviderView; notice?: string }
  | { kind: 'edit-model'; provider: ProviderView; model: ModelView; notice?: string }
  | { kind: 'delete-provider'; provider: ProviderView; notice?: string }
  | { kind: 'delete-model'; provider: ProviderView; model: ModelView; notice?: string }

export function ModelSettings() {
  useLanguage()
  const [file, setFile] = useState<ProvidersFile | null>(null)
  const fileRef = useRef<ProvidersFile | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<DialogState | null>(null)
  const dialogRef = useRef<DialogState | null>(null)
  const [dialogKey, setDialogKey] = useState(0)
  /** Set when the target of a reopened dialog no longer exists in the file. */
  const [pageNotice, setPageNotice] = useState<string | null>(null)

  /** The provider shown on the right, or `add` for « Ajouter un fournisseur ». */
  const [selected, setSelected] = useState<string | null>(null)
  const [templates, setTemplates] = useState<ProviderTemplate[] | null>(null)
  const [templatesError, setTemplatesError] = useState<string | null>(null)
  const [filling, setFilling] = useState(false)
  const [fillError, setFillError] = useState<string | null>(null)

  /** The writes run one after the other, each with the revision its predecessor left. */
  const writesRef = useRef<Promise<unknown>>(Promise.resolve())

  const updateFile = useCallback((next: ProvidersFile | null) => {
    fileRef.current = next
    setFile(next)
  }, [])

  const updateDialog = useCallback((next: DialogState | null) => {
    dialogRef.current = next
    setDialog(next)
    if (next !== null) setDialogKey((k) => k + 1)
  }, [])

  const providers = file?.providers ?? []
  const current =
    selected === 'add' ? null : (providers.find((p) => p.id === selected) ?? providers[0] ?? null)
  const adding = selected === 'add' || (file !== null && providers.length === 0)
  const unpriced = unpricedModels(providers)

  const loadTemplates = useCallback(async () => {
    try {
      const next = await providerTemplates()
      setTemplates(next)
      setTemplatesError(null)
    } catch (e) {
      setTemplatesError(errorMessage(e))
    }
  }, [])

  /** Reads the file. Resolves with whether it could be read. */
  const load = useCallback(async (): Promise<boolean> => {
    setLoading(true)
    try {
      const next = await providersConfig()
      updateFile(next)
      setLoadError(null)
      return true
    } catch (e) {
      setLoadError(errorMessage(e))
      return false
    } finally {
      setLoading(false)
    }
  }, [updateFile])

  useEffect(() => {
    void load()
    void loadTemplates()
  }, [load, loadTemplates])

  function openDialog(next: DialogState) {
    setPageNotice(null)
    updateDialog(next)
  }

  function closeDialog() {
    updateDialog(null)
  }

  /**
   * The file changed elsewhere. It is read again and the open dialog starts over from the fresh
   * values, with a notice: nothing typed before is sent with the stale revision. When the target
   * is gone, the dialog closes and the page says so. If the file cannot be read, the dialog closes.
   */
  const reopenAfterConflict = useCallback(async () => {
    const open = dialogRef.current
    const reloaded = await load()
    const fresh = fileRef.current
    if (!open) return
    if (!reloaded || !fresh) {
      updateDialog(null)
      return
    }
    // A creation keeps what was typed: the same dialog stays open and the next save uses the
    // fresh revision (the ids are checked again against the file).
    if (open.kind === 'create-provider') return
    const provider = fresh.providers.find((p) => p.id === open.provider.id)
    if (!provider) {
      updateDialog(null)
      setPageNotice(
        t('settings.providerNoLongerExistsInThe', {
          id: displayName(open.provider.name, open.provider.id),
        }),
      )
      return
    }
    if (open.kind === 'create-model') return
    if (open.kind === 'edit-provider' || open.kind === 'delete-provider') {
      updateDialog({ kind: open.kind, provider, notice: CONFLICT_MESSAGE() })
      return
    }
    const model = provider.models.find((m) => m.id === open.model.id)
    if (!model) {
      updateDialog(null)
      setPageNotice(
        t('settings.modelNoLongerExistsInThe', {
          id: displayName(open.model.name, open.model.id),
        }),
      )
      return
    }
    updateDialog({ kind: open.kind, provider, model, notice: CONFLICT_MESSAGE() })
  }, [load, updateDialog])

  /**
   * Runs one write with the revision last read. The reply replaces the file and the catalogue of
   * the composer is reloaded. A stale revision goes through `reopenAfterConflict`.
   */
  const writeNow = useCallback(
    async (run: (revision: string) => Promise<ProvidersFile>): Promise<WriteOutcome> => {
      const currentFile = fileRef.current
      if (!currentFile) {
        return {
          ok: false,
          message: t('settings.theProvidersFileHasntBeenRead'),
          conflict: false,
        }
      }
      try {
        const nextFile = await run(currentFile.revision)
        updateFile(nextFile)
        void app.reloadModels()
        return { ok: true }
      } catch (e) {
        const outcome = writeFailure(e)
        if (!outcome.ok && outcome.conflict) await reopenAfterConflict()
        return outcome
      }
    },
    [reopenAfterConflict, updateFile],
  )

  function write(run: (revision: string) => Promise<ProvidersFile>): Promise<WriteOutcome> {
    const next = writesRef.current.then(() => writeNow(run))
    writesRef.current = next
    return next
  }

  async function createFromTemplate(
    template: ProviderTemplate,
    apiKey: string,
  ): Promise<string | null> {
    let before = new Set<string>()
    const outcome = await write((revision) => {
      before = new Set((fileRef.current?.providers ?? []).map((p) => p.id))
      return providerCreateFromTemplate(template.id, apiKey === '' ? null : apiKey, revision)
    })
    if (!outcome.ok) return outcome.message
    setSelected(fileRef.current?.providers.find((p) => !before.has(p.id))?.id ?? null)
    return null
  }

  async function fillMissingPrices() {
    if (filling) return
    setFilling(true)
    const outcome = await write((revision) => providersFillMissingPrices(revision))
    setFilling(false)
    setFillError(outcome.ok ? null : outcome.message)
  }

  function saveProvider(provider: ProviderView, patch: ProviderPatch): Promise<WriteOutcome> {
    return write((revision) => providerUpdate(provider.id, patch, revision))
  }

  function saveModel(
    provider: ProviderView,
    model: ModelView,
    patch: ModelPatch,
  ): Promise<WriteOutcome> {
    return write((revision) => modelUpdate(provider.id, model.id, patch, revision))
  }

  /** The id is made by the backend from the name: the new provider is the one not there before. */
  async function createProvider(id: string, patch: ProviderPatch): Promise<WriteOutcome> {
    let before = new Set<string>()
    const outcome = await write((revision) => {
      before = new Set((fileRef.current?.providers ?? []).map((p) => p.id))
      return providerCreate(id, patch, revision)
    })
    if (outcome.ok) {
      setSelected(fileRef.current?.providers.find((p) => !before.has(p.id))?.id ?? null)
    }
    return outcome
  }

  function createModel(
    provider: ProviderView,
    id: string,
    patch: ModelPatch,
  ): Promise<WriteOutcome> {
    return write((revision) => modelCreate(provider.id, id, patch, revision))
  }

  async function removeProvider(provider: ProviderView): Promise<WriteOutcome> {
    const outcome = await write((revision) => providerDelete(provider.id, revision))
    if (outcome.ok && selected === provider.id) setSelected(null)
    return outcome
  }

  function removeModel(provider: ProviderView, model: ModelView): Promise<WriteOutcome> {
    return write((revision) => modelDelete(provider.id, model.id, revision))
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-3" aria-labelledby="models-providers-title">
        <div className="flex items-center justify-between gap-2">
          <h3 id="models-providers-title" className="text-ui font-semibold text-foreground">
            {t('settings.providersAndModels')}
          </h3>
          {file && (
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon-sm"
                aria-label={t('common.refresh')}
                onClick={() => void load()}
                disabled={loading}
              >
                <RefreshCwIcon className={cn(loading && 'animate-spin')} />
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setSelected('add')
                  if (!templates) void loadTemplates()
                }}
              >
                <PlusIcon data-icon="inline-start" />
                {t('settings.addAProvider')}
              </Button>
            </div>
          )}
        </div>

        {pageNotice && (
          <p role="alert" className="text-ui text-pretty text-destructive">
            {pageNotice}
          </p>
        )}

        {!file ? (
          loadError ? (
            <Alert variant="destructive">
              <TriangleAlertIcon aria-hidden="true" />
              <AlertDescription className="flex flex-col items-start gap-3">
                <p>{t('settings.couldNotReadTheProviders', { loadError })}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void load()}
                  disabled={loading}
                >
                  <RefreshCwIcon aria-hidden="true" />
                  {t('common.retry')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <p role="status" className="text-ui text-muted-foreground">
              {t('settings.readingProviders')}
            </p>
          )
        ) : (
          <>
            {loadError && (
              <p role="alert" className="text-ui text-pretty text-destructive">
                {t('settings.couldNotReload', { loadError })}
              </p>
            )}

            {file.error && (
              <Alert variant="destructive">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertDescription className="flex flex-col items-start gap-3">
                  <p>{t('settings.theProvidersFileIsInvalid', { error: file.error })}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void load()}
                    disabled={loading}
                  >
                    <RefreshCwIcon aria-hidden="true" />
                    {t('common.retry')}
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {unpriced > 0 && (
              <Alert variant="warning" role="status">
                <TriangleAlertIcon aria-hidden="true" />
                <AlertDescription className="flex flex-wrap items-center gap-3">
                  <p className="flex-1">{t('settings.modelsWithoutCosts', { count: unpriced })}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void fillMissingPrices()}
                    disabled={filling}
                  >
                    {t('settings.setTheMissingCostsTo0')}
                  </Button>
                  {fillError && (
                    <p role="alert" className="w-full text-destructive">
                      {fillError}
                    </p>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="overflow-clip rounded-xl border border-border bg-card">
              <div className="grid min-h-[32rem] grid-cols-[3rem_minmax(0,1fr)] md:grid-cols-[13rem_minmax(0,1fr)]">
                <div className="min-w-0 border-r border-border">
                  {providers.length > 0 && (
                    <ProviderNav
                      providers={providers}
                      selected={adding ? null : (current?.id ?? null)}
                      onSelect={(id) => setSelected(id)}
                    />
                  )}
                </div>
                <div className="min-w-0 p-4 sm:p-6">
                  {adding ? (
                    <ProviderTemplatePicker
                      templates={templates}
                      loadError={templatesError}
                      canGoBack={providers.length > 0}
                      onBack={() => setSelected(null)}
                      onCustom={() => openDialog({ kind: 'create-provider' })}
                      onCreate={createFromTemplate}
                    />
                  ) : current ? (
                    <ProviderDetail
                      key={current.id}
                      provider={current}
                      onSave={(patch) => saveProvider(current, patch)}
                      onToggleModel={(model, enabled) =>
                        saveModel(current, model, enabledPatch(enabled))
                      }
                      onEditProvider={() => openDialog({ kind: 'edit-provider', provider: current })}
                      onDeleteProvider={() =>
                        openDialog({ kind: 'delete-provider', provider: current })
                      }
                      onEditModel={(model) =>
                        openDialog({ kind: 'edit-model', provider: current, model })
                      }
                      onDeleteModel={(model) =>
                        openDialog({ kind: 'delete-model', provider: current, model })
                      }
                      onAddModel={() => openDialog({ kind: 'create-model', provider: current })}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {dialog?.kind === 'create-provider' && (
        <ProviderFormDialog
          key={dialogKey}
          provider={null}
          notice={dialog.notice}
          onSave={(patch, id) => createProvider(id, patch)}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'create-model' && (
        <ModelFormDialog
          key={dialogKey}
          model={null}
          protocol={dialog.provider.protocol}
          notice={dialog.notice}
          onSave={(patch, id) => createModel(dialog.provider, id, patch)}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'edit-provider' && (
        <ProviderFormDialog
          key={dialogKey}
          provider={dialog.provider}
          notice={dialog.notice}
          onSave={(patch) => saveProvider(dialog.provider, patch)}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'edit-model' && (
        <ModelFormDialog
          key={dialogKey}
          model={dialog.model}
          protocol={dialog.model.protocol ?? dialog.provider.protocol}
          notice={dialog.notice}
          onSave={(patch) => saveModel(dialog.provider, dialog.model, patch)}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'delete-provider' && (
        <DeleteDialog
          key={dialogKey}
          title={t('settings.deleteProvider', {
            id: displayName(dialog.provider.name, dialog.provider.id),
          })}
          description={t('settings.theProviderLeavesBricksConfiguration', {
            target: providerDeletionDetail(dialog.provider),
          })}
          notice={dialog.notice}
          onConfirm={() => removeProvider(dialog.provider)}
          onClose={closeDialog}
        />
      )}
      {dialog?.kind === 'delete-model' && (
        <DeleteDialog
          key={dialogKey}
          title={t('settings.deleteModel2', {
            id: displayName(dialog.model.name, dialog.model.id),
          })}
          description={t('settings.theModelLeavesBricksConfiguration')}
          notice={dialog.notice}
          onConfirm={() => removeModel(dialog.provider, dialog.model)}
          onClose={closeDialog}
        />
      )}
    </div>
  )
}

export default ModelSettings
