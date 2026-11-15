<script lang="ts">
  import { ScrollArea } from '$lib/components/ui/scroll-area'
  // A top-level ```markdown fence: its source by default (highlighted, numbered lines), or its
  // rendering with « Aperçu » on. Copy always takes the source.
  import { t } from '$lib/i18n/i18n.svelte'
  import * as CodeBlock from '$lib/components/ui/code-block'
  import { Label } from '$lib/components/ui/label'
  import { Separator } from '$lib/components/ui/separator'
  import { Switch } from '$lib/components/ui/switch'
  import { useHighlightedCode } from '$lib/hooks/use-highlighted-code.svelte'
  import type { FileReference } from './types'
  import MarkdownView from './MarkdownView.svelte'

  let {
    source,
    complete,
    idPrefix,
    onFile,
    onLinkResult,
  }: {
    source: string
    complete: boolean
    idPrefix: string
    onFile?: (ref: FileReference) => void
    onLinkResult?: (error: string | null) => void
  } = $props()

  const uid = $props.id()
  let preview = $state(false)

  /** The highlighter loads only while the source is shown. */
  const lines = useHighlightedCode(
    () => source,
    () => (preview ? '' : 'markdown'),
  )
</script>

<CodeBlock.Root size="sm" class="my-2 bg-code-bg text-code-foreground" aria-busy={!complete}>
  <CodeBlock.Header>
    <CodeBlock.Title>Markdown</CodeBlock.Title>
    <CodeBlock.Actions class="gap-2">
      <div class="flex items-center gap-1.5">
        <Switch id={`${uid}-preview`} size="sm" bind:checked={preview} />
        <Label for={`${uid}-preview`} class="text-xs font-normal text-muted-foreground">
          {t('conversation.markdownPreview')}
        </Label>
      </div>
      <CodeBlock.CopyButton value={source} />
    </CodeBlock.Actions>
  </CodeBlock.Header>
  <Separator class="mt-2.5 bg-border-strong" />
  {#if preview}
    <ScrollArea viewportClass="max-h-[32rem]" orientation="both">
      <div class="px-3 pt-1 pb-2">
        <MarkdownView {source} streaming={!complete} {idPrefix} {onFile} {onLinkResult} />
      </div>
    </ScrollArea>
  {:else}
    <CodeBlock.Content lineNumbers class="max-h-96 pt-2.5!">
      {#each lines.current as line, index (index)}
        <CodeBlock.Line code={line} />
      {/each}
    </CodeBlock.Content>
  {/if}
</CodeBlock.Root>
