// The magnifier next to « Nouvelle conversation », and the search it opens: titles and
// messages of every project. Escape closes it and gives focus back to the magnifier.
import { useRef, useState } from 'react'
import { SearchIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { Button } from '$lib/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '$lib/components/ui/dialog'
import { Input } from '$lib/components/ui/input'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '$lib/components/ui/tooltip'
import SearchResults from './SearchResults'

export function SearchDialog() {
  useLanguage()
  const LABEL = t('navigation.searchConversations')

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  // Set when a result was opened: focus then stays with the conversation.
  const openedRef = useRef(false)

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (!next) setQuery('')
  }

  function onCloseAutoFocus(event: Event) {
    event.preventDefault()
    if (!openedRef.current) triggerRef.current?.focus()
    openedRef.current = false
  }

  function onResultOpened() {
    openedRef.current = true
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={triggerRef}
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-muted-foreground"
            aria-label={LABEL}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            <SearchIcon aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{LABEL}</TooltipContent>
      </Tooltip>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="top-[15vh] translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-lg"
          onCloseAutoFocus={onCloseAutoFocus}
        >
          <DialogTitle className="sr-only">{LABEL}</DialogTitle>
          <div className="relative border-b border-border">
            <SearchIcon
              className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('navigation.search')}
              aria-label={t('navigation.titlesAndMessages', { LABEL })}
              autoComplete="off"
              spellCheck={false}
              className="h-11 rounded-none border-0 pl-10 text-ui shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
          </div>
          {query.trim() && (
            <ScrollArea viewportClass="max-h-[60vh]">
              <div className="pt-2">
                <SearchResults query={query} onQueryChange={setQuery} onOpened={onResultOpened} />
              </div>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

export default SearchDialog
