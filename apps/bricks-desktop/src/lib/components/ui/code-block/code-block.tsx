import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "$lib/utils"

const codeBlockVariants = cva(
  "rounded-lg text-sm data-[size=sm]:text-xs has-[>[data-slot=code-block-content]:focus-visible]:ring-3 has-[>[data-slot=code-block-content]:focus-visible]:ring-ring/50 group/code-block relative flex w-full min-w-0 flex-col overflow-hidden",
  {
    variants: {
      variant: {
        default:
          "border border-input text-foreground dark:bg-input/30 has-[>[data-slot=code-block-content]:focus-visible]:border-ring",
        destructive:
          "border border-destructive/30 text-destructive dark:border-destructive/40",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

type CodeBlockVariant = VariantProps<typeof codeBlockVariants>["variant"]
type CodeBlockSize = "default" | "sm"

function CodeBlock({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof codeBlockVariants> & {
    size?: CodeBlockSize
  }) {
  return (
    <div
      data-slot="code-block"
      data-variant={variant ?? undefined}
      data-size={size}
      className={cn(codeBlockVariants({ variant }), className)}
      {...props}
    />
  )
}

export {
  CodeBlock,
  codeBlockVariants,
  type CodeBlockVariant,
  type CodeBlockSize,
}
