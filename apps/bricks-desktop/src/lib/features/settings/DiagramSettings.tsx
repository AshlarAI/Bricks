// Mermaid and SVG viewer preferences (`Preferences.diagrams`).
import { useId } from 'react'
import { Field, FieldLabel } from '$lib/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger } from '$lib/components/ui/select'
import { Switch } from '$lib/components/ui/switch'
import {
  MERMAID_LOOKS,
  MERMAID_SECURITY_LEVELS,
  MERMAID_THEMES,
  diagramSettings,
  diagramTheme,
  type MermaidLook,
  type MermaidSecurityLevel,
  type MermaidTheme,
} from '$lib/features/diagrams/settings'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { DiagramViewerSettings } from '$lib/ipc/bindings/DiagramViewerSettings'
import { app, useApp } from '$lib/state/app'
import SettingsGroup from './SettingsGroup'

const SECURITY_LABEL: Record<MermaidSecurityLevel, string> = {
  sandbox: 'Sandbox',
  strict: 'Strict',
  antiscript: 'Antiscript',
  loose: 'Loose',
}

const THEME_LABEL: Record<'app' | MermaidTheme, string> = {
  get app() { return t('settings.bricksTheme') },
  get default() { return t('settings.mermaidThemeDefault') },
  get forest() { return t('settings.mermaidThemeForest') },
  get dark() { return t('settings.mermaidThemeDark') },
  get neutral() { return t('settings.mermaidThemeNeutral') },
  get base() { return t('settings.mermaidThemeBase') },
}

const LOOK_LABEL: Record<MermaidLook, string> = {
  get classic() { return t('settings.mermaidLookClassic') },
  get handDrawn() { return t('settings.mermaidLookHandDrawn') },
  get neo() { return t('settings.mermaidLookNeo') },
}

const THEMES = ['app', ...MERMAID_THEMES] as const

type Control = Exclude<keyof DiagramViewerSettings, 'followAppTheme' | 'capabilitiesRevision'>

const CONTROLS: { key: Control; label: string }[] = [
  { key: 'allowZoom', get label() { return t('settings.allowZoom') } },
  { key: 'allowPan', get label() { return t('settings.pan') } },
  { key: 'allowFullscreen', get label() { return t('common.fullscreen') } },
  { key: 'allowDownload', get label() { return t('settings.svgDownload') } },
  { key: 'allowCopy', get label() { return t('settings.copySource') } },
  { key: 'allowTooltips', get label() { return t('settings.tooltips') } },
  { key: 'allowSelection', get label() { return t('settings.textSelection') } },
  { key: 'allowLinks', get label() { return t('settings.links') } },
  { key: 'allowAnimations', get label() { return t('settings.animations') } },
]

export function DiagramSettings() {
  useLanguage()
  const uid = useId()
  const diagramsPref = useApp((s) => s.prefs.diagrams)
  const settings = diagramSettings(diagramsPref)
  const theme = diagramTheme(settings)

  function chooseSecurity(next: string | undefined) {
    const level = MERMAID_SECURITY_LEVELS.find((value) => value === next)
    if (!level || level === settings.mermaid.securityLevel) return
    app.setPrefs({ diagrams: { ...settings, mermaid: { ...settings.mermaid, securityLevel: level } } })
  }

  function chooseTheme(next: string | undefined) {
    if (next === 'app') {
      app.setPrefs({
        diagrams: { ...settings, diagramViewer: { ...settings.diagramViewer, followAppTheme: true } },
      })
      return
    }
    const chosen = MERMAID_THEMES.find((value) => value === next)
    if (!chosen) return
    app.setPrefs({
      diagrams: {
        mermaid: { ...settings.mermaid, theme: chosen },
        diagramViewer: { ...settings.diagramViewer, followAppTheme: false },
      },
    })
  }

  function chooseLook(next: string | undefined) {
    const look = MERMAID_LOOKS.find((value) => value === next)
    if (!look || look === settings.mermaid.look) return
    app.setPrefs({ diagrams: { ...settings, mermaid: { ...settings.mermaid, look } } })
  }

  function toggle(key: Control, value: boolean) {
    app.setPrefs({
      diagrams: { ...settings, diagramViewer: { ...settings.diagramViewer, [key]: value } },
    })
  }

  return (
    <>
      <Field className="gap-3">
        <FieldLabel htmlFor={`${uid}-security`} className="text-ui font-semibold text-foreground">
          {t('settings.mermaidSecurity')}
        </FieldLabel>
        <Select value={settings.mermaid.securityLevel} onValueChange={chooseSecurity}>
          <SelectTrigger id={`${uid}-security`} className="w-full max-w-72">
            <span className="truncate">{SECURITY_LABEL[settings.mermaid.securityLevel]}</span>
          </SelectTrigger>
          <SelectContent>
            {MERMAID_SECURITY_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {SECURITY_LABEL[level]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <SettingsGroup title={t('settings.diagramsAndSvg')}>
        <div className="flex flex-wrap items-center gap-3 p-3 text-ui">
          <Field orientation="horizontal" className="w-auto">
            <FieldLabel htmlFor={`${uid}-theme`} className="text-ui">
              {t('settings.theme')}
            </FieldLabel>
            <Select value={theme} onValueChange={chooseTheme}>
              <SelectTrigger id={`${uid}-theme`} className="w-44">
                <span className="truncate">{THEME_LABEL[theme]}</span>
              </SelectTrigger>
              <SelectContent>
                {THEMES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {THEME_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field orientation="horizontal" className="w-auto">
            <FieldLabel htmlFor={`${uid}-look`} className="text-ui">
              {t('settings.style')}
            </FieldLabel>
            <Select value={settings.mermaid.look} onValueChange={chooseLook}>
              <SelectTrigger id={`${uid}-look`} className="w-36">
                <span className="truncate">{LOOK_LABEL[settings.mermaid.look]}</span>
              </SelectTrigger>
              <SelectContent>
                {MERMAID_LOOKS.map((look) => (
                  <SelectItem key={look} value={look}>
                    {LOOK_LABEL[look]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        {CONTROLS.map((control) => (
          <label key={control.key} className="flex items-center justify-between gap-3 p-3 text-ui">
            {control.label}
            <Switch
              checked={settings.diagramViewer[control.key]}
              onCheckedChange={(on) => toggle(control.key, on)}
            />
          </label>
        ))}
      </SettingsGroup>
    </>
  )
}

export default DiagramSettings
