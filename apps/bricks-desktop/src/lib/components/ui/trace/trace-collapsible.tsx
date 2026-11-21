import * as React from "react"
import { Collapsible } from "$lib/components/ui/collapsible"
import { cn } from "$lib/utils"

function TraceCollapsible({
  className,
  ...props
}: React.ComponentProps<typeof Collapsible>) {
  return (
    <Collapsible
      data-slot="trace-collapsible"
      className={cn("flex w-full min-w-0 flex-col", className)}
      {...props}
    />
  )
}

export { TraceCollapsible }
