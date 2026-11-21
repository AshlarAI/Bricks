// Prototype of an MCP App: the interface of a tool, shown in a frame that is isolated from
// Bricks (its own null origin: no Tauri command, no access to this page, no storage, no
// network), and that speaks only through the bridge below (JSON-RPC over postMessage). The
// bridge forwards `tools/call` to the tools of the same server only. What the interface
// reports about its sandbox (`ui/report`) is shown under it.
import { useEffect, useRef, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '$lib/components/ui/dialog'
import { t, useLanguage } from '$lib/i18n/i18n'
import * as ipc from '$lib/ipc/client'

/** The frame may load nothing from anywhere: only its own inline scripts and styles. */
const CSP =
  "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:\">"

export interface McpAppDialogProps {
  server: string
  tool: string
  projectId: string | null
  onClose: () => void
}

export function McpAppDialog({ server, tool, projectId, onClose }: McpAppDialogProps) {
  useLanguage()
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [html, setHtml] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Record<string, string> | null>(null)
  const [calls, setCalls] = useState<string[]>([])

  useEffect(() => {
    let gone = false
    setHtml(null)
    setError(null)
    ipc
      .mcpAppLoad(server, tool, projectId)
      .then((view) => {
        if (!gone) setHtml(CSP + view.html)
      })
      .catch((e) => {
        if (!gone) setError(ipc.errorMessage(e))
      })
    return () => {
      gone = true
    }
  }, [server, tool, projectId])

  useEffect(() => {
    function reply(
      id: unknown,
      body: { result?: unknown; error?: { code: number; message: string } },
    ) {
      frameRef.current?.contentWindow?.postMessage({ jsonrpc: '2.0', id, ...body }, '*')
    }

    async function onMessage(event: MessageEvent) {
      // Only the frame's own messages: nothing else on this page speaks for it.
      const frame = frameRef.current
      if (!frame || event.source !== frame.contentWindow) return
      const message = event.data as {
        id?: unknown
        method?: string
        params?: Record<string, unknown>
      }
      if (!message || typeof message !== 'object' || typeof message.method !== 'string') return
      if (message.method === 'ui/report') {
        setReport(
          Object.fromEntries(
            Object.entries(message.params ?? {}).map(([k, v]) => [k, String(v)]),
          ),
        )
        return
      }
      if (message.method !== 'tools/call' || message.id === undefined) {
        if (message.id !== undefined) {
          reply(message.id, { error: { code: -32601, message: 'method not available' } })
        }
        return
      }
      const name = String(message.params?.name ?? '')
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>
      try {
        const result = await ipc.mcpAppCall(server, name, args, projectId)
        setCalls((prev) => [...prev, `${name} → ${result.text}`])
        reply(message.id, {
          result: { content: [{ type: 'text', text: result.text }], isError: result.is_error },
        })
      } catch (e) {
        const text = ipc.errorMessage(e)
        setCalls((prev) => [...prev, `${name} → ${text}`])
        reply(message.id, { error: { code: -32001, message: text } })
      }
    }

    const listener = (event: MessageEvent) => {
      void onMessage(event)
    }
    window.addEventListener('message', listener)
    return () => window.removeEventListener('message', listener)
  }, [server, projectId])

  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="flex max-h-[min(44rem,calc(100dvh-2rem))] flex-col gap-4 sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {server} · {tool}
          </DialogTitle>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm text-pretty text-destructive">
            {error}
          </p>
        ) : html ? (
          <iframe
            ref={frameRef}
            title={t('settings.mcpAppFrame', { tool })}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={html}
            className="h-80 w-full rounded-lg border border-border bg-white"
          />
        ) : null}
        {report && (
          <div className="flex flex-col gap-1">
            <span className="text-caption font-medium text-muted-foreground">
              {t('settings.mcpAppIsolation')}
            </span>
            <pre className="rounded-lg bg-muted p-2 font-mono text-caption whitespace-pre-wrap">
              {Object.entries(report)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}
            </pre>
          </div>
        )}
        {calls.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-caption font-medium text-muted-foreground">
              {t('settings.mcpAppCalls')}
            </span>
            <pre className="rounded-lg bg-muted p-2 font-mono text-caption whitespace-pre-wrap">
              {calls.join('\n')}
            </pre>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default McpAppDialog
