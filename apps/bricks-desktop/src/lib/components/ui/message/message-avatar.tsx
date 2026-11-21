import * as React from "react"
import { cn } from "$lib/utils"

function MessageAvatar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-avatar"
      className={cn(
        "min-w-8 group-has-data-[slot=message-footer]/message:-translate-y-8 flex w-fit shrink-0 items-center justify-center self-end overflow-hidden rounded-full bg-muted",
        className
      )}
      {...props}
    />
  )
}

export { MessageAvatar }
