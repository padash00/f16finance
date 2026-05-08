import { getBrandLogoUrl } from '@/lib/branding'

interface Props {
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}

const sizeMap = {
  xs: { box: 'h-7 w-7', text: 'text-[9px]', radius: 'rounded-lg' },
  sm: { box: 'h-8 w-8', text: 'text-[10px]', radius: 'rounded-lg' },
  md: { box: 'h-9 w-9', text: 'text-[11px]', radius: 'rounded-xl' },
  lg: { box: 'h-12 w-12', text: 'text-base', radius: 'rounded-2xl' },
}

/**
 * Универсальный логотип с брендингом:
 * — Если у компании задан brand_logo_url → показывает картинку
 * — Иначе — capsule "OP" с brand color (или дефолт emerald→teal)
 */
export function BrandLogo({ size = 'sm', className = '' }: Props) {
  const cfg = sizeMap[size]
  const logoUrl = getBrandLogoUrl()

  if (logoUrl) {
    return (
      <div className={`${cfg.box} ${cfg.radius} overflow-hidden bg-white shadow-md ${className}`}>
        <img src={logoUrl} alt="logo" className="h-full w-full object-cover" />
      </div>
    )
  }

  // Дефолт: gradient OP
  return (
    <div
      className={`${cfg.box} ${cfg.radius} flex items-center justify-center shadow-md shadow-emerald-500/30 ${className}`}
      style={{
        background: 'linear-gradient(to bottom right, var(--brand-color, #34d399), var(--brand-color-dark, #059669))',
      }}
    >
      <span className={`${cfg.text} font-bold tracking-tight text-white`}>OP</span>
    </div>
  )
}
