// A top-level ```html fence: the page in a sandbox (no app origin: its scripts never reach the
// app or Tauri), with its console, or its source. While the fence streams, the source shows;
// once it closes, the page does. The page can be reloaded, opened larger, copied and saved.
import { useEffect, useRef, useState } from 'react'
import { CodeIcon, DownloadIcon, EyeIcon, Maximize2Icon } from 'lucide-react'
import { RefreshCWIcon, useIconHover, type RefreshCWIconHandle } from '$lib/components/icons'
import { toast } from 'sonner'
import {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
} from '$lib/components/ui/artifact'
import * as CodeBlock from '$lib/components/ui/code-block'
import { Dialog, DialogContent, DialogTitle } from '$lib/components/ui/dialog'
import { WebPreview, WebPreviewBody, WebPreviewConsole, type WebPreviewLog } from '$lib/components/ui/web-preview'
import FileIcon from '$lib/features/file-icons/FileIcon'
import { useHighlightedCode } from '$lib/hooks/use-highlighted-code'
import { t, useLanguage } from '$lib/i18n/i18n'
import { errorMessage, saveTextFile } from '$lib/ipc/client'

export interface WebPageBlockProps {
  source: string
  complete: boolean
}

/** Marks the messages a preview sends: anything else posted to the window is ignored. */
const MARK = 'bricksPreview'

/** Runs first in the page: forwards its console and its errors to the app. */
const BRIDGE =
  `<script>(()=>{const s=(level,a)=>{try{parent.postMessage({${MARK}:1,level,message:a.map(x=>{try{return typeof x==='string'?x:JSON.stringify(x)}catch{return String(x)}}).join(' ')},'*')}catch{}};` +
  `for(const l of ['log','info','warn','error']){const o=console[l];console[l]=(...a)=>{s(l==='info'?'log':l,a);o.apply(console,a)}}` +
  `addEventListener('error',e=>s('error',[e.message]));addEventListener('unhandledrejection',e=>s('error',[String(e.reason)]))})()</script>`

/** The page with the bridge first in its head (before the doctype would put it in quirks mode). */
export function withBridge(html: string): string {
  const head = /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html)
  if (head) return html.slice(0, head.index + head[0].length) + BRIDGE + html.slice(head.index + head[0].length)
  const doctype = /^\s*<!doctype[^>]*>/i.exec(html)
  if (doctype) return doctype[0] + BRIDGE + html.slice(doctype[0].length)
  return BRIDGE + html
}

/** The page's console: what its frame posts, cleared when the page is loaded again. */
function useConsole(frame: HTMLIFrameElement | null, generation: string): WebPreviewLog[] {
  const [logs, setLogs] = useState<WebPreviewLog[]>([])
  useEffect(() => setLogs([]), [generation])
  useEffect(() => {
    if (!frame) return
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow) return
      const data = event.data as { [MARK]?: number; level?: string; message?: unknown } | null
      if (!data || data[MARK] !== 1) return
      const level = data.level === 'error' || data.level === 'warn' ? data.level : 'log'
      const message = String(data.message ?? '').slice(0, 2000)
      setLogs((previous) => [...previous.slice(-199), { level, message, timestamp: new Date() }])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [frame])
  return logs
}

function Page({ srcDoc, reloads }: { srcDoc: string; reloads: number }) {
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const logs = useConsole(frame, `${reloads}:${srcDoc.length}`)
  return (
    <WebPreview key={reloads} className="rounded-none border-0">
      <WebPreviewBody srcDoc={srcDoc} ref={setFrame} />
      <WebPreviewConsole logs={logs} />
    </WebPreview>
  )
}

export function WebPageBlock({ source, complete }: WebPageBlockProps) {
  useLanguage()
  const [showSource, setShowSource] = useState(false)
  const [reloads, setReloads] = useState(0)
  const [large, setLarge] = useState(false)
  const reloadHover = useIconHover<RefreshCWIconHandle>()
  const preview = complete && !showSource
  const lines = useHighlightedCode(source, preview ? '' : 'html')
  const srcDoc = useRef({ source: '', html: '' })
  if (srcDoc.current.source !== source) srcDoc.current = { source, html: withBridge(source) }
  const title = /<title[^>]*>([^<]*)<\/title>/i.exec(source)?.[1]?.trim() || 'HTML'
  const lineCount = source.replace(/\n$/, '').split('\n').length

  async function download() {
    try {
      await saveTextFile('page.html', source)
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  return (
    <Artifact className="my-3 h-[28rem]" aria-busy={!complete}>
      <ArtifactHeader className="px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileIcon language="html" />
          <div className="min-w-0">
            <ArtifactTitle>{title}</ArtifactTitle>
            <ArtifactDescription className="text-xs">{t('webPreview.lines', { count: lineCount })}</ArtifactDescription>
          </div>
        </div>
        <ArtifactActions>
          <ArtifactAction
            icon={preview ? CodeIcon : EyeIcon}
            tooltip={preview ? t('webPreview.source') : t('webPreview.preview')}
            onClick={() => setShowSource(preview)}
            disabled={!complete}
          />
          <ArtifactAction
            tooltip={t('common.reload')}
            onMouseEnter={reloadHover.onMouseEnter}
            onMouseLeave={reloadHover.onMouseLeave}
            onClick={() => setReloads((n) => n + 1)}
            disabled={!preview}
          >
            <RefreshCWIcon ref={reloadHover.ref} aria-hidden="true" />
          </ArtifactAction>
          <ArtifactAction
            icon={Maximize2Icon}
            tooltip={t('webPreview.maximize')}
            onClick={() => setLarge(true)}
            disabled={!complete}
          />
          <ArtifactAction
            icon={DownloadIcon}
            tooltip={t('conversation.downloadCode')}
            onClick={() => void download()}
            disabled={!complete}
          />
          <CodeBlock.CopyButton value={source} size="icon-sm" className="text-muted-foreground" />
        </ArtifactActions>
      </ArtifactHeader>
      <ArtifactContent className="flex flex-col p-0">
        {preview ? (
          <Page srcDoc={srcDoc.current.html} reloads={reloads} />
        ) : (
          <CodeBlock.Root size="sm" className="min-h-0 flex-1 rounded-none border-0 bg-code-bg text-code-foreground">
            <CodeBlock.Content lineNumbers className="min-h-0 flex-1">
              {lines.map((line, index) => (
                <CodeBlock.Line key={index} code={line} />
              ))}
            </CodeBlock.Content>
          </CodeBlock.Root>
        )}
      </ArtifactContent>

      <Dialog open={large} onOpenChange={setLarge}>
        <DialogContent className="flex h-[90dvh] w-[92vw] max-w-none flex-col gap-3 p-4 sm:max-w-none">
          <DialogTitle className="text-ui">{title}</DialogTitle>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border">
            {large && <Page srcDoc={srcDoc.current.html} reloads={reloads} />}
          </div>
        </DialogContent>
      </Dialog>
    </Artifact>
  )
}

export default WebPageBlock
