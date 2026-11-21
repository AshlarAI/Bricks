import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "$lib/utils"

const bubbleReactionsVariants = cva(
  "rounded-full ring-3 ring-card bg-muted shrink-0 gap-1 px-1.5 py-0.5 has-[button]:p-0 text-sm absolute z-10 flex w-fit items-center justify-center",
  {
    variants: {
      side: {
        top: "top-0 -translate-y-3/4",
        bottom: "bottom-0 translate-y-3/4",
      },
      align: {
        start: "left-3",
        end: "right-3",
      },
    },
    defaultVariants: {
      side: "bottom",
      align: "end",
    },
  }
)

export type BubbleReactionsSide = VariantProps<typeof bubbleReactionsVariants>["side"]
export type BubbleReactionsAlign = VariantProps<typeof bubbleReactionsVariants>["align"]

function BubbleReactions({
  className,
  side = "bottom",
  align = "end",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof bubbleReactionsVariants>) {
  return (
    <div
      data-slot="bubble-reactions"
      data-align={align}
      data-side={side}
      className={cn(bubbleReactionsVariants({ side, align }), className)}
      {...props}
    />
  )
}

export { BubbleReactions, bubbleReactionsVariants }
