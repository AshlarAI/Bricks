// One model of a provider: its API name, its context and Vision badges, then test, edit,
// delete and the switch that offers it in the model lists. The name expands the details.
import { useId, useState } from 'react'
import {
  CircleCheckIcon,
  CircleXIcon,
  PencilIcon,
  PlugIcon,
  TrashIcon,
} from 'lucide-react'
import { Badge } from '$lib/components/ui/badge'
import { Button } from '$lib/components/ui/button'
import { Item, ItemActions, ItemContent, ItemFooter, ItemTitle } from '$lib/components/ui/item'
import { Spinner } from '$lib/components/ui/spinner'
import { Switch } from '$lib/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '$lib/components/ui/tooltip'
import { localeTag, t, useLanguage } from '$lib/i18n/i18n'
import type { ModelView } from '$lib/ipc/bindings/ModelView'
import { cn } from '$lib/utils'
import { formatModalities, formatPrice, formatTokens } from './format'
import { displayName, profileLabel } from './models'
import { compactCount } from './usage'

/** Where the last test of the model stands. */
export type ModelTest =
  | { state: 'running' }
  | { state: 'passed'; ms: number }
  | { state: 'failed'; error: string }

export interface ModelRowProps {
  model: ModelView
  test: ModelTest | null
  busy?: boolean
  onTest: () => void
  onEdit: () => void
  onDelete: () => void
  onToggle: (enabled: boolean) => void
}

export function ModelRow({
  model,
  test,
  busy = false,
  onTest,
  onEdit,
  onDelete,
  onToggle,
}: ModelRowProps) {
  useLanguage()
  const uid = useId()
  const detailId = `${uid}-detail`
  const title = displayName(model.name, model.id)
  const context = model.max_input_tokens
  const [expanded, setExpanded] = useState(false)

  return (
    <Item size="sm" className={cn('flex-wrap', !model.enabled && 'opacity-60')}>
      <ItemContent className="min-w-0">
        <ItemTitle className="w-full min-w-0">
          <button
            type="button"
            className="min-w-0 truncate rounded-sm text-left font-mono focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            title={title}
            aria-expanded={expanded}
            aria-controls={expanded ? detailId : undefined}
            onClick={() => setExpanded((prev) => !prev)}
          >
            {model.api_model}
          </button>
          <Badge variant="outline" title={t('settings.contextTokens', { count: context })}>
            {compactCount(context, localeTag())}
          </Badge>
          {model.input_modalities.includes('image') && (
            <Badge variant="outline">{t('settings.vision')}</Badge>
          )}
        </ItemTitle>
      </ItemContent>

      <ItemActions className="gap-1">
        <TooltipProvider delayDuration={0}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  'text-muted-foreground',
                  test?.state === 'passed' && 'text-success',
                  test?.state === 'failed' && 'text-destructive',
                )}
                aria-label={t('settings.testModel', { title })}
                disabled={test?.state === 'running'}
                onClick={onTest}
              >
                {test?.state === 'running' ? (
                  <Spinner />
                ) : test?.state === 'passed' ? (
                  <CircleCheckIcon />
                ) : test?.state === 'failed' ? (
                  <CircleXIcon />
                ) : (
                  <PlugIcon />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">
              {test?.state === 'passed'
                ? t('settings.testPassed', { ms: test.ms })
                : test?.state === 'failed'
                  ? t('settings.testFailed', { error: test.error })
                  : t('settings.testModel', { title })}
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={t('settings.editModel', { id: title })}
                onClick={onEdit}
              >
                <PencilIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('settings.editTheModel')}</TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                aria-label={t('settings.deleteModel', { title })}
                onClick={onDelete}
              >
                <TrashIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('settings.deleteTheModel')}</TooltipContent>
          </Tooltip>
        </TooltipProvider>

        <Switch
          checked={model.enabled}
          onCheckedChange={onToggle}
          disabled={busy}
          aria-label={t('settings.enableModel', { title })}
        />
      </ItemActions>

      {expanded && (
        <ItemFooter className="basis-full">
          <dl
            id={detailId}
            className="grid w-full grid-cols-[auto_1fr] items-baseline gap-x-4 gap-y-1.5 text-xs"
          >
            <dt className="text-muted-foreground">{t('settings.selection')}</dt>
            <dd className="font-mono break-all text-foreground">{model.selection}</dd>

            <dt className="text-muted-foreground">{t('settings.apiName')}</dt>
            <dd className="font-mono break-all text-foreground">{model.api_model}</dd>

            <dt className="text-muted-foreground">{t('settings.maximumInput')}</dt>
            <dd className="text-foreground tabular-nums">{formatTokens(model.max_input_tokens)}</dd>

            <dt className="text-muted-foreground">{t('settings.maximumOutput')}</dt>
            <dd className="text-foreground tabular-nums">{formatTokens(model.max_output_tokens)}</dd>

            <dt className="text-muted-foreground">{t('settings.acceptedInputs')}</dt>
            <dd className="text-foreground">{formatModalities(model.input_modalities)}</dd>

            <dt className="text-muted-foreground">{t('settings.reasoningLevels')}</dt>
            <dd className="text-foreground">
              {model.profiles.length === 0
                ? t('settings.none')
                : model.profiles.map(profileLabel).join(', ')}
            </dd>

            <dt className="text-muted-foreground">{t('settings.costPerMtok')}</dt>
            <dd className="text-foreground tabular-nums">
              {model.pricing
                ? t('settings.inputOutputCache', {
                    input: formatPrice(model.pricing.input),
                    output: formatPrice(model.pricing.output),
                    cacheRead: formatPrice(model.pricing.cache_read),
                  })
                : t('settings.notProvided')}
            </dd>
          </dl>
        </ItemFooter>
      )}
    </Item>
  )
}

export default ModelRow
