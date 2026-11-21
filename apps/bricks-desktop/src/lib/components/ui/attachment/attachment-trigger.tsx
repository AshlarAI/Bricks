import * as React from "react"
import { Slot } from "radix-ui"
import { cn } from "$lib/utils"

function AttachmentTrigger({
  className,
  type,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> & {
  asChild?: boolean
}) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="attachment-trigger"
      type={type ?? (asChild ? undefined : "button")}
      className={cn("absolute inset-0 z-10 outline-none", className)}
      {...props}
    />
  )
}

export { AttachmentTrigger }
