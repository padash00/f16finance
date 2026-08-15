/**
 * Погода как контекст потока.
 *
 * Главное ограничение модуля записано здесь: погода влияет на ожидаемый поток
 * и на объяснение смены, но НЕ на бонусные пороги. Продавец не должен получать
 * меньше денег за дождь — он на дождь не влияет. Тумблер, позволяющий двигать
 * пороги погодой, в настройках есть, но по умолчанию выключен.
 *
 * Второе ограничение: погода берётся в окне смены, а не за сутки. Дневной
 * максимум +33 не имеет отношения к кассиру, который вышел в 21:00. Пока
 * почасового ряда нет, используются суточные значения — но это осознанное
 * огрубление, а не норма.
 *
 * Третье ограничение: коэффициент погоды не выдумывается. Пока по конкретному
 * типу погоды нет достаточной собственной истории, он равен 1.00. Утверждение
 * «в дождь продают хуже» звучит убедительно, но проверяется только данными
 * конкретной точки — у магазина внутри клуба дождь вполне может работать в плюс.
 */

import { median } from './baseline'
import type { StoreKpiSettings } from './settings'
import type { ShiftFact, ShiftType } from './types'

export type WeatherObservation = {
  day: string
  temperature_max: number | null
  temperature_min: number | null
  precipitation_mm: number | null
  snow: boolean | null
  rain: boolean | null
}

/** Погодные корзины. Намеренно грубые: тонкие деления нечем наполнить. */
export type WeatherBucket = 'snow' | 'rain' | 'hot' | 'cold' | 'normal'

export const WEATHER_BUCKET_LABELS: Record<WeatherBucket, string> = {
  snow: 'Снег',
  rain: 'Дождь',
  hot: 'Жара',
  cold: 'Мороз',
  normal: 'Обычная погода',
}

const HOT_FROM = 30
const COLD_TO = -10
const WET_FROM_MM = 1

export function weatherBucket(observation: WeatherObservation | null | undefined): WeatherBucket {
  if (!observation) return 'normal'
  if (observation.snow) return 'snow'
  if (observation.rain || (observation.precipitation_mm ?? 0) >= WET_FROM_MM) return 'rain'
  if ((observation.temperature_max ?? 0) >= HOT_FROM) return 'hot'
  if ((observation.temperature_max ?? 0) <= COLD_TO) return 'cold'
  return 'normal'
}

export type WeatherEffect = {
  bucket: WeatherBucket
  /** Медиана отношения факт/ожидание в такую погоду. */
  ratio: number
  sample: number
  /** Хватает ли наблюдений, чтобы этим пользоваться. */
  usable: boolean
}

/**
 * Оценивает влияние погоды по собственной истории точки.
 *
 * На вход идут пары «факт и ожидание» — то есть сезонность и день недели уже
 * сняты. Иначе «в снег хуже» оказалось бы просто «зимой хуже».
 *
 * Погоду к наблюдению привязывает вызывающий код: он знает, дневная это смена
 * или ночная, и берёт погоду её окна. Раньше здесь стояла карта «дата →
 * погода», и обе смены одного дня получали одну и ту же — ночная попадала под
 * дневную жару, которой не видела.
 */
export function estimateWeatherEffects(
  observations: { actual: number; expected: number; weather: WeatherObservation | null }[],
  settings: StoreKpiSettings,
): Record<WeatherBucket, WeatherEffect> {
  const ratios = new Map<WeatherBucket, number[]>()

  for (const o of observations) {
    if (!(o.expected > 0)) continue
    const bucket = weatherBucket(o.weather)
    const list = ratios.get(bucket) || []
    list.push(o.actual / o.expected)
    ratios.set(bucket, list)
  }

  const out = {} as Record<WeatherBucket, WeatherEffect>
  for (const bucket of Object.keys(WEATHER_BUCKET_LABELS) as WeatherBucket[]) {
    const list = ratios.get(bucket) || []
    const value = median(list)
    out[bucket] = {
      bucket,
      ratio: value != null ? Math.round(value * 1000) / 1000 : 1,
      sample: list.length,
      usable: list.length >= settings.min_sample_size && value != null,
    }
  }
  return out
}

/**
 * Множитель ожидаемой выручки для конкретного дня.
 *
 * Возвращает 1.00, пока наблюдений мало: лучше не поправлять прогноз вовсе,
 * чем поправлять его выдуманным числом.
 */
export function weatherFactor(
  observation: WeatherObservation | null | undefined,
  effects: Record<WeatherBucket, WeatherEffect>,
): { factor: number; bucket: WeatherBucket; usable: boolean; sample: number } {
  const bucket = weatherBucket(observation)
  const effect = effects[bucket]
  if (!effect || !effect.usable) return { factor: 1, bucket, usable: false, sample: effect?.sample ?? 0 }
  return { factor: effect.ratio, bucket, usable: true, sample: effect.sample }
}


// ─── Погода в окне смены ────────────────────────────────────────────────────

