import * as React from "react"
import { cn } from "$lib/utils"

export type TraceLineStatus = "running" | "error" | "pending"

function TraceLine({
  className,
  status,
  ...props
}: React.ComponentProps<"span"> & {
  status?: TraceLineStatus
}) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(
        "gap-2 text-sm flex w-fit max-w-full min-w-0 items-center text-muted-foreground transition-colors in-[a,button]:cursor-pointer in-[a:hover,button:hover]:text-foreground data-[status=error]:text-destructive data-[status=error]:in-[a:hover,button:hover]:text-destructive data-[status=pending]:opacity-60 data-[status=running]:*:data-[slot=trace-title]:shimmer",
        className
      )}
      {...props}
    />
  )
}

export { TraceLine }
