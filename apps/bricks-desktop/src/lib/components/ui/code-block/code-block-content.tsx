import * as React from "react"
import { cn } from "$lib/utils"
import type { HighlightedLine } from "$lib/highlighter"
import { longestLineOf, useVirtualLines } from "$lib/hooks/use-virtual-lines"
import { CodeBlockLine } from "./code-block-line"

const VIRTUALIZE_THRESHOLD = 200
const DEFAULT_LINE_HEIGHT_PX = 20

function lineText(line: HighlightedLine): string {
  if (typeof line === "string") return line
  return line.map((token) => token.content).join("")
}

function CodeBlockContent({
  className,
  style,
  code,
  lines: linesProp,
  wrap = false,
  lineNumbers = false,
  startLine = 1,
  children,
  onScroll,
  ...props
}: React.ComponentProps<"pre"> & {
  /** Plain text to render. Split into lines when `lineNumbers` is set. */
  code?: string
  /** Pre-split plain or highlighted lines. Enables automatic virtualization on large blocks. */
  lines?: readonly HighlightedLine[]
  wrap?: boolean
  lineNumbers?: boolean
  startLine?: number
}) {
  // A `code` string is split into lines so each one can be numbered.
  const lines = React.useMemo<readonly HighlightedLine[] | null>(() => {
    if (linesProp !== undefined) return linesProp
    if (code !== undefined && lineNumbers) {
      return code.replace(/\n$/, "").split("\n")
    }
    return null
  }, [linesProp, code, lineNumbers])

  const preRef = React.useRef<HTMLPreElement | null>(null)
  const [scrollEl, setScrollEl] = React.useState<HTMLPreElement | null>(null)
  const [lineHeight, setLineHeight] = React.useState(DEFAULT_LINE_HEIGHT_PX)

  const handleRef = React.useCallback((node: HTMLPreElement | null) => {
    preRef.current = node
    setScrollEl(node)
  }, [])

  const totalLines = lines?.length ?? 0
  const virtualize = lines !== null && !wrap && totalLines > VIRTUALIZE_THRESHOLD

  React.useLayoutEffect(() => {
    if (!virtualize || !preRef.current) return
    const firstLine = preRef.current.querySelector<HTMLElement>('[data-slot="code-block-line"]')
    const measured =
      firstLine?.getBoundingClientRect().height ||
      parseFloat(getComputedStyle(preRef.current).lineHeight) ||
      DEFAULT_LINE_HEIGHT_PX
    if (measured > 0 && Math.abs(measured - lineHeight) > 0.25) {
      setLineHeight(measured)
    }
  }, [virtualize, lineHeight, totalLines])

  const window = useVirtualLines({
    totalLines,
    lineHeight,
    enabled: virtualize,
    scrollElement: scrollEl,
  })

  const widestLine = React.useMemo(() => {
    if (!virtualize || !lines) return ""
    return longestLineOf(lines.map(lineText))
  }, [virtualize, lines])

  const visibleLines = React.useMemo(() => {
    if (!lines) return null
    if (!virtualize) return lines
    return lines.slice(window.startIndex, window.endIndex)
  }, [lines, virtualize, window.startIndex, window.endIndex])

  const handleScroll: React.UIEventHandler<HTMLPreElement> = (event) => {
    window.onScroll()
    onScroll?.(event)
  }

  return (
    <pre
      ref={handleRef}
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      data-numbered={lineNumbers || undefined}
      dir="ltr"
      tabIndex={0}
      onScroll={handleScroll}
      style={{ counterReset: `line ${startLine + window.startIndex - 1}`, ...style }}
      className={cn(
        "px-3 py-3 leading-relaxed group-has-data-[slot=code-block-header]/code-block:pt-2 group-has-data-[slot=code-block-footer]/code-block:pb-2 group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:py-2.5 group-data-[size=sm]/code-block:group-has-data-[slot=code-block-header]/code-block:pt-1.5 min-h-0 min-w-0 scroll-fade-x scrollbar-thin overflow-auto text-start font-mono outline-none data-wrap:scroll-fade-y data-wrap:wrap-break-word data-wrap:whitespace-pre-wrap",
        className
      )}
      {...props}
    >
      <code
        data-slot="code-block-code"
        className="grid min-h-lh min-w-max content-start in-data-numbered:grid-cols-[auto_1fr] in-data-wrap:min-w-0"
      >
        {virtualize && widestLine ? (
          <span
            aria-hidden="true"
            className="invisible col-span-full h-0 overflow-hidden px-3 whitespace-pre select-none"
          >
            {`000000 ${widestLine}`}
          </span>
        ) : null}
        {virtualize && window.topPadPx > 0 ? (
          <span aria-hidden="true" className="col-span-full block" style={{ height: window.topPadPx }} />
        ) : null}
        {visibleLines
          ? visibleLines.map((line, index) => (
              <CodeBlockLine key={window.startIndex + index} code={line} />
            ))
          : code !== undefined
            ? code
            : children}
        {virtualize && window.bottomPadPx > 0 ? (
          <span aria-hidden="true" className="col-span-full block" style={{ height: window.bottomPadPx }} />
        ) : null}
      </code>
    </pre>
  )
}

export { CodeBlockContent }
