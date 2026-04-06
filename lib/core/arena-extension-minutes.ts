/**
 * Продление по сумме.
 * extensionHourlyPrice — обычно ставка зоны (₸/60 мин); иначе устар. поле тарифа.
 * Если задано (>0): сумма меньше цены пакета — по часу; сумма ≥ пакета — целые пакеты + остаток по часу.
 * Иначе: пропорция к пакету (цена / длительность).
 */

export type ExtensionMinutesResult =
  | { ok: true; minutes: number }
  | { ok: false; code: 'invalid-tariff-rate' | 'invalid-payment' | 'extension-amount-too-small' }

export function arenaExtensionMinutesFromPayment(
  tariffPrice: number,
  durationMinutes: number,
  paidTotal: number,
  extensionHourlyPrice?: number | null,
): ExtensionMinutesResult {
  const price = Number(tariffPrice)
  const dur = Number(durationMinutes)
  const paid = Math.round(Number(paidTotal))
  const hourlyRaw = extensionHourlyPrice != null ? Number(extensionHourlyPrice) : NaN
  const hasHourly = Number.isFinite(hourlyRaw) && hourlyRaw > 0

  if (!Number.isFinite(price) || !Number.isFinite(dur) || price <= 0 || dur <= 0) {
    return { ok: false, code: 'invalid-tariff-rate' }
  }
  if (!Number.isFinite(paid) || paid < 1) {
    return { ok: false, code: 'invalid-payment' }
  }

  let minutes: number
  if (hasHourly) {
    const h = hourlyRaw
    if (paid < price) {
      minutes = Math.round((paid / h) * 60)
    } else {
      const full = Math.floor(paid / price)
      const rem = paid - full * price
      minutes = full * dur + (rem > 0 ? Math.round((rem / h) * 60) : 0)
    }
  } else {
    const perMinute = price / dur
    minutes = Math.round(paid / perMinute)
  }

  if (minutes < 1) {
    return { ok: false, code: 'extension-amount-too-small' }
  }
  return { ok: true, minutes }
}
