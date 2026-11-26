import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import type { HighlightedLine, HighlightedToken } from "$lib/highlighter"
import { cn } from "$lib/utils"

const codeBlockLineVariants = cva(
  "-mx-3 px-3 in-data-numbered:gap-x-3 before:min-w-6 before:text-end before:text-muted-foreground after:start-1 after:text-muted-foreground group-data-[size=sm]/code-block:-mx-2.5 group-data-[size=sm]/code-block:px-2.5 relative block min-h-lh after:absolute after:top-0 after:select-none in-data-numbered:col-span-2 in-data-numbered:grid in-data-numbered:grid-cols-subgrid in-data-numbered:[counter-increment:line] in-data-numbered:before:content-[counter(line)] in-data-numbered:before:select-none in-data-numbered:supports-[content:counter(line)_/_'']:before:content-[counter(line)_/_'']",
  {
    variants: {
      variant: {
        default: "",
        added: "bg-muted after:content-['+']",
        removed: "bg-destructive/10 after:text-destructive after:content-['−']",
        highlighted: "bg-muted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type CodeBlockLineVariant = VariantProps<typeof codeBlockLineVariants>["variant"]

// One highlighted token, such as one returned by `useHighlightedCode`.
type CodeBlockLineToken = HighlightedToken

const newline = "\n"
const MAX_STYLE_CACHE = 512
const styleCache = new Map<string, React.CSSProperties>()

function parseTokenStyle(style?: string): React.CSSProperties | undefined {
  if (!style) return undefined
  const cached = styleCache.get(style)
  if (cached) return cached
  const result: Record<string, string> = {}
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":")
    if (colon === -1) continue
    const prop = declaration.slice(0, colon).trim()
    const value = declaration.slice(colon + 1).trim()
    if (!prop || !value) continue
    const key = prop.startsWith("--")
      ? prop
      : prop.replace(/-([a-z])/g, (_, ch: string) => ch.toUpperCase())
    result[key] = value
  }
  if (Object.keys(result).length === 0) return undefined
  const frozen = result as React.CSSProperties
  if (styleCache.size >= MAX_STYLE_CACHE) {
    const oldest = styleCache.keys().next()
    if (!oldest.done) styleCache.delete(oldest.value)
  }
  styleCache.set(style, frozen)
  return frozen
}

const CodeBlockLine = React.memo(function CodeBlockLine({
  className,
  variant = "default",
  code,
  children,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof codeBlockLineVariants> & {
    /** The line as plain text, or as highlighted tokens. When it is set, `children` is ignored. */
    code?: HighlightedLine
  }) {
  let lineContent: React.ReactNode
  if (typeof code === "string") {
    lineContent = code || newline
  } else if (code && code.length > 0) {
    lineContent = code.map((token, index) => (
      <span
        key={index}
        style={parseTokenStyle(token.style)}
        className={token.class}
      >
        {token.content}
      </span>
    ))
  } else if (code !== undefined) {
    lineContent = newline
  } else {
    lineContent = children ?? newline
  }

  return (
    // An empty line holds a newline so copying a selection keeps blank lines.
    <span
      data-slot="code-block-line"
      data-variant={variant ?? undefined}
      className={cn(codeBlockLineVariants({ variant }), className)}
      {...props}
    >
      <span data-slot="code-block-line-content" className="min-w-0">
        {lineContent}
      </span>
    </span>
  )
})

export {
  CodeBlockLine,
  codeBlockLineVariants,
  type CodeBlockLineVariant,
  type CodeBlockLineToken,
}
