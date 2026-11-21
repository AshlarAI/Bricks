import { Badge } from '$lib/components/ui/badge'
import { t, useLanguage } from '$lib/i18n/i18n'
import SettingsGroup from './SettingsGroup'

/** Planned options. Not implemented yet: shown as placeholders, never as working controls. */
const PLANNED = [
  { get title() { return t('settings.conversationExport') } },
  { get title() { return t('settings.technicalLog') } },
]

export function AdvancedSettings() {
  useLanguage()

  return (
    <div className="flex flex-col gap-6">
      <SettingsGroup title={t('settings.plannedOptions')}>
        <ul className="flex flex-col divide-y divide-border">
          {PLANNED.map((item) => (
            <li key={item.title} className="flex items-center justify-between gap-4 p-3">
              <span className="min-w-0 text-sm font-medium text-muted-foreground">{item.title}</span>
              <Badge variant="outline" className="shrink-0">
                {t('settings.comingSoon')}
              </Badge>
            </li>
          ))}
        </ul>
      </SettingsGroup>
    </div>
  )
}

export default AdvancedSettings
