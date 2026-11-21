// A provider's logo: the brand's official square (light or dark with the theme), or a box.
import { PackageIcon } from 'lucide-react'
import { useTheme } from '$lib/theme/theme'
import { cn } from '$lib/utils'
import opencodeLight from '../../../assets/provider-icons/opencode-light.svg'
import opencodeDark from '../../../assets/provider-icons/opencode-dark.svg'

const LOGOS: Record<string, { light: string; dark: string }> = {
  opencode: { light: opencodeLight, dark: opencodeDark },
}

export interface ProviderLogoProps {
  logo: string | null | undefined
  className?: string
}

export function ProviderLogo({ logo, className }: ProviderLogoProps) {
  const { resolved } = useTheme()
  const asset = logo ? LOGOS[logo] : undefined
  const src = asset ? (resolved === 'dark' ? asset.dark : asset.light) : null

  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className={cn('shrink-0 rounded-[22%] object-contain', className)}
      />
    )
  }

  return (
    <PackageIcon
      className={cn('shrink-0 text-muted-foreground', className)}
      aria-hidden="true"
    />
  )
}

export default ProviderLogo
