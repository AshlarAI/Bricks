// The « Skills » choice opened from the `+` menu: the usable skills of this
// context, filtered by the engine (list_skills in a conversation, the catalogue
// without one). Choosing a skill only adds it to the draft: no trust is granted
// here, and the project skills that await the trust decision are not offered.
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Command, CommandInput, CommandItem, CommandList } from '$lib/components/ui/command'
import { Button } from '$lib/components/ui/button'
import { XIcon } from 'lucide-react'
import { app } from '$lib/state/app'
import { useConversation, type Conversation } from '$lib/state/conversation'
import { errorMessage, skillsCatalog } from '$lib/ipc/client'
import type { SkillsListing } from '$lib/ipc/engine'
import { hasProjectSkillsAwaitingApproval, usableSkills } from './skills'

export interface SkillPickerProps {
  conversation: Conversation | null
  /** Project whose skills are listed without a conversation (null: user and built-in only). */
  projectId: string | null
  selected: string[]
  onToggle: (name: string) => void
  onClose: () => void
}

export function SkillPicker({ conversation, projectId, selected, onToggle, onClose }: SkillPickerProps) {
  useLanguage()
  const convSkillsListing = useConversation(conversation, (c) => c.skillsListing)

  const [query, setQuery] = useState('')
  const [failure, setFailure] = useState<string | null>(null)
  /** Answer of the catalogue (no conversation), for the latest request. */
  const [catalogListing, setCatalogListing] = useState<SkillsListing | null>(null)
  /** When the latest request was sent: only an engine answer after it counts. */
  const [requestedAt, setRequestedAt] = useState(() => Date.now())
  const inputRef = useRef<HTMLInputElement | null>(null)
  /** Requests in flight: an answer to a superseded request is dropped. */
  const seqRef = useRef(0)
  /** The pause after typing, before the request. */
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  /** The listing of the latest request, or null while it is pending. */
  const listing: SkillsListing | null = (() => {
    if (!conversation) return catalogListing
    // The engine answers `list_skills` with a `skills` event of the conversation.
    return convSkillsListing && convSkillsListing.at >= requestedAt ? convSkillsListing.listing : null
  })()
  const pending = listing === null && failure === null
  const choices = listing ? usableSkills(listing.entries) : []
  const awaitingTrust = listing ? hasProjectSkillsAwaitingApproval(listing) : false
  const truncated = listing ? listing.total > listing.entries.length : false

  const request = useCallback(
    async (text: string) => {
      const mine = ++seqRef.current
      setRequestedAt(Date.now())
      setFailure(null)
      setCatalogListing(null)
      if (conversation) {
        const error = await app.command(conversation.sessionId, { type: 'list_skills', query: text })
        if (mine === seqRef.current && error !== null) setFailure(error)
        return
      }
      try {
        const catalog = await skillsCatalog(projectId, text, 0, false)
        if (mine === seqRef.current) setCatalogListing(catalog.listing)
      } catch (e) {
        if (mine === seqRef.current) setFailure(errorMessage(e))
      }
    },
    [conversation, projectId],
  )

  /** Escape closes the choice (the focus goes back to the editor). */
  function onEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onClose()
  }

  /** A short pause after typing, then one request for the text typed. */
  const scheduleRequest = useCallback(
    (text: string, delay: number) => {
      clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => void request(text), delay)
    },
    [request],
  )

  function onQueryChange(next: string) {
    setQuery(next)
    const text = next.trim()
    scheduleRequest(text, text === '' ? 0 : 200)
  }

  useEffect(() => {
    // The choice takes the keyboard when it opens; the first list is requested now.
    inputRef.current?.focus()
    scheduleRequest('', 0)
    return () => {
      clearTimeout(timerRef.current)
      seqRef.current += 1
    }
  }, [scheduleRequest])

  return (
    <div
      role="group"
      aria-label={t('composer.skillsForTheNextMessage')}
      className="absolute inset-x-0 bottom-full z-20 mb-2 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-float"
    >
      <Command shouldFilter={false} className="bg-transparent p-0">
        <CommandInput
          ref={inputRef}
          value={query}
          onValueChange={onQueryChange}
          placeholder={t('common.searchForASkill')}
          aria-label={t('common.searchForASkill')}
          onKeyDown={onEscape}
        />
        <CommandList className="p-1">
          {pending ? (
            <p role="status" className="px-2 py-3 text-sm text-muted-foreground">
              {t('composer.loadingSkills')}
            </p>
          ) : failure ? (
            <div role="alert" className="flex flex-col items-start gap-2 px-2 py-3 text-sm text-destructive">
              <p className="break-words">{t('composer.skillsUnavailable', { failure })}</p>
              <Button variant="outline" size="sm" onClick={() => void request(query.trim())}>
                {t('common.retry')}
              </Button>
            </div>
          ) : choices.length === 0 ? (
            <p role="status" className="px-2 py-3 text-sm text-muted-foreground">
              {query.trim()
                ? t('composer.noUsableSkillMatches', { query: query.trim() })
                : t('composer.noUsableSkillsHere')}
            </p>
          ) : (
            choices.map((skill) => (
              <CommandItem
                key={skill.name}
                value={skill.name}
                onSelect={() => onToggle(skill.name)}
                data-checked={selected.includes(skill.name)}
                className="gap-2"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-sm">{skill.name}</span>
                  {skill.description && (
                    <span className="truncate text-xs text-muted-foreground">{skill.description}</span>
                  )}
                </span>
                {skill.active && (
                  <span className="shrink-0 text-xs text-muted-foreground">{t('composer.active')}</span>
                )}
              </CommandItem>
            ))
          )}
        </CommandList>
      </Command>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-2 py-1.5 text-xs text-muted-foreground">
        <div className="flex min-w-0 flex-col">
          {awaitingTrust && (
            <span className="break-words">{t('composer.projectSkillsAwaitingApprovalNotOffered')}</span>
          )}
          {truncated && (
            <span className="break-words">{t('composer.onlyTheFirstResultsAreShown')}</span>
          )}
        </div>
        <Button variant="ghost" size="sm" onClick={onClose} onKeyDown={onEscape}>
          <XIcon aria-hidden="true" />
          {t('common.close')}
        </Button>
      </div>
    </div>
  )
}

export default SkillPicker
