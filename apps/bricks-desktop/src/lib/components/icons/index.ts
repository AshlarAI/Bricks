import { useCallback, useRef } from 'react'

export { BotIcon, type BotIconHandle } from './bot-icon'
export { BrainIcon, type BrainIconHandle } from './brain-icon'
export { CogIcon, type CogIconHandle } from './cog-icon'
export { CopyIcon, type CopyIconHandle } from './copy-icon'
export { DownloadIcon, type DownloadIconHandle } from './download-icon'
export { PlusIcon, type PlusIconHandle } from './plus-icon'
export { RefreshCWIcon, type RefreshCWIconHandle } from './refresh-cw-icon'

export interface AnimatedIconHandle {
  startAnimation: () => void
  stopAnimation: () => void
}

/** Triggers an animated icon's hover transition from its parent hitbox (e.g. a Button). */
export function useIconHover<T extends AnimatedIconHandle>() {
  const ref = useRef<T>(null)
  const onMouseEnter = useCallback(() => {
    ref.current?.startAnimation()
  }, [])
  const onMouseLeave = useCallback(() => {
    ref.current?.stopAnimation()
  }, [])
  return { ref, onMouseEnter, onMouseLeave }
}
