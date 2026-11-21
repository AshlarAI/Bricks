import * as React from "react"
import { cn } from "$lib/utils"

function AttachmentContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="attachment-content"
      className={cn(
        "leading-tight group-data-[orientation=vertical]/attachment:px-1 max-w-full min-w-0 flex-1",
        className
      )}
      {...props}
    />
  )
}

export { AttachmentContent }
