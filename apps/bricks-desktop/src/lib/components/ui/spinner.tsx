import type * as React from "react"
import { cn } from "$lib/utils"
import { Dotm3x3_20 } from "$lib/components/ui/dotm-3x3-20"

function Spinner({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn("inline-flex size-4 shrink-0 items-center justify-center", className)}
      {...props}
    >
      <Dotm3x3_20 dotSize={3} cellPadding={1} ariaLabel="" />
    </span>
  )
}

export { Spinner }
