import * as React from "react"
import { cn } from "$lib/utils"

function MessageGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-group"
      className={cn("gap-2 flex min-w-0 flex-col", className)}
      {...props}
    />
  )
}

export { MessageGroup }
