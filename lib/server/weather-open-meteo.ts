/**
 * Погода из Open-Meteo.
 *
 * Источник выбран за то, что не требует ключа и отдаёт и прогноз, и факт одним
 * запросом. Ключевое для модуля — различать эти две вещи и никогда их не
 * путать: прогноз сохраняется снимком на дату, когда он был получен, факт —
 * отдельно. Иначе после смены мы бы смотрели на фактическую погоду и делали
 * вид, что знали её заранее.
 */

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
const ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'

/** Поля, которые модуль умеет читать. Один список на прогноз и на архив. */
const DAILY_FIELDS = [
  'temperature_2m_max',
  'temperature_2m_min',
  'temperature_2m_mean',
  'apparent_temperature_max',
  'precipitation_sum',
  'snowfall_sum',
  'windspeed_10m_max',
  'weathercode',
]

/** Коды осадков Open-Meteo (WMO): дождь и снег по группам. */
/** Почасовые поля. Индекс в массиве = локальный час суток. */
const HOURLY_FIELDS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'snowfall',
  'wind_speed_10m',
  'weather_code',
]

const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])

/**
 * Почасовой ряд на сутки. Ключи короткие: строка лежит в jsonb, и на годе
 * истории разница между `temperature_2m` и `t` — это мегабайты.
 */
export type HourlySeries = {
  t: (number | null)[]
  a: (number | null)[]
  p: (number | null)[]
  s: (number | null)[]
  w: (number | null)[]
  c: (number | null)[]
}

export type WeatherDay = {
  day: string
  kind: 'forecast' | 'actual'
  temperature_max: number | null
  temperature_min: number | null
  temperature_mean: number | null
  apparent_temperature_max: number | null
  precipitation_mm: number | null
  precipitation_probability: number | null
  rain: boolean
  snow: boolean
  wind_speed: number | null
  weather_code: number | null
  payload: Record<string, unknown>
  /** null, если источник почасовые данные не отдал. */
  hourly: HourlySeries | null
}

function pick(list: unknown, index: number): number | null {
  if (!Array.isArray(list)) return null
  const value = Number(list[index])
  return Number.isFinite(value) ? value : null
}

/**
 * Раскладывает плоский почасовой ответ по суткам.
 *
 * Open-Meteo отдаёт один длинный ряд с метками вида `2026-07-12T14:00`. Здесь
 * он режется по датам, а час берётся из самой метки — не по порядку в
 * массиве. Порядок ломается на переходе на летнее время, а метка нет.
 */
function groupHourly(hourly: any): Map<string, HourlySeries> {
  const out = new Map<string, HourlySeries>()
  const times: unknown[] = Array.isArray(hourly?.time) ? hourly.time : []

  for (let i = 0; i < times.length; i++) {
    const stamp = String(times[i])
    const day = stamp.slice(0, 10)
    const hour = Number(stamp.slice(11, 13))
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue

    let series = out.get(day)
    if (!series) {
      const empty = () => Array<number | null>(24).fill(null)
      series = { t: empty(), a: empty(), p: empty(), s: empty(), w: empty(), c: empty() }
      out.set(day, series)
    }

    series.t[hour] = pick(hourly.temperature_2m, i)
    series.a[hour] = pick(hourly.apparent_temperature, i)
    series.p[hour] = pick(hourly.precipitation, i)
    series.s[hour] = pick(hourly.snowfall, i)
    series.w[hour] = pick(hourly.wind_speed_10m, i)
    series.c[hour] = pick(hourly.weather_code, i)
  }

  return out
}

/**
 * Тянет прогноз вперёд и факт за прошедшие дни.
 *
 * `pastDays` — сколько прошедших дней запросить как факт. Дороже одного
 * запроса это не стоит, а дырки в фактах ломают оценку качества прогноза.
 */
