import * as React from "react"
import { cn } from "$lib/utils"

function MessageHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-header"
      className={cn(
        "text-xs font-medium text-muted-foreground px-3 group-has-data-[variant=ghost]/message:px-0 flex max-w-full min-w-0 items-center",
        className
      )}
      {...props}
    />
  )
}

export { MessageHeader }
