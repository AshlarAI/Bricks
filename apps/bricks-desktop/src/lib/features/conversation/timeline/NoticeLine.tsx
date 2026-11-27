import { CircleAlertIcon, InfoIcon, TriangleAlertIcon } from 'lucide-react'
import { Marker, MarkerContent, MarkerIcon } from '$lib/components/ui/marker'
import type { NoticeItem } from '$lib/state/conversation'

export interface NoticeLineProps {
  item: NoticeItem
}

export function NoticeLine({ item }: NoticeLineProps) {
  if (item.separator) {
    return (
      <Marker variant="separator">
        <MarkerContent>{item.message}</MarkerContent>
      </Marker>
    )
  }

  return (
    <Marker tone={item.level} role={item.level === 'error' ? 'alert' : undefined}>
      <MarkerIcon>
        {item.level === 'error' ? (
          <CircleAlertIcon aria-hidden="true" />
        ) : item.level === 'warning' ? (
          <TriangleAlertIcon aria-hidden="true" />
        ) : (
          <InfoIcon aria-hidden="true" />
        )}
      </MarkerIcon>
      <MarkerContent>{item.message}</MarkerContent>
    </Marker>
  )
}

export default NoticeLine