export async function fetchOpenMeteo(args: {
  latitude: number
  longitude: number
  forecastDays?: number
  pastDays?: number
  signal?: AbortSignal
}): Promise<WeatherDay[]> {
  const params = new URLSearchParams({
    latitude: String(args.latitude),
    longitude: String(args.longitude),
    daily: [...DAILY_FIELDS, 'precipitation_probability_max'].join(','),
    hourly: HOURLY_FIELDS.join(','),
    timezone: 'auto',
    forecast_days: String(args.forecastDays ?? 16),
    past_days: String(args.pastDays ?? 7),
  })

  const response = await fetch(`${FORECAST_URL}?${params.toString()}`, { signal: args.signal })
  if (!response.ok) {
    throw new Error(`Open-Meteo ответил ${response.status}`)
  }

  const payload = (await response.json()) as any
  const daily = payload?.daily
  const days: unknown[] = Array.isArray(daily?.time) ? daily.time : []
  if (days.length === 0) throw new Error('Open-Meteo вернул пустой ответ')
  const hourlyByDay = groupHourly(payload?.hourly)

  // Сегодняшний день считаем ещё прогнозом: он не закончился, и «фактом» его
  // объявлять рано.
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  return days.map((rawDay, i) => {
    const day = String(rawDay)
    const code = pick(daily.weathercode, i)
    const snowfall = pick(daily.snowfall_sum, i) ?? 0
    const precipitation = pick(daily.precipitation_sum, i)

    return {
      day,
      kind: day < todayIso ? 'actual' : 'forecast',
      temperature_max: pick(daily.temperature_2m_max, i),
      temperature_min: pick(daily.temperature_2m_min, i),
      temperature_mean: pick(daily.temperature_2m_mean, i),
      apparent_temperature_max: pick(daily.apparent_temperature_max, i),
      precipitation_mm: precipitation,
      precipitation_probability: pick(daily.precipitation_probability_max, i),
      snow: snowfall > 0 || (code != null && SNOW_CODES.has(code)),
      rain: (precipitation ?? 0) > 0 || (code != null && RAIN_CODES.has(code)),
      wind_speed: pick(daily.windspeed_10m_max, i),
      weather_code: code,
      payload: {
        temperature_2m_max: pick(daily.temperature_2m_max, i),
        precipitation_sum: precipitation,
        snowfall_sum: snowfall,
        weathercode: code,
      },
      hourly: hourlyByDay.get(day) ?? null,
    }
  })
}

/**
 * Факт погоды за прошлое — из архива Open-Meteo.
 *
 * Зачем отдельно от прогноза: обычный ежедневный крон умеет заглянуть назад
 * лишь на несколько дней, и влияние погоды набиралось бы месяцами. Архив
 * закрывает историю целиком за один запрос, и коэффициенты появляются сразу.
 *
 * Всё, что приходит отсюда, — только `actual`. Выдавать архив за прогноз
 * нельзя: тогда оценка точности считалась бы по погоде, которая стала
 * известна уже после смены, и модуль выглядел бы точнее, чем есть.
 *
 * Архив отстаёт от сегодняшнего дня на несколько суток — последние дни
 * добирает обычный крон.
 */
export async function fetchOpenMeteoArchive(args: {
  latitude: number
  longitude: number
  from: string
  to: string
  signal?: AbortSignal
}): Promise<WeatherDay[]> {
  const params = new URLSearchParams({
    latitude: String(args.latitude),
    longitude: String(args.longitude),
    start_date: args.from,
    end_date: args.to,
    daily: DAILY_FIELDS.join(','),
    hourly: HOURLY_FIELDS.join(','),
    timezone: 'auto',
  })

  const response = await fetch(`${ARCHIVE_URL}?${params.toString()}`, { signal: args.signal })
  if (!response.ok) {
    throw new Error(`Архив Open-Meteo ответил ${response.status}`)
  }

  const payload = (await response.json()) as any
  const daily = payload?.daily
  const days: unknown[] = Array.isArray(daily?.time) ? daily.time : []
  const hourlyByDay = groupHourly(payload?.hourly)

  return days
    .map((rawDay, i) => {
      const day = String(rawDay)
      const code = pick(daily.weathercode, i)
      const snowfall = pick(daily.snowfall_sum, i) ?? 0
      const precipitation = pick(daily.precipitation_sum, i)

      return {
        day,
        kind: 'actual' as const,
        temperature_max: pick(daily.temperature_2m_max, i),
        temperature_min: pick(daily.temperature_2m_min, i),
        temperature_mean: pick(daily.temperature_2m_mean, i),
        apparent_temperature_max: pick(daily.apparent_temperature_max, i),
        precipitation_mm: precipitation,
        // Вероятность осадков у факта смысла не имеет: он уже случился.
        precipitation_probability: null,
        snow: snowfall > 0 || (code != null && SNOW_CODES.has(code)),
        rain: (precipitation ?? 0) > 0 || (code != null && RAIN_CODES.has(code)),
        wind_speed: pick(daily.windspeed_10m_max, i),
        weather_code: code,
        payload: {
          temperature_2m_max: pick(daily.temperature_2m_max, i),
          precipitation_sum: precipitation,
          snowfall_sum: snowfall,
          weathercode: code,
          source: 'archive',
        },
        hourly: hourlyByDay.get(day) ?? null,
      }
    })
    // Дни, по которым архив ничего не знает, пропускаем: пустая строка в базе
    // выглядела бы как «погоды не было».
    .filter((d) => d.temperature_max != null || d.precipitation_mm != null)
}
