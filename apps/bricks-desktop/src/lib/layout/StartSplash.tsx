// While Bricks starts: its logo, breathing in a soft shadow. No text. The logo
// contrasts with the theme last shown: dark tile on light, light tile on dark.
import { useEffect, useRef } from 'react'
import { t, useLanguage } from '$lib/i18n/i18n'
import darkTile from '../../assets/brand/app-dark.png'
import lightTile from '../../assets/brand/app-light.png'
import { useTheme } from '$lib/theme/theme'

export function StartSplash({ onReady }: { onReady?: () => void } = {}) {
  useLanguage()
  const { resolved } = useTheme()
  const src = resolved === 'dark' ? lightTile : darkTile
  const imgRef = useRef<HTMLImageElement>(null)
  const notifiedRef = useRef(false)

  const notifyReady = () => {
    if (notifiedRef.current) return
    notifiedRef.current = true
    onReady?.()
  }

  useEffect(() => {
    const img = imgRef.current
    if (!img) return
    if (typeof img.decode === 'function') {
      void img.decode().then(notifyReady, notifyReady)
    } else if (img.complete) {
      notifyReady()
    }
  }, [src])

  return (
    <div role="status" aria-label={t('layout.startingBricks')} className="grid h-screen place-items-center">
      <img
        ref={imgRef}
        src={src}
        alt=""
        width={106}
        height={106}
        decoding="sync"
        loading="eager"
        draggable={false}
        onLoad={notifyReady}
        onError={notifyReady}
        className="bricks-splash-logo size-[106px] select-none"
      />
    </div>
  )
}

export default StartSplash
