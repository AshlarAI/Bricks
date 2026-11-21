// A question of `Ask`: its choices, « Autre » for a free answer, « Passer » and
// « Envoyer » (⌘↩). With a timer, the time left comes from the engine's deadline,
// so a reload or a switch of conversation never restarts it; the engine closes
// the question at expiry. A closed question shows nothing here: its `Ask` line
// counts the answers. Once an answer is accepted, the card gives way to a shimmering line
// until the engine closes the question.
import { useId, useState, type KeyboardEvent } from 'react'
import { MessageCircleQuestionIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from '$lib/components/ui/item'
import * as Trace from '$lib/components/ui/trace'
import { Input } from '$lib/components/ui/input'
import type { QuestionAnswer, QuestionRequest } from '$lib/ipc/engine'
import type { Conversation } from '$lib/state/conversation'
import { app } from '$lib/state/app'
import { useClock } from '$lib/features/navigation/clock'
import { cn } from '$lib/utils'

export interface QuestionCardProps {
  question: QuestionRequest
  conversation: Conversation
}

export function QuestionCard({ question, conversation }: QuestionCardProps) {
  useLanguage()
  const uid = useId()
  /** « Autre »: the index after the options. */
  const OTHER = question.options.length

  /** The choice made, the recommended option until the person picks one. */
  const [picked, setPicked] = useState<{
    questionId: string
    recommended: number | undefined
    index: number
  } | null>(null)
  const selected =
    picked &&
    picked.questionId === question.question_id &&
    picked.recommended === question.recommended
      ? picked.index
      : (question.recommended ?? null)

  const [other, setOther] = useState('')
  const [sending, setSending] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  const now = useClock(1000)
  /** Whole seconds left, `null` without a timer. */
  const left =
    question.deadline_at === undefined
      ? null
      : Math.max(0, Math.ceil((question.deadline_at - now) / 1000))
  const leftText =
    left === null ? '' : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`

  const canSend = !sending && selected !== null && (selected !== OTHER || other.trim() !== '')

  async function answer(a: QuestionAnswer) {
    if (sending) return
    setSending(true)
    const err = await app.answerQuestion(conversation, question.question_id, a)
    setRefusal(err)
    // Accepted: the line stays until the engine closes the question.
    if (err) setSending(false)
  }

  function send() {
    if (!canSend || selected === null) return
    void answer(
      selected === OTHER ? { kind: 'other', text: other.trim() } : { kind: 'choice', choice: selected },
    )
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  if (sending) {
    return (
      <Trace.Root>
        <Trace.Line status="running" role="status">
          <Trace.Icon>
            <MessageCircleQuestionIcon />
          </Trace.Icon>
          <Trace.Title>{t('conversation.answerSent')}</Trace.Title>
        </Trace.Line>
      </Trace.Root>
    )
  }

  const options = [...question.options, { label: t('common.other'), description: undefined }]

  return (
    <section
      aria-labelledby={`${uid}-q`}
      className="overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
      onKeyDown={onKeyDown}
    >
      <Item size="sm" className="rounded-none border-0 border-b border-border bg-muted/40 px-4 py-3">
        <ItemMedia variant="icon" className="text-warning">
          <MessageCircleQuestionIcon />
        </ItemMedia>
        <ItemContent className="min-w-0">
          <ItemDescription className="text-caption font-medium text-warning">
            {t('conversation.needsYourInput')}
          </ItemDescription>
          <ItemTitle>
            <h2 id={`${uid}-q`} className="text-ui font-medium break-words">
              {question.question}
            </h2>
          </ItemTitle>
        </ItemContent>
        {left !== null && (
          <ItemActions
            className={cn(
              'self-start font-mono text-caption tabular-nums',
              left < 10 ? 'text-destructive' : left < 30 ? 'text-warning' : 'text-muted-foreground',
            )}
            aria-label={t('conversation.timeLeft', { leftText })}
          >
            {leftText}
          </ItemActions>
        )}
      </Item>

      <fieldset className="m-0 border-0 p-0">
        <legend className="sr-only">{question.question}</legend>
        {options.map((option, index) => (
          <label
            key={index}
            className={cn(
              'flex cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-element-hover',
              index > 0 && 'border-t border-border',
            )}
          >
            <input
              type="radio"
              name={`${uid}-choice`}
              value={index}
              className="mt-0.5 size-4 shrink-0 accent-primary"
              checked={selected === index}
              onChange={() =>
                setPicked({
                  questionId: question.question_id,
                  recommended: question.recommended,
                  index,
                })
              }
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-ui break-words">
                {option.label}
                {index === question.recommended && (
                  <span className="ml-1 text-muted-foreground">{t('conversation.recommended')}</span>
                )}
              </span>
              {option.description && (
                <span className="text-caption break-words text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        ))}
        {selected === OTHER && (
          <div className="px-4 pb-3 pl-11">
            <Input
              value={other}
              onChange={(e) => setOther(e.target.value)}
              aria-label={t('conversation.yourAnswer')}
              className="h-8 text-ui"
            />
          </div>
        )}
      </fieldset>

      <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
        {refusal && (
          <p className="mr-auto text-caption break-words text-destructive" role="alert">
            {refusal}
          </p>
        )}
        <Button
          size="sm"
          variant="secondary"
          disabled={sending}
          onClick={() => void answer({ kind: 'skip' })}
        >
          {t('conversation.skip')}
        </Button>
        <Button size="sm" disabled={!canSend} onClick={send}>
          {t('common.send')}
        </Button>
      </footer>
    </section>
  )
}

export default QuestionCard
