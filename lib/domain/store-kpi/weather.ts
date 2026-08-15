/**
 * Погода как контекст потока.
 *
 * Главное ограничение модуля записано здесь: погода влияет на ожидаемый поток
 * и на объяснение смены, но НЕ на бонусные пороги. Продавец не должен получать
 * меньше денег за дождь — он на дождь не влияет. Тумблер, позволяющий двигать
 * пороги погодой, в настройках есть, но по умолчанию выключен.
 *
 * Второе ограничение: коэффициент погоды не выдумывается. Пока по конкретному
 * типу погоды нет достаточной собственной истории, он равен 1.00. Утверждение
 * «в дождь продают хуже» звучит убедительно, но проверяется только данными
 * конкретной точки — у магазина внутри клуба дождь вполне может работать в плюс.
 */

import { median } from './baseline'
import type { StoreKpiSettings } from './settings'

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
 */
export function estimateWeatherEffects(
  observations: { date: string; actual: number; expected: number }[],
  weatherByDate: Map<string, WeatherObservation>,
  settings: StoreKpiSettings,
): Record<WeatherBucket, WeatherEffect> {
  const ratios = new Map<WeatherBucket, number[]>()

  for (const o of observations) {
    if (!(o.expected > 0)) continue
    const bucket = weatherBucket(weatherByDate.get(o.date))
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
