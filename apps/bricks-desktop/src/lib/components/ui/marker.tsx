import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Separator } from '$lib/components/ui/separator'
import { cn } from '$lib/utils'

const markerVariants = cva('flex min-w-0 text-xs', {
  variants: {
    variant: {
      default: 'items-start gap-2',
      separator: 'items-center gap-3',
    },
    tone: {
      default: 'text-muted-foreground',
      info: 'text-muted-foreground',
      warning: 'text-warning',
      error: 'text-destructive',
    },
  },
  defaultVariants: {
    variant: 'default',
    tone: 'default',
  },
})

export type MarkerProps = React.ComponentProps<'div'> & VariantProps<typeof markerVariants>

function Marker({
  className,
  variant = 'default',
  tone = 'default',
  children,
  ...props
}: MarkerProps) {
  const effectiveVariant = variant ?? 'default'
  const effectiveTone = effectiveVariant === 'separator' ? 'default' : (tone ?? 'default')

  return (
    <div
      data-slot="marker"
      data-variant={effectiveVariant}
      data-tone={effectiveTone}
      className={cn(markerVariants({ variant: effectiveVariant, tone: effectiveTone }), className)}
      {...props}
    >
      {effectiveVariant === 'separator' ? (
        <>
          <Separator decorative className="flex-1" />
          {children}
          <Separator decorative className="flex-1" />
        </>
      ) : (
        children
      )}
    </div>
  )
}

function MarkerIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="marker-icon"
      className={cn(
        'mt-px inline-flex size-4 shrink-0 items-center justify-center [&>svg]:size-3.5',
        className,
      )}
      {...props}
    />
  )
}

function MarkerContent({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="marker-content"
      className={cn('min-w-0 break-words whitespace-pre-wrap', className)}
      {...props}
    />
  )
}

export { Marker, MarkerIcon, MarkerContent }
