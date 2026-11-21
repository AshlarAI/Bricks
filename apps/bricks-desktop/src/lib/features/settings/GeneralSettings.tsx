// The permission policy new conversations start from (`~/.bricks/permissions.json`).
// Open conversations keep theirs.
import { useEffect, useId, useState } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select'
import { Switch } from '$lib/components/ui/switch'
import PolicyEditor from '$lib/features/permissions/PolicyEditor'
import { unchosenPolicy } from '$lib/features/permissions/policy'
import { LANGUAGES, isLanguage, setLanguage, t, useLanguage } from '$lib/i18n/i18n'
import { errorMessage, permissionsDefaultGet, permissionsDefaultSet } from '$lib/ipc/client'
import type { SessionPolicy } from '$lib/ipc/engine'
import { app, useApp } from '$lib/state/app'
import AskTimerSettings from './AskTimerSettings'
import DiagramSettings from './DiagramSettings'

export function GeneralSettings() {
  useLanguage()
  const languageLabelId = useId()
  const language = useApp((s) => s.prefs.language)
  const keepAwake = useApp((s) => s.prefs.keep_awake)

  const [policy, setPolicy] = useState<SessionPolicy | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function chooseLanguage(value: string) {
    if (!isLanguage(value)) return
    setLanguage(value)
    app.setPrefs({ language: value })
  }

  useEffect(() => {
    let cancelled = false
    void permissionsDefaultGet()
      .then((read) => {
        if (cancelled) return
        setPolicy(read.policy ?? unchosenPolicy())
        setLoadError(read.error)
      })
      .catch((e) => {
        if (cancelled) return
        setPolicy(unchosenPolicy())
        setLoadError(errorMessage(e))
      })
    return () => {
      cancelled = true
    }
  }, [])

  /** Saves the new default; the editor shows it only once it is saved. */
  async function save(next: SessionPolicy) {
    setSaving(true)
    setSaveError(null)
    try {
      await permissionsDefaultSet(next)
      setPolicy(next)
      setLoadError(null)
    } catch (e) {
      setSaveError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <span id={languageLabelId} className="text-ui font-semibold text-foreground">
          {t('settings.language')}
        </span>
        <Select value={language} onValueChange={chooseLanguage}>
          <SelectTrigger aria-labelledby={languageLabelId} className="w-44">
            {LANGUAGES.find((l) => l.value === language)?.label}
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section aria-labelledby="default-permissions" className="flex flex-col gap-3">
        <h3 id="default-permissions" className="text-ui font-semibold text-foreground">
          {t('settings.permissionsForNewConversations')}
        </h3>
        {policy && <PolicyEditor policy={policy} disabled={saving} onchange={(next) => void save(next)} />}
        {loadError && (
          <p role="alert" className="text-ui text-pretty text-destructive">
            {t('settings.couldNotRead', { loadError })}
          </p>
        )}
        {saveError && (
          <p role="alert" className="text-ui text-pretty text-destructive">
            {t('settings.theSettingWasntSaved', { saveError })}
          </p>
        )}
      </section>

      <label className="flex items-center justify-between gap-3 text-ui font-semibold text-foreground">
        {t('common.keepTheComputerAwake')}
        <Switch checked={keepAwake} onCheckedChange={(on) => app.setPrefs({ keep_awake: on })} />
      </label>

      <DiagramSettings />
      <AskTimerSettings />
    </div>
  )
}

export default GeneralSettings
