import * as React from "react"
import { XIcon, type LucideIcon } from "lucide-react"
import { Button } from "$lib/components/ui/button"
import { Tooltip, TooltipContent, TooltipTrigger } from "$lib/components/ui/tooltip"
import { t, useLanguage } from "$lib/i18n/i18n"
import { cn } from "$lib/utils"

function Artifact({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="artifact"
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border bg-background shadow-sm",
        className
      )}
      {...props}
    />
  )
}

function ArtifactHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="artifact-header"
      className={cn(
        "flex items-center justify-between gap-2 border-b bg-muted/50 px-4 py-3",
        className
      )}
      {...props}
    />
  )
}

function ArtifactTitle({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="artifact-title"
      className={cn("truncate text-sm font-medium text-foreground", className)}
      {...props}
    />
  )
}

function ArtifactDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="artifact-description"
      className={cn("truncate text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function ArtifactActions({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="artifact-actions"
      className={cn("flex shrink-0 items-center gap-1", className)}
      {...props}
    />
  )
}

function ArtifactAction({
  tooltip,
  label,
  icon: Icon,
  children,
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  tooltip?: string
  label?: string
  icon?: LucideIcon
}) {
  const button = (
    <Button
      data-slot="artifact-action"
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label || tooltip}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      {Icon ? <Icon aria-hidden="true" /> : children}
    </Button>
  )
  if (!tooltip) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{tooltip}</TooltipContent>
    </Tooltip>
  )
}

function ArtifactClose({ className, children, ...props }: React.ComponentProps<typeof Button>) {
  useLanguage()
  return (
    <Button
      data-slot="artifact-close"
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={t("common.close")}
      className={cn("text-muted-foreground hover:text-foreground", className)}
      {...props}
    >
      {children ?? <XIcon aria-hidden="true" />}
    </Button>
  )
}

function ArtifactContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="artifact-content"
      className={cn("min-h-0 flex-1 overflow-auto p-4", className)}
      {...props}
    />
  )
}

export {
  Artifact,
  ArtifactAction,
  ArtifactActions,
  ArtifactClose,
  ArtifactContent,
  ArtifactDescription,
  ArtifactHeader,
  ArtifactTitle,
}
