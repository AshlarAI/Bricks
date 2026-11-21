import * as React from "react"
import { cn } from "$lib/utils"

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("gap-2 flex min-w-0 flex-col", className)}
      {...props}
    />
  )
}

export { BubbleGroup }
