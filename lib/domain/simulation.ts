/**
 * Потенциал выручки клуба: сколько зоны могли бы принести при заданной
 * загрузке, и насколько факт от этого отстаёт.
 *
 * Формула жила только в компоненте страницы `/simulation`. Пока её читал один
 * экран, это было терпимо; повторять её на Swift означало бы вторую версию
 * «потенциала» и «обратного расчёта загрузки» — владелец увидел бы в телефоне
 * другой разрыв, чем на сайте, и не понял бы, какой настоящий.
 *
 * Здесь — чистая функция без обращений к БД: её зовут и страница (живой
 * пересчёт при правке полей), и роут (для сохранённой конфигурации).
 *
 * Цепочка величин:
 *
 *   ставка тарифа       = цена ÷ (оплаченные + бонусные часы)
 *   ставка зоны         = Σ доля_тарифа × ставка_тарифа
 *   на 1 устройство/сут = загрузка_часов × ставка_зоны
 *   потенциал зоны/сут  = устройств × на 1 устройство/сут
 *   обратный расчёт     = факт/сут ÷ выручка_за_час_полной_загрузки
 */

/** Месяц в модели — ровно 30 дней: тарифы и загрузка задаются посуточно. */
export const SIMULATION_MONTH_DAYS = 30

export type SimulationTariffInput = {
  id: string
  name?: string | null
  paid_hours?: number | string | null
  bonus_hours?: number | string | null
  price?: number | string | null
}

export type SimulationZoneMixInput = {
  tariff_id: string
  share_pct?: number | string | null
}

export type SimulationZoneInput = {
  id?: string | null
  name?: string | null
  device_type?: string | null
  device_count?: number | string | null
  assumed_occupancy_hours?: number | string | null
  tariff_mix?: SimulationZoneMixInput[] | null
}

/** Факт из журнала доходов — то, с чем сравнивается потенциал. */
export type SimulationFactInput = {
  revenue_per_day?: number | null
  revenue_per_month?: number | null
} | null

export type SimulationZoneProjection = {
  zone_id: string | null
  name: string
  device_type: string
  device_count: number
  occupancy_hours: number
  /** Средневзвешенная ставка ₸/час по миксу тарифов зоны. */
  blended_rate: number
  /** Сумма долей микса: заметно отличается от 100 — конфиг заполнен небрежно. */
  share_sum: number
  per_device_per_day: number
  potential_per_day: number
  potential_per_month: number
}

export type SimulationTariffProjection = {
  tariff_id: string
  name: string
  paid_hours: number
  bonus_hours: number
  price: number
  rate_per_hour: number
}

export type SimulationProjection = {
  zones: SimulationZoneProjection[]
  /** Тарифы с посчитанной ставкой — чтобы читающим клиентам не делить самим. */
  tariffs: SimulationTariffProjection[]
  total_devices: number
  /** Выручка за один час полной загрузки клуба. */
  capacity_rate_per_hour: number
  potential_per_day: number
  potential_per_month: number
  fact_per_day: number
  fact_per_month: number
  /** Потенциал минус факт: сколько недозарабатывает клуб за месяц. */
  gap_per_month: number
  /** Какая загрузка нужна, чтобы выйти на текущую выручку. */
  implied_occupancy_hours: number | null
  /** Какая загрузка заложена в конфиге, взвешенно по устройствам. */
  assumed_occupancy_hours: number | null
  /** Насколько факт расходится с заложенным. */
  occupancy_gap_hours: number | null
}

