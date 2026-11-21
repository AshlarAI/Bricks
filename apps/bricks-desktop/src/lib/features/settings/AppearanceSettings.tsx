// « Apparence » of the settings: the light, dark or system mode, and the app's icon. The
// colours are the theme's own (neutral surfaces, one brand blue for links).
import type { ComponentType } from 'react'
import { MonitorIcon, MoonIcon, SunIcon, SunMoonIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import type { AppIcon } from '$lib/ipc/client'
import { app, useApp } from '$lib/state/app'
import { setTheme, useTheme, type ThemeMode } from '$lib/theme/theme'
import SettingsGroup from './SettingsGroup'

type IconComponent = ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>

const OPTIONS: {
  value: ThemeMode
  label: string
  icon: IconComponent
}[] = [
  { value: 'light', get label() { return t('settings.light') }, icon: SunIcon },
  { value: 'dark', get label() { return t('settings.dark') }, icon: MoonIcon },
  { value: 'system', get label() { return t('settings.system') }, icon: MonitorIcon },
]

/** The icon: always light, always dark, or the one of the mode on screen. */
const ICON_OPTIONS: {
  value: AppIcon
  label: string
  icon: IconComponent
}[] = [
  { value: 'light', get label() { return t('settings.light2') }, icon: SunIcon },
  { value: 'dark', get label() { return t('settings.dark') }, icon: MoonIcon },
  { value: 'aligned', get label() { return t('settings.aligned') }, icon: SunMoonIcon },
]

export function AppearanceSettings() {
  useLanguage()
  useTheme()
  const current = useApp((s) => s.prefs.theme)
  const appIcon = useApp((s) => s.prefs.app_icon)

  /** Applies the mode at once and saves it with the other preferences. */
  function choose(next: ThemeMode) {
    setTheme(next)
    app.setPrefs({ theme: next })
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t('settings.theme')}>
        <fieldset className="flex flex-col gap-0 p-0">
          <legend className="sr-only">{t('settings.theme')}</legend>
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            {OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-ui font-medium text-foreground transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name="theme-mode"
                    value={option.value}
                    className="sr-only"
                    checked={current === option.value}
                    onChange={() => choose(option.value)}
                  />
                  <Icon className="size-4" aria-hidden="true" />
                  {option.label}
                </label>
              )
            })}
          </div>
        </fieldset>
      </SettingsGroup>

      <SettingsGroup title={t('settings.appIcon')}>
        <fieldset className="flex flex-col gap-0 p-0">
          <legend className="sr-only">{t('settings.appIcon')}</legend>
          <div className="grid gap-2 p-3 sm:grid-cols-3">
            {ICON_OPTIONS.map((option) => {
              const Icon = option.icon
              return (
                <label
                  key={option.value}
                  className="flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 py-2 text-ui font-medium text-foreground transition-colors hover:bg-muted has-[:checked]:border-primary has-[:checked]:ring-1 has-[:checked]:ring-primary has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring"
                >
                  <input
                    type="radio"
                    name="app-icon"
                    value={option.value}
                    className="sr-only"
                    checked={appIcon === option.value}
                    onChange={() => app.setPrefs({ app_icon: option.value })}
                  />
                  <Icon className="size-4" aria-hidden="true" />
                  {option.label}
                </label>
              )
            })}
          </div>
        </fieldset>
      </SettingsGroup>
    </div>
  )
}

export default AppearanceSettings
