// The welcome of a new conversation: the logo, the name, one line, and four suggestions
// that fill the composer (they never send). Over a slow field of characters. No entrance
// animation: the screen is there, it does not arrive.
import { ArrowRightIcon } from 'lucide-react'
import { t, useLanguage } from '$lib/i18n/i18n'
import { useTheme } from '$lib/theme/theme'
import darkTile from '../../../../assets/brand/app-dark.png'
import lightTile from '../../../../assets/brand/app-light.png'
import TypedLine from './TypedLine'
import WelcomeField from './WelcomeField'
import { STARTERS, starterText } from './starters'

export interface WelcomeViewProps {
  onPick: (text: string) => void
  /** Paused while the composer has focus: the typed line finishes and holds. */
  paused?: boolean
}

export function WelcomeView({ onPick, paused = false }: WelcomeViewProps) {
  useLanguage()
  const { resolved: resolvedTheme } = useTheme()

  // The tile that contrasts with the theme on screen, as at start-up.
  const logo = resolvedTheme === 'dark' ? lightTile : darkTile

  return (
    <div className="relative flex h-full items-center justify-center overflow-hidden px-6">
      <WelcomeField />
      <div className="relative flex w-full max-w-[440px] flex-col items-center text-center">
        {/* The image keeps the margin of the icon grid: the tile is 77% of it, so it is drawn larger
            and cut to the tile. */}
        <div className="mb-5 size-[60px] overflow-hidden rounded-[23%] shadow-[0_12px_50px_-12px_rgb(0_0_0/0.55)] ring-1 ring-element-active">
          <img
            src={logo}
            alt=""
            width={78}
            height={78}
            draggable={false}
            className="-m-[9px] size-[78px] max-w-none"
          />
        </div>
        <h2 className="mt-1.5 bg-gradient-to-b from-foreground to-foreground/55 bg-clip-text text-[22px] leading-tight font-semibold tracking-tight text-transparent">
          {t('welcome.title')}
        </h2>
        <TypedLine paused={paused} />
        <div
          role="group"
          aria-label={t('welcome.suggestions')}
          className="mt-7 grid w-full grid-cols-2 gap-2.5 perspective-midrange"
        >
          {STARTERS.map((starter) => {
            const Icon = starter.icon
            return (
              <button
                key={starter.id}
                type="button"
                className="group relative flex cursor-pointer flex-col gap-2.5 rounded-[12px] border border-border bg-card p-3 text-left shadow-xs transition-all duration-200 ease-out transform-3d hover:border-border-strong hover:shadow-md motion-safe:hover:-translate-y-0.5 motion-safe:hover:rotate-x-6 active:translate-y-0 active:rotate-x-0"
                onClick={() => onPick(starterText(starter))}
              >
                <span className="flex size-7 items-center justify-center rounded-lg border border-border-subtle bg-card text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon className="size-[13px]" aria-hidden="true" />
                </span>
                <ArrowRightIcon
                  className="absolute top-3 right-3 size-[13px] -translate-x-1 text-muted-foreground opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:translate-x-0 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
                <span className="text-sm leading-snug font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                  {t(starter.label)}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default WelcomeView
