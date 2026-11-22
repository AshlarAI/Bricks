import * as React from "react"
import { ChevronDownIcon } from "lucide-react"
import { Button } from "$lib/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "$lib/components/ui/collapsible"
import { Input } from "$lib/components/ui/input"
import { Tooltip, TooltipContent, TooltipTrigger } from "$lib/components/ui/tooltip"
import { t, useLanguage } from "$lib/i18n/i18n"
import { cn } from "$lib/utils"

type WebPreviewContextValue = {
  url: string
  /** Opens an address: it becomes the newest entry of the history. */
  setUrl: (url: string) => void
  canGoBack: boolean
  canGoForward: boolean
  back: () => void
  forward: () => void
  reload: () => void
  /** Bumped by `reload`: the body remounts its frame. */
  reloads: number
  consoleOpen: boolean
  setConsoleOpen: (open: boolean) => void
}

const WebPreviewContext = React.createContext<WebPreviewContextValue | null>(null)

function useWebPreview() {
  const context = React.useContext(WebPreviewContext)
  if (!context) throw new Error("WebPreview parts must be used inside <WebPreview>")
  return context
}

function WebPreview({
  className,
  children,
  defaultUrl = "",
  onUrlChange,
  ...props
}: React.ComponentProps<"div"> & {
  defaultUrl?: string
  onUrlChange?: (url: string) => void
}) {
  // The addresses visited, and the place of the one shown.
  const [history, setHistory] = React.useState({ entries: [defaultUrl], index: 0 })
  const [reloads, setReloads] = React.useState(0)
  const [consoleOpen, setConsoleOpen] = React.useState(false)
  const url = history.entries[history.index] ?? ""

  const go = React.useCallback(
    (index: number) => {
      setHistory((h) => {
        if (index < 0 || index >= h.entries.length || index === h.index) return h
        onUrlChange?.(h.entries[index])
        return { ...h, index }
      })
    },
    [onUrlChange]
  )

  const value: WebPreviewContextValue = {
    url,
    setUrl: (next) => {
      setHistory((h) => {
        if (next === h.entries[h.index]) return h
        return { entries: [...h.entries.slice(0, h.index + 1), next], index: h.index + 1 }
      })
      if (next !== url) onUrlChange?.(next)
    },
    canGoBack: history.index > 0,
    canGoForward: history.index < history.entries.length - 1,
    back: () => go(history.index - 1),
    forward: () => go(history.index + 1),
    reload: () => setReloads((n) => n + 1),
    reloads,
    consoleOpen,
    setConsoleOpen,
  }

  return (
    <WebPreviewContext.Provider value={value}>
      <div
        data-slot="web-preview"
        className={cn("flex size-full flex-col overflow-hidden rounded-lg border bg-card", className)}
        {...props}
      >
        {children}
      </div>
    </WebPreviewContext.Provider>
  )
}

function WebPreviewNavigation({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="web-preview-navigation"
      className={cn("flex items-center gap-1 border-b p-2", className)}
      {...props}
    />
  )
}

/** A button of the bar. With `action`, it goes back, forward or reloads, and is disabled when it can't. */
function WebPreviewNavigationButton({
  action,
  tooltip,
  onClick,
  disabled,
  className,
  children,
  ...props
}: React.ComponentProps<typeof Button> & {
  action?: "back" | "forward" | "reload"
  tooltip?: string
}) {
  const preview = useWebPreview()
  const unavailable =
    (action === "back" && !preview.canGoBack) || (action === "forward" && !preview.canGoForward)
  const button = (
    <Button
      data-slot="web-preview-navigation-button"
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={tooltip}
      disabled={disabled || unavailable}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      onClick={(event) => {
        onClick?.(event)
        if (event.defaultPrevented) return
        if (action === "back") preview.back()
        else if (action === "forward") preview.forward()
        else if (action === "reload") preview.reload()
      }}
      {...props}
    >
      {children}
    </Button>
  )
  if (!tooltip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function WebPreviewUrl({ className, onKeyDown, ...props }: React.ComponentProps<typeof Input>) {
  useLanguage()
  const { url, setUrl } = useWebPreview()
  const [draft, setDraft] = React.useState(url)

  // A new address (a link, back, forward) replaces what was being typed.
  React.useEffect(() => setDraft(url), [url])

  return (
    <Input
      data-slot="web-preview-url"
      aria-label={t("webPreview.address")}
      spellCheck={false}
      autoComplete="off"
      className={cn("h-8 flex-1 text-sm", className)}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        onKeyDown?.(event)
        if (!event.defaultPrevented && event.key === "Enter") setUrl(draft.trim())
      }}
      {...props}
    />
  )
}

/**
 * The page. A `srcDoc` (generated HTML) runs in a sandbox without the app's
 * origin: its scripts can never reach the app or Tauri. Otherwise the frame
 * opens the current address.
 */
function WebPreviewBody({
  className,
  src,
  srcDoc,
  loading,
  ...props
}: React.ComponentProps<"iframe"> & { loading?: React.ReactNode }) {
  useLanguage()
  const { url, reloads } = useWebPreview()
  return (
    <div data-slot="web-preview-body" className="relative min-h-0 flex-1 bg-background">
      <iframe
        key={reloads}
        title={t("webPreview.page")}
        className={cn("size-full border-0", className)}
        sandbox={
          srcDoc !== undefined
            ? "allow-scripts allow-forms allow-modals"
            : "allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        }
        srcDoc={srcDoc}
        src={srcDoc !== undefined ? undefined : (src ?? url) || undefined}
        {...props}
      />
      {loading}
    </div>
  )
}

type WebPreviewLog = { level: "log" | "warn" | "error"; message: string; timestamp: Date }

function WebPreviewConsole({
  className,
  logs = [],
  children,
  ...props
}: React.ComponentProps<"div"> & { logs?: WebPreviewLog[] }) {
  useLanguage()
  const { consoleOpen, setConsoleOpen } = useWebPreview()
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })
  return (
    <Collapsible
      data-slot="web-preview-console"
      open={consoleOpen}
      onOpenChange={setConsoleOpen}
      className={cn("border-t bg-muted/50 font-mono text-xs", className)}
      {...props}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="h-9 w-full justify-between rounded-none px-3 font-sans text-ui font-medium"
        >
          {t("webPreview.console")}
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("transition-transform duration-200", consoleOpen && "rotate-180")}
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <div className="flex max-h-48 flex-col gap-1 overflow-y-auto">
          {logs.length === 0 && !children ? (
            <p className="text-muted-foreground">{t("webPreview.noOutput")}</p>
          ) : (
            logs.map((log, index) => (
              <div
                key={`${log.timestamp.getTime()}-${index}`}
                data-level={log.level}
                className={cn(
                  log.level === "error" && "text-destructive",
                  log.level === "warn" && "text-warning",
                  log.level === "log" && "text-foreground"
                )}
              >
                <span className="text-muted-foreground">{time.format(log.timestamp)}</span> {log.message}
              </div>
            ))
          )}
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export {
  WebPreview,
  WebPreviewBody,
  WebPreviewConsole,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  type WebPreviewLog,
}
