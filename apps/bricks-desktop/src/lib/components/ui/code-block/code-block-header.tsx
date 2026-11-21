import * as React from "react"
import { cn } from "$lib/utils"

function CodeBlockHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-header"
      className={cn(
        "gap-2 px-3 pt-3 text-muted-foreground group-data-[variant=destructive]/code-block:text-destructive group-data-[size=sm]/code-block:px-2.5 group-data-[size=sm]/code-block:pt-2.5 flex min-w-0 shrink-0 items-center *:has-[>[data-slot=code-block-title]]:min-w-0",
        className
      )}
      {...props}
    />
  )
}

export { CodeBlockHeader }
