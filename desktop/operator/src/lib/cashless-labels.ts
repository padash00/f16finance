/**
 * Provider-specific лейблы для безналичной оплаты.
 *
 * Используется везде в UI вместо хардкода "Kaspi POS" / "Kaspi Online" / etc.
 * Берёт имя из payment_provider компании; если провайдер = generic — показывает
 * «Безналичный». Иначе — имя провайдера + продукт.
 *
 * Примеры:
 *   getCashlessLabel({ provider: 'kaspi' })            → "Kaspi"
 *   getCashlessLabel({ provider: 'halyk' })            → "Halyk"
 *   getCashlessLabel({ provider: 'generic' })          → "Безналичный"
 *   getCashlessLabel({ provider: 'kaspi' }, 'pos')     → "Kaspi POS"
 *   getCashlessLabel({ provider: 'generic' }, 'pos')   → "Безналичный POS"
 *   getCashlessLabel({ provider: 'kaspi' }, 'online')  → "Kaspi Online"
 *   getCashlessLabel({ provider: 'generic' }, 'qr')    → "QR-оплата"
 */

export type PaymentProviderCode = 'kaspi' | 'halyk' | 'sber' | 'generic'
export type CashlessProductCode = 'pos' | 'online' | 'qr' | 'gold' | 'red' | 'kredit'

export interface PaymentProviderInfo {
  code: PaymentProviderCode | null
  name?: string | null
}

const PROVIDER_DISPLAY: Record<string, string> = {
  kaspi:   'Kaspi',
  halyk:   'Halyk',
  sber:    'Сбер',
  generic: 'Безналичный',
}

const PRODUCT_LABELS: Record<CashlessProductCode, string> = {
  pos:    'POS',
  online: 'Online',
  qr:     'QR',
  gold:   'Gold',
  red:    'Red',
  kredit: 'Kredit',
}

/** Дефолт когда ничего не известно — generic безнал */
const FALLBACK = 'Безналичный'

export function getProviderName(provider: PaymentProviderInfo | null | undefined): string {
  if (!provider) return FALLBACK
  if (provider.name && provider.code !== 'generic') return provider.name
  if (provider.code && PROVIDER_DISPLAY[provider.code]) return PROVIDER_DISPLAY[provider.code]
  return FALLBACK
}

/**
 * Получить лейбл вида "Kaspi POS" / "Безналичный POS" / "Kaspi" / "Безналичный".
 */
export function getCashlessLabel(
  provider: PaymentProviderInfo | null | undefined,
  product?: CashlessProductCode | null,
): string {
  const providerName = getProviderName(provider)
  if (!product) return providerName

  const productLabel = PRODUCT_LABELS[product] || product

  // Generic + QR → "QR-оплата" (без префикса, иначе звучит коряво)
  if ((!provider || provider.code === 'generic') && product === 'qr') {
    return 'QR-оплата'
  }

  return `${providerName} ${productLabel}`
}

/**
 * Сокращённая версия для узких мест UI (например, badge в чеке).
 *  - getCashlessShort('kaspi')       → "Kaspi"
 *  - getCashlessShort('generic')     → "Безнал"
 */
export function getCashlessShort(provider: PaymentProviderInfo | null | undefined): string {
  if (!provider || provider.code === 'generic' || !provider.code) return 'Безнал'
  return PROVIDER_DISPLAY[provider.code] || provider.name || 'Безнал'
}

/** Провайдер поддерживает разделение по 00:00? (только Kaspi) */
export function supportsMidnightSplit(provider: PaymentProviderInfo | null | undefined): boolean {
  return provider?.code === 'kaspi'
}
