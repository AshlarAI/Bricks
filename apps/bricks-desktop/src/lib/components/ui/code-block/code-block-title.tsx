import * as React from "react"
import { cn } from "$lib/utils"

function CodeBlockTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="code-block-title"
      className={cn(
        "font-sans text-sm font-medium text-foreground group-data-[variant=destructive]/code-block:text-destructive *:[svg]:me-1.5 [&_svg:not([class*='size-'])]:size-3.5 group-data-[size=sm]/code-block:text-xs min-w-0 truncate [&_svg]:pointer-events-none [&_svg]:inline-block [&_svg]:align-middle",
        className
      )}
      {...props}
    />
  )
}

export { CodeBlockTitle }
