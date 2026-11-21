// While Bricks starts: its logo, breathing in a soft shadow. No text. The logo
// contrasts with the theme last shown: dark tile on light, light tile on dark.
import { t, useLanguage } from '$lib/i18n/i18n'
import darkTile from '../../assets/brand/app-dark.png'
import lightTile from '../../assets/brand/app-light.png'
import { useTheme } from '$lib/theme/theme'

export function StartSplash() {
  useLanguage()
  const { resolved } = useTheme()
  const src = resolved === 'dark' ? lightTile : darkTile

  return (
    <div role="status" aria-label={t('layout.startingBricks')} className="grid h-screen place-items-center">
      <img
        src={src}
        alt=""
        width={106}
        height={106}
        draggable={false}
        className="bricks-splash-logo size-[106px] select-none"
      />
    </div>
  )
}

export default StartSplash
