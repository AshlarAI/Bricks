import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import type { NoticeItem } from '$lib/state/conversation'
import { cn } from '$lib/utils'

export interface NoticeLineProps {
  item: NoticeItem
}

export function NoticeLine({ item }: NoticeLineProps) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 text-xs break-words whitespace-pre-wrap',
        item.level === 'error'
          ? 'text-destructive'
          : item.level === 'warning'
            ? 'text-warning'
            : 'text-muted-foreground',
      )}
    >
      {item.level === 'error' ? (
        <CircleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      ) : item.level === 'warning' ? (
        <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0">{item.message}</span>
    </p>
  )
}

export default NoticeLine