/** Отрицательных устройств, часов и цен не бывает — такой ввод считаем нулём. */
function num(value: unknown): number {
  const parsed = Number(String(value ?? 0).replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

/**
 * ₸ за час сидения по тарифу.
 *
 * Бонусные часы входят в знаменатель: пакет «2+1 за 600» стоит 200 ₸/час, а не
 * 300 — иначе потенциал завышался бы ровно на подаренное время.
 */
export function tariffRatePerHour(tariff: SimulationTariffInput): number {
  const hours = num(tariff.paid_hours) + num(tariff.bonus_hours)
  return hours > 0 ? num(tariff.price) / hours : 0
}

/**
 * Считает потенциал по зонам и сравнивает его с фактической выручкой.
 *
 * @param zones    зоны с количеством устройств, загрузкой и миксом тарифов
 * @param tariffs  тарифы точки
 * @param fact     фактическая выручка точки (сутки и месяц), если известна
 */
export function computeSimulationProjection(
  zones: SimulationZoneInput[],
  tariffs: SimulationTariffInput[],
  fact: SimulationFactInput = null,
): SimulationProjection {
  const rateById = new Map<string, number>()
  const tariffRows: SimulationTariffProjection[] = []
  for (const tariff of tariffs || []) {
    const id = String(tariff?.id || '')
    if (!id) continue
    const rate = tariffRatePerHour(tariff)
    rateById.set(id, rate)
    tariffRows.push({
      tariff_id: id,
      name: String(tariff.name || '').trim() || 'Тариф',
      paid_hours: num(tariff.paid_hours),
      bonus_hours: num(tariff.bonus_hours),
      price: num(tariff.price),
      rate_per_hour: rate,
    })
  }

  const projected: SimulationZoneProjection[] = (zones || []).map((zone) => {
    let blendedRate = 0
    let shareSum = 0
    for (const mix of zone?.tariff_mix || []) {
      // Тариф могли удалить, а долю в зоне забыть: несуществующий тариф не
      // приносит ставки, но и не считается заполненной долей.
      const rate = rateById.get(String(mix?.tariff_id || ''))
      if (rate === undefined) continue
      const share = num(mix?.share_pct)
      blendedRate += (share / 100) * rate
      shareSum += share
    }

    const deviceCount = num(zone?.device_count)
    const occupancyHours = num(zone?.assumed_occupancy_hours)
    const perDevicePerDay = occupancyHours * blendedRate
    const potentialPerDay = deviceCount * perDevicePerDay

    return {
      zone_id: zone?.id ? String(zone.id) : null,
      name: String(zone?.name || '').trim() || 'Зона',
      device_type: String(zone?.device_type || 'pc'),
      device_count: deviceCount,
      occupancy_hours: occupancyHours,
      blended_rate: blendedRate,
      share_sum: shareSum,
      per_device_per_day: perDevicePerDay,
      potential_per_day: potentialPerDay,
      potential_per_month: potentialPerDay * SIMULATION_MONTH_DAYS,
    }
  })

  const potentialPerDay = projected.reduce((sum, zone) => sum + zone.potential_per_day, 0)
  const totalDevices = projected.reduce((sum, zone) => sum + zone.device_count, 0)
  const capacityRatePerHour = projected.reduce(
    (sum, zone) => sum + zone.device_count * zone.blended_rate,
    0,
  )

  const factPerDay = num(fact?.revenue_per_day)
  const factPerMonth =
    fact?.revenue_per_month != null ? num(fact.revenue_per_month) : factPerDay * SIMULATION_MONTH_DAYS

  // Без тарифов и устройств делить не на что: «загрузка 0 часов» соврала бы,
  // будто клуб простаивает, хотя на самом деле не заполнен конфиг.
  const impliedOccupancy = capacityRatePerHour > 0 ? factPerDay / capacityRatePerHour : null
  const assumedOccupancy =
    totalDevices > 0
      ? projected.reduce((sum, zone) => sum + zone.device_count * zone.occupancy_hours, 0) / totalDevices
      : null

  return {
    zones: projected,
    tariffs: tariffRows,
    total_devices: totalDevices,
    capacity_rate_per_hour: capacityRatePerHour,
    potential_per_day: potentialPerDay,
    potential_per_month: potentialPerDay * SIMULATION_MONTH_DAYS,
    fact_per_day: factPerDay,
    fact_per_month: factPerMonth,
    gap_per_month: potentialPerDay * SIMULATION_MONTH_DAYS - factPerMonth,
    implied_occupancy_hours: impliedOccupancy,
    assumed_occupancy_hours: assumedOccupancy,
    occupancy_gap_hours:
      impliedOccupancy != null && assumedOccupancy != null && assumedOccupancy > 0
        ? impliedOccupancy - assumedOccupancy
        : null,
  }
}
