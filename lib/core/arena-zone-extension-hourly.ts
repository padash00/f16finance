/**
 * База ₸/60 мин для продления по сумме: явное поле зоны или авто из тарифа «ровно 1 час».
 */

export type TariffLikeForHourly = {
  zone_id?: string | null
  duration_minutes?: unknown
  price?: unknown
  tariff_type?: string | null
}

/** Фиксированные тарифы ровно на 60 мин в зоне (без пакетов по окну) — минимальная цена как «стандартный час». */
export function inferZoneExtensionHourlyFromTariffs(zoneId: string, tariffs: TariffLikeForHourly[]): number | null {
  const zid = String(zoneId)
  const prices: number[] = []
  for (const t of tariffs) {
    if (String(t.zone_id ?? '') !== zid) continue
    if (t.tariff_type === 'time_window') continue
    const dur = Number(t.duration_minutes)
    const pr = Number(t.price)
    if (dur !== 60 || !(pr > 0) || !Number.isFinite(pr)) continue
    prices.push(pr)
  }
  if (prices.length === 0) return null
  return Math.min(...prices)
}

export function effectiveZoneExtensionHourly(
  zone: { extension_hourly_price?: unknown } | null | undefined,
  zoneId: string | null | undefined,
  allTariffsInProject: TariffLikeForHourly[],
): number | null {
  const raw = zone?.extension_hourly_price
  const explicit = raw != null && raw !== '' ? Number(raw) : NaN
  if (Number.isFinite(explicit) && explicit > 0) return explicit
  if (!zoneId) return null
  return inferZoneExtensionHourlyFromTariffs(String(zoneId), allTariffsInProject)
}
