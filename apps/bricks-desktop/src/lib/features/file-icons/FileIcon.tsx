import { useState } from 'react'
import { GENERIC_ICON_ID, iconId, iconUrl, type IconKind } from './resolve'

export interface FileIconProps {
  path?: string | null
  kind?: IconKind
  open?: boolean
  language?: string | null
}

export function FileIcon({ path = null, kind = 'file', open = false, language = null }: FileIconProps) {
  const id = iconId({ path, kind, open, language })
  /** An image that failed: its own id, then the generic one; never retried in a loop. */
  const [failedId, setFailedId] = useState<string | null>(null)
  const [genericBroken, setGenericBroken] = useState(false)
  const shown = id !== failedId ? id : genericBroken ? null : GENERIC_ICON_ID

  if (!shown) return null

  return (
    /* Decorative: the name next to it says what it is. */
    <img
      className="file-icon"
      src={iconUrl(shown)}
      alt=""
      aria-hidden="true"
      width={16}
      height={16}
      draggable={false}
      decoding="async"
      onError={() => {
        if (shown === GENERIC_ICON_ID) setGenericBroken(true)
        setFailedId(id)
      }}
    />
  )
}

export default FileIcon
