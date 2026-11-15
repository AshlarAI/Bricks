<script lang="ts">
  // A top-level ```svg fence of an assistant message: the drawing once the fence
  // is closed, in the same viewer as the other diagrams (sanitized, sandboxed).
  // While it streams, and when it is invalid or too large, its source stays shown.
  import { t } from '$lib/i18n/i18n.svelte'
  import { sanitizeSvg } from './sanitize'
  import { MAX_SVG_LENGTH } from './svg-viewer'
  import SvgViewer from './SvgViewer.svelte'
  import * as CodeBlock from '$lib/components/ui/code-block'
  import { useHighlightedCode } from '$lib/hooks/use-highlighted-code.svelte'

  let { source, complete }: { source: string; complete: boolean } = $props()

  const error = $derived.by(() => {
    if (!complete) return null
    if (source.length > MAX_SVG_LENGTH) return t('conversation.svgTooLarge5MibAt')
    // A drawing, not a page that holds one somewhere.
    if (!/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(source)) {
      return t('conversation.theRootMustBeAnSvg')
    }
    return sanitizeSvg(source) ? null : t('conversation.invalidSvg')
  })

  /** The source, highlighted line by line as it streams. */
  const lines = useHighlightedCode(() => source, () => 'xml')
</script>

{#if complete && !error}
  <SvgViewer svg={source} {source} title="SVG" variant="drawing" fileName={t('conversation.drawingSvg')} />
{:else}
  <CodeBlock.Root
    size="sm"
    variant={error ? 'destructive' : 'default'}
    class="my-2 bg-code-bg text-code-foreground"
    aria-busy={!complete}
  >
    <CodeBlock.Header>
      <CodeBlock.Title>SVG</CodeBlock.Title>
      <CodeBlock.Actions>
        <CodeBlock.CopyButton value={source} />
      </CodeBlock.Actions>
    </CodeBlock.Header>
    {#if error}<p class="px-2.5 pt-1.5 text-xs text-destructive" role="alert">{t('conversation.drawingNotRendered', { error })}</p>{/if}
    <CodeBlock.Content lineNumbers class="max-h-96">
      {#each lines.current as line, index (index)}
        <CodeBlock.Line code={line} />
      {/each}
    </CodeBlock.Content>
  </CodeBlock.Root>
{/if}
