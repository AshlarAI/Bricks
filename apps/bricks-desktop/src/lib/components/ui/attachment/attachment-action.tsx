import * as React from "react"
import { Button } from "$lib/components/ui/button"
import { cn } from "$lib/utils"

function AttachmentAction({
  className,
  variant = "ghost",
  size = "icon-xs",
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      data-slot="attachment-action"
      variant={variant}
      size={size}
      className={cn(className)}
      {...props}
    />
  )
}

export { AttachmentAction }
