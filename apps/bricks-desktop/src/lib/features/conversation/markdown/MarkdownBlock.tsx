// A top-level ```markdown fence: its source by default (highlighted, numbered lines), or its
// rendering with « Aperçu » on. Copy always takes the source.
import { useId, useState } from 'react'
import { ScrollArea } from '$lib/components/ui/scroll-area'
import { t, useLanguage } from '$lib/i18n/i18n'
import * as CodeBlock from '$lib/components/ui/code-block'
import { Label } from '$lib/components/ui/label'
import { Separator } from '$lib/components/ui/separator'
import { Switch } from '$lib/components/ui/switch'
import { useHighlightedCode } from '$lib/hooks/use-highlighted-code'
import type { FileReference } from './types'
import MarkdownView from './MarkdownView'

export interface MarkdownBlockProps {
  source: string
  complete: boolean
  idPrefix: string
  onFile?: (ref: FileReference) => void
  onLinkResult?: (error: string | null) => void
}

export function MarkdownBlock({
  source,
  complete,
  idPrefix,
  onFile,
  onLinkResult,
}: MarkdownBlockProps) {
  useLanguage()
  const uid = useId()
  const [preview, setPreview] = useState(false)

  /** The highlighter loads only while the source is shown. */
  const lines = useHighlightedCode(source, preview ? '' : 'markdown')

  return (
    <CodeBlock.Root size="sm" className="my-2 bg-code-bg text-code-foreground" aria-busy={!complete}>
      <CodeBlock.Header>
        <CodeBlock.Title>Markdown</CodeBlock.Title>
        <CodeBlock.Actions className="gap-2">
          <div className="flex items-center gap-1.5">
            <Switch id={`${uid}-preview`} size="sm" checked={preview} onCheckedChange={setPreview} />
            <Label htmlFor={`${uid}-preview`} className="text-xs font-normal text-muted-foreground">
              {t('conversation.markdownPreview')}
            </Label>
          </div>
          <CodeBlock.CopyButton value={source} />
        </CodeBlock.Actions>
      </CodeBlock.Header>
      <Separator className="mt-2.5 bg-border-strong" />
      {preview ? (
        <ScrollArea viewportClass="max-h-[32rem]" orientation="both">
          <div className="px-3 pt-1 pb-2">
            <MarkdownView
              source={source}
              streaming={!complete}
              idPrefix={idPrefix}
              onFile={onFile}
              onLinkResult={onLinkResult}
            />
          </div>
        </ScrollArea>
      ) : (
        <CodeBlock.Content lineNumbers lines={lines} className="max-h-96 pt-2.5!" />
      )}
    </CodeBlock.Root>
  )
}

export default MarkdownBlock
