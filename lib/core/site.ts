const rawSiteName =
  (typeof process !== 'undefined' &&
    (process.env.NEXT_PUBLIC_SITE_NAME || process.env.NEXT_PUBLIC_PRODUCT_NAME || '').trim()) ||
  ''

export const SITE_NAME = rawSiteName || 'Orda Control'

export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://ordaops.kz'

// Версия приложения. Не светим в шапке (убрано ради чистого SaaS-вида) —
// доступна в тултипе лого и в «О системе». Переопределяется NEXT_PUBLIC_APP_VERSION.
export const APP_VERSION =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_APP_VERSION?.trim()) || '2.0.1'

// Контакт для связи (CTA «Связаться с менеджером» на /upgrade и др.).
// Задаётся через NEXT_PUBLIC_SUPPORT_CONTACT (ссылка: https://t.me/…, https://wa.me/…, mailto:…).
export const SUPPORT_CONTACT = process.env.NEXT_PUBLIC_SUPPORT_CONTACT || SITE_URL

export const SITE_DESCRIPTION = `${SITE_NAME} — система для управления сменами, точками, зарплатой, доходами, расходами, Telegram-отчётами и управленческим учётом клуба и команды.`

/**
 * Короткая марка в логотипе (1–3 символа).
 * Задаётся явно: NEXT_PUBLIC_PRODUCT_MARK=ОК
 * Иначе: первые буквы двух слов из SITE_NAME («Orda Control» → «OC»).
 */
/**
 * Переопределён ли бренд под клиента.
 *
 * Продукт умеет вставать под чужим именем: `NEXT_PUBLIC_SITE_NAME` и
 * `NEXT_PUBLIC_PRODUCT_MARK`. В такой установке наш знак был бы чужим лицом —
 * там остаются буквы.
 *
 * Само по себе заданное имя ещё не значит «чужой»: наша же установка держит
 * `NEXT_PUBLIC_SITE_NAME=Orda Point`, и по одному факту «переменная задана»
 * мы спрятали бы собственный знак у себя. Поэтому смотрим на имя.
 */
export function isCustomBrand(siteName: string, productMark: string): boolean {
  if (productMark.trim()) return true
  const name = siteName.trim()
  if (!name) return false
  return !/^orda\b/i.test(name)
}

export const HAS_CUSTOM_BRAND = isCustomBrand(
  SITE_NAME,
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_PRODUCT_MARK?.trim()) || '',
)

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
