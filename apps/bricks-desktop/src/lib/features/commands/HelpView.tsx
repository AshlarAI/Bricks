// `/help`: the commands come from the engine registry (the same list as the
// palette, nothing is written here); the keys are the desktop interactions.
import { useEffect } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { Kbd } from '$lib/components/ui/kbd'
import type { InspectorState } from '$lib/state/ui'
import { commandDescription, slashRegistry, useSlashRegistry } from './slash-registry'
import { usageLine } from './palette'

export interface HelpViewProps {
  /** The host passes `{ args }`; this view needs none of them. */
  args?: InspectorState['args']
}

export function HelpView(_props: HelpViewProps) {
  useLanguage()
  const registryState = useSlashRegistry()

  useEffect(() => {
    void slashRegistry.load()
  }, [])

  const interactions: { keys: string[]; text: string }[] = [
    { keys: [t('common.enter')], text: t('commands.sendsTheMessageTextStartingWith') },
    { keys: [t('commands.shift'), t('common.enter')], text: t('commands.newLineInTheMessage') },
    { keys: [t('commands.cmd'), t('common.enter')], text: t('commands.alsoSendsTheMessageCtrlEnter') },
    { keys: ['/'], text: t('commands.atTheStartOfTheMessage') },
    { keys: ['↑', '↓'], text: t('commands.inTheCommandListChoosesA') },
    { keys: [t('commands.tab')], text: t('commands.inTheListCompletesTheCommand') },
    { keys: [t('common.enter')], text: t('commands.inTheListCompletesAPartial') },
    { keys: [t('commands.esc')], text: t('commands.closesTheCommandListWithoutClearing') },
    { keys: ['↑'], text: t('commands.inAnEmptyMessageOrWith') },
    { keys: ['↓'], text: t('commands.goesBackToMoreRecentRequests') },
  ]

  return (
    <div className="flex flex-col gap-5 text-sm">
      <section className="flex flex-col gap-2" aria-labelledby="help-commands">
        <h3 id="help-commands" className="text-sm font-semibold">
          {t('commands.commands')}
        </h3>

        {registryState.status === 'loading' ? (
          <p role="status" className="text-muted-foreground">
            {t('commands.loadingCommands')}
          </p>
        ) : registryState.status === 'error' ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-destructive">
              {t('commands.commandsUnavailable', { error: registryState.message })}
            </p>
            <Button variant="outline" size="sm" onClick={() => void slashRegistry.retry()}>
              {t('common.retry')}
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col divide-y">
            {registryState.commands.map((cmd) => (
              <li key={cmd.name} className="flex flex-col gap-0.5 py-2">
                <span className="font-mono font-medium">{usageLine(cmd)}</span>
                {cmd.aliases.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t('commands.alias', { value: cmd.aliases.map((a) => `/${a}`).join(', ') })}
                  </span>
                )}
                <span className="text-muted-foreground">{commandDescription(cmd)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2" aria-labelledby="help-keys">
        <h3 id="help-keys" className="text-sm font-semibold">
          {t('commands.keyboardAndInteractions')}
        </h3>
        <ul className="flex flex-col gap-2">
          {interactions.map((item, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="flex shrink-0 flex-wrap gap-1 pt-0.5">
                {item.keys.map((key, k) => (
                  <Kbd key={k}>{key}</Kbd>
                ))}
              </span>
              <span className="text-muted-foreground">{item.text}</span>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">{t('commands.aGenerationEndsWithTheStop')}</p>
      </section>
    </div>
  )
}

export default HelpView
