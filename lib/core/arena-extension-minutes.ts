/**
 * Продление по сумме: минуты из ставки пакета (цена / длительность).
 * Например тариф 600₸ / 60 мин → 200₸ ≈ 20 мин.
 */

export type ExtensionMinutesResult =
  | { ok: true; minutes: number }
  | { ok: false; code: 'invalid-tariff-rate' | 'invalid-payment' | 'extension-amount-too-small' }

export function arenaExtensionMinutesFromPayment(
  tariffPrice: number,
  durationMinutes: number,
  paidTotal: number,
): ExtensionMinutesResult {
  const price = Number(tariffPrice)
  const dur = Number(durationMinutes)
  const paid = Math.round(Number(paidTotal))
  if (!Number.isFinite(price) || !Number.isFinite(dur) || price <= 0 || dur <= 0) {
    return { ok: false, code: 'invalid-tariff-rate' }
  }
  if (!Number.isFinite(paid) || paid < 1) {
    return { ok: false, code: 'invalid-payment' }
  }
  const perMinute = price / dur
  const minutes = Math.round(paid / perMinute)
  if (minutes < 1) {
    return { ok: false, code: 'extension-amount-too-small' }
  }
  return { ok: true, minutes }
}
