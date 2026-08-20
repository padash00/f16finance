import { OrdaPointSymbol } from '@/components/brand/orda-point-symbol'
import { getProductMark, HAS_CUSTOM_BRAND } from '@/lib/core/site'
import { cn } from '@/lib/utils'

type Props = {
  className?: string
  /** Размер контейнера марки */
  size?: 'md' | 'lg'
  /** Логотип организации (white-label). Если задан — показываем его вместо буквенной марки. */
  logoUrl?: string | null
}

/**
 * Квадратная марка бренда в шапке.
 * По умолчанию — буквы продукта (NEXT_PUBLIC_SITE_NAME / NEXT_PUBLIC_PRODUCT_MARK).
 * Если у активной организации загружен логотип — показываем его (white-label).
 */
export function AppLogoMark({ className, size = 'md', logoUrl }: Props) {
  const mark = getProductMark()
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl' : 'h-12 w-12 rounded-2xl'
  const textSize = mark.length > 2 ? 'text-[10px] leading-tight' : 'text-sm'

  // White-label: логотип организации в аккуратном светлом квадрате.
  if (logoUrl) {
    return (
      <div className={cn('relative shrink-0 group', className)}>
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 blur-lg opacity-30 transition-opacity duration-500 group-hover:opacity-60" />
        <div
          className={cn(
            'relative flex items-center justify-center overflow-hidden border border-slate-200 bg-white shadow-lg dark:border-white/10',
            box,
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logoUrl} alt="Логотип организации" className="h-full w-full object-contain p-1.5" loading="lazy" />
        </div>
      </div>
    )
  }

  // Свой знак — только когда продукт наш. Под чужим именем (white-label)
  // остаются буквы: чужому клиенту наш знак ни к чему.
  if (!HAS_CUSTOM_BRAND) {
    return (
      <div className={cn('relative shrink-0 group', className)}>
        <div className="absolute inset-0 rounded-2xl bg-[linear-gradient(135deg,#20C997,#0F7F6E)] blur-lg opacity-40 transition-opacity duration-500 group-hover:opacity-70 dark:opacity-50 dark:group-hover:opacity-80" />
        <div
          className={cn(
            'relative flex items-center justify-center border shadow-lg',
            'border-slate-200 bg-gradient-to-br from-white to-slate-100',
            'dark:border-white/10 dark:from-slate-900 dark:to-slate-800 dark:shadow-2xl',
            box,
          )}
        >
          <OrdaPointSymbol size={size === 'lg' ? 34 : 28} title="" />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('relative shrink-0 group', className)}>
      <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 blur-lg opacity-40 transition-opacity duration-500 group-hover:opacity-70 dark:opacity-50 dark:group-hover:opacity-80" />
      <div
        className={cn(
          // Светлая тема — светлый значок; тёмная — тёмный.
          'relative flex items-center justify-center border shadow-lg',
          'border-slate-200 bg-gradient-to-br from-white to-slate-100',
          'dark:border-white/10 dark:from-slate-900 dark:to-slate-800 dark:shadow-2xl',
          box,
        )}
      >
        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-transparent to-transparent dark:from-white/10" />
        <span
          className={cn(
            'relative z-10 select-none font-bold tracking-tight text-amber-600 dark:text-amber-300',
            textSize,
          )}
          aria-hidden
        >
          {mark}
        </span>
      </div>
    </div>
  )
}
