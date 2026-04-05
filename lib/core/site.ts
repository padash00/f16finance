const rawSiteName =
  (typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_SITE_NAME || process.env.NEXT_PUBLIC_PRODUCT_NAME || '').trim()) ||
  ''

export const SITE_NAME = rawSiteName || 'Orda Control'

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://ordaops.kz'

export const SITE_DESCRIPTION = `${SITE_NAME} — система для управления сменами, точками, зарплатой, доходами, расходами, Telegram-отчётами и управленческим учётом клуба и команды.`

/**
 * Короткая марка в логотипе (1–3 символа).
 * Задаётся явно: NEXT_PUBLIC_PRODUCT_MARK=ОК
 * Иначе: первые буквы двух слов из SITE_NAME («Orda Control» → «OC»).
 */
export function getProductMark(): string {
  const custom = (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PRODUCT_MARK?.trim()) || ''
  if (custom) return custom.slice(0, 3).toUpperCase()

  const name = SITE_NAME.trim()
  const words = name.split(/\s+/).filter(Boolean)
  if (words.length >= 2) {
    const a = words[0]?.charAt(0) || ''
    const b = words[1]?.charAt(0) || ''
    return `${a}${b}`.toUpperCase() || '•'
  }
  if (name.length >= 2) return name.slice(0, 2).toUpperCase()
  return name.charAt(0).toUpperCase() || '•'
}
export const APEX_MAINTENANCE_MODE = process.env.APEX_MAINTENANCE_MODE === 'true'