/** Почасовой ряд суток: 24 значения, индекс — локальный час. */
export type HourlySeries = {
  t: (number | null)[]
  a: (number | null)[]
  p: (number | null)[]
  s: (number | null)[]
  w: (number | null)[]
  c: (number | null)[]
}

/**
 * Окно смены, когда точное время открытия неизвестно.
 *
 * Это запасной вариант: у закрытых смен есть фактические `opened_at` и
 * `closed_at`, и они точнее. Значения нужны для планов на будущие дни —
 * смена ещё не открыта, а погоду для неё уже надо знать.
 */
const DEFAULT_WINDOWS: Record<ShiftType, { start: number; hours: number }> = {
  day: { start: 9, hours: 12 },
  night: { start: 21, hours: 12 },
}

/** Час суток из отметки времени. Отметка локальная — так её пишет касса. */
function hourOf(stamp: string | null | undefined): number | null {
  if (!stamp) return null
  const hour = Number(String(stamp).slice(11, 13))
  return Number.isFinite(hour) && hour >= 0 && hour <= 23 ? hour : null
}

export function shiftWindow(fact: {
  shift: ShiftType
  opened_at?: string | null
  closed_at?: string | null
  duration_minutes?: number | null
}): { start: number; hours: number } {
  const start = hourOf(fact.opened_at)
  if (start == null) return DEFAULT_WINDOWS[fact.shift] || DEFAULT_WINDOWS.day

  // Длительность берём фактическую, если она есть: смена на шесть часов и
  // смена на двенадцать видели разную погоду.
  const minutes = Number(fact.duration_minutes)
  if (Number.isFinite(minutes) && minutes > 0) {
    return { start, hours: Math.max(1, Math.min(24, Math.ceil(minutes / 60))) }
  }

  const end = hourOf(fact.closed_at)
  if (end == null) return { start, hours: DEFAULT_WINDOWS[fact.shift]?.hours ?? 12 }

  // Ночная смена заканчивается на следующие сутки — отсюда «+24».
  const span = end > start ? end - start : end + 24 - start
  return { start, hours: Math.max(1, Math.min(24, span || 12)) }
}

/**
 * Собирает погоду смены из почасового ряда.
 *
 * Окно может переходить на следующие сутки, поэтому ряд берётся по датам из
 * карты, а не из одного массива. Если ряда нет — возвращается null, и
 * вызывающий код честно откатывается к суточным значениям.
 */
export function observationForWindow(
  day: string,
  window: { start: number; hours: number },
  hourlyByDay: Map<string, HourlySeries>,
): WeatherObservation | null {
  const temps: number[] = []
  let precipitation = 0
  let snowfall = 0
  let codeSnow = false
  let codeRain = false
  let known = false

  for (let i = 0; i < window.hours; i++) {
    const absolute = window.start + i
    const dayOffset = Math.floor(absolute / 24)
    const hour = absolute % 24
    const series = hourlyByDay.get(dayOffset === 0 ? day : addDays(day, dayOffset))
    if (!series) continue

    const t = series.t?.[hour]
    if (t != null) {
      temps.push(t)
      known = true
    }
    const p = series.p?.[hour]
    if (p != null) {
      precipitation += p
      known = true
    }
    const sn = series.s?.[hour]
    if (sn != null) snowfall += sn
    const code = series.c?.[hour]
    if (code != null) {
      if (SNOW_CODES.has(code)) codeSnow = true
      if (RAIN_CODES.has(code)) codeRain = true
    }
  }

  if (!known) return null

  return {
    day,
    temperature_max: temps.length > 0 ? Math.max(...temps) : null,
    temperature_min: temps.length > 0 ? Math.min(...temps) : null,
    precipitation_mm: Math.round(precipitation * 100) / 100,
    snow: snowfall > 0 || codeSnow,
    rain: (precipitation > 0 || codeRain) && !(snowfall > 0 || codeSnow),
  }
}

/** Коды осадков WMO — те же, что у загрузчика, но домен от него не зависит. */
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])

function addDays(day: string, count: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + count)
  return date.toISOString().slice(0, 10)
}

/**
 * Погода конкретной смены: сперва по её окну, иначе за сутки целиком.
 *
 * Возврат к суточным значениям — не молчаливая подмена: у смен без почасового
 * ряда погода грубее, и это видно по тому, что окно не применялось.
 */
export function weatherForShift(
  fact: Pick<ShiftFact, 'date' | 'shift'> & {
    opened_at?: string | null
    closed_at?: string | null
    duration_minutes?: number | null
  },
  hourlyByDay: Map<string, HourlySeries>,
  dailyByDay: Map<string, WeatherObservation>,
): { observation: WeatherObservation | null; windowed: boolean } {
  const windowed = observationForWindow(fact.date, shiftWindow(fact), hourlyByDay)
  if (windowed) return { observation: windowed, windowed: true }
  return { observation: dailyByDay.get(fact.date) ?? null, windowed: false }
}
