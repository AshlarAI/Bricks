import * as React from "react"
import { cn } from "$lib/utils"

type MessageAlign = "start" | "end"

type MessageProps = React.ComponentProps<"div"> & {
  align?: MessageAlign
}

function Message({
  className,
  align = "start",
  ...props
}: MessageProps) {
  return (
    <div
      data-slot="message"
      data-align={align}
      className={cn(
        "text-sm gap-2 group/message relative flex w-full min-w-0 data-[align=end]:flex-row-reverse",
        className
      )}
      {...props}
    />
  )
}

export { Message, type MessageAlign, type MessageProps }
