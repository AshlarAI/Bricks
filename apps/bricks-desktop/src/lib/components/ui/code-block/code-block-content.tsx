import * as React from "react"
import { cn } from "$lib/utils"
import { CodeBlockLine } from "./code-block-line"

function CodeBlockContent({
  className,
  style,
  code,
  wrap = false,
  lineNumbers = false,
  startLine = 1,
  children,
  ...props
}: React.ComponentProps<"pre"> & {
  /** Plain text to render. Split into lines when `lineNumbers` is set. */
  code?: string
  wrap?: boolean
  lineNumbers?: boolean
  startLine?: number
}) {
  // A `code` string is split into lines so each one can be numbered.
  const lines =
    code !== undefined && lineNumbers
      ? code.replace(/\n$/, "").split("\n")
      : null

  return (
    <pre
      data-slot="code-block-content"
      data-wrap={wrap || undefined}
      data-numbered={lineNumbers || undefined}
      dir="ltr"
      tabIndex={0}
      style={{ counterReset: `line ${startLine - 1}`, ...style }}
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
        {lines
          ? lines.map((line, index) => <CodeBlockLine key={index} code={line} />)
          : code !== undefined
            ? code
            : children}
      </code>
    </pre>
  )
}

export { CodeBlockContent }
