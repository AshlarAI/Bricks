import * as React from "react"
import { cn } from "$lib/utils"

function MessageContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="message-content"
      className={cn(
        "gap-2.5 group-data-[align=end]/message:*:data-slot:self-end flex w-full min-w-0 flex-col wrap-break-word",
        className
      )}
      {...props}
    />
  )
}

export { MessageContent }
