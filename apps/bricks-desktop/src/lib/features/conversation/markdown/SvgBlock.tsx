// A top-level ```svg fence of an assistant message: the drawing once the fence
// is closed, in the same viewer as the other diagrams (sanitized, sandboxed).
// While it streams, and when it is invalid or too large, its source stays shown.
import { useMemo } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { sanitizeSvg } from './sanitize'
import { MAX_SVG_LENGTH } from './svg-viewer'
import SvgViewer from './SvgViewer'
import * as CodeBlock from '$lib/components/ui/code-block'
import { useHighlightedCode } from '$lib/hooks/use-highlighted-code'

export interface SvgBlockProps {
  source: string
  complete: boolean
}

export function SvgBlock({ source, complete }: SvgBlockProps) {
  const language = useLanguage()

  const error = useMemo(() => {
    if (!complete) return null
    if (source.length > MAX_SVG_LENGTH) return t('conversation.svgTooLarge5MibAt')
    // A drawing, not a page that holds one somewhere.
    if (
      !/^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!DOCTYPE[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(
        source,
      )
    ) {
      return t('conversation.theRootMustBeAnSvg')
    }
    return sanitizeSvg(source) ? null : t('conversation.invalidSvg')
  }, [source, complete, language])

  /** The source, highlighted line by line as it streams. */
  const lines = useHighlightedCode(source, 'xml')

  if (complete && !error) {
    return (
      <SvgViewer
        svg={source}
        source={source}
        title="SVG"
        variant="drawing"
        fileName={t('conversation.drawingSvg')}
      />
    )
  }

  return (
    <CodeBlock.Root
      size="sm"
      variant={error ? 'destructive' : 'default'}
      className="my-2 bg-code-bg text-code-foreground"
      aria-busy={!complete}
    >
      <CodeBlock.Header>
        <CodeBlock.Title>SVG</CodeBlock.Title>
        <CodeBlock.Actions>
          <CodeBlock.CopyButton value={source} />
        </CodeBlock.Actions>
      </CodeBlock.Header>
      {error && (
        <p className="px-2.5 pt-1.5 text-xs text-destructive" role="alert">
          {t('conversation.drawingNotRendered', { error })}
        </p>
      )}
      <CodeBlock.Content lineNumbers className="max-h-96">
        {lines.map((line, index) => (
          <CodeBlock.Line key={index} code={line} />
        ))}
      </CodeBlock.Content>
    </CodeBlock.Root>
  )
}

export default SvgBlock
