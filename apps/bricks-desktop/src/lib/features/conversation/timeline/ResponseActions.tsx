// The actions of a complete response: rate it (« Bonne réponse », « Mauvaise
// réponse », one at a time) and copy its Markdown (all its assistant segments,
// no reasoning, tools, notices or summary).
import { useEffect, useRef, useState } from 'react'
import { CheckIcon, ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react'
import { CopyIcon, useIconHover, type CopyIconHandle } from '$lib/components/icons'
import { t, useLanguage } from '$lib/i18n/i18n'
import { MessageFooter } from '$lib/components/ui/message'
import { Toggle } from '$lib/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '$lib/components/ui/tooltip'
import { ratings, useRating, type Rating } from '../feedback'
import MessageAction from './MessageAction'

export interface ResponseActionsProps {
  text: string
  sessionId: string
}

/** A rating belongs to this exact answer: its conversation and its text. */
function textHash(value: string): string {
  let h = 5381
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + value.length.toString(36)
}

export function ResponseActions({ text, sessionId }: ResponseActionsProps) {
  useLanguage()
  const key = ratings.key(sessionId, textHash(text))
  const rating = useRating(key)

  const choices = [
    { value: 'good' as Rating, label: t('conversation.goodResponse'), Icon: ThumbsUpIcon },
    { value: 'bad' as Rating, label: t('conversation.badResponse'), Icon: ThumbsDownIcon },
  ]

  function rate(value: Rating, pressed: boolean) {
    ratings.set(key, pressed ? value : null)
  }

  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const copyHover = useIconHover<CopyIconHandle>()
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timerRef.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopyError(null)
      setCopied(true)
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch (e) {
      setCopied(false)
      setCopyError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <TooltipProvider delayDuration={400}>
      <MessageFooter className="-mt-2 gap-0.5 px-0">
        {choices.map(({ value, label, Icon }) => (
          <Tooltip key={value}>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                className="size-6 min-w-6 rounded-md px-0 [&_svg:not([class*='size-'])]:size-3"
                aria-label={label}
                pressed={rating === value}
                onPressedChange={(pressed) => rate(value, pressed)}
              >
                <Icon aria-hidden="true" />
              </Toggle>
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
          </Tooltip>
        ))}
        <MessageAction
          label={t('common.copy')}
          onclick={() => void copy()}
          onMouseEnter={copyHover.onMouseEnter}
          onMouseLeave={copyHover.onMouseLeave}
        >
          {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon ref={copyHover.ref} aria-hidden="true" />}
        </MessageAction>
        {copyError && (
          <p className="ml-2 font-normal text-destructive" role="alert">
            {t('conversation.couldNotCopy', { copyError })}
          </p>
        )}
      </MessageFooter>
    </TooltipProvider>
  )
}

export default ResponseActions
