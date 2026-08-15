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

/** Коды осадков Open-Meteo (WMO): дождь и снег по группам. */
const SNOW_CODES = new Set([71, 73, 75, 77, 85, 86])
const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99])

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
}

function pick(list: unknown, index: number): number | null {
  if (!Array.isArray(list)) return null
  const value = Number(list[index])
  return Number.isFinite(value) ? value : null
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
    daily: [
      'temperature_2m_max',
      'temperature_2m_min',
      'temperature_2m_mean',
      'apparent_temperature_max',
      'precipitation_sum',
      'precipitation_probability_max',
      'snowfall_sum',
      'windspeed_10m_max',
      'weathercode',
    ].join(','),
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
    }
  })
}
