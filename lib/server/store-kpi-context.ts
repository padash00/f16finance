/**
 * Контекст смены: погода, праздники, учебный период.
 *
 * Всё это уже собиралось и хранилось — погода кроном и догрузкой архива,
 * праздники и учебные периоды импортом справочников. Но в разборе смены не
 * показывалось ни слова: владелец видел «касса ниже нормы», и не мог узнать,
 * что в этот день были каникулы, шёл снег и город отдыхал третий день подряд.
 *
 * Отсюда правило этого модуля: контекст ОБЪЯСНЯЕТ смену, но не оправдывает
 * продавца автоматически и не двигает его баллы. Он отвечает на вопрос
 * «почему покупателей было столько», а не «хорошо ли работал человек».
 */

import {
  shiftWindow,
  weatherBucket,
  weatherForShift,
  WEATHER_BUCKET_LABELS,
  type HourlySeries,
  type ShiftFact,
  type WeatherObservation,
} from '@/lib/domain/store-kpi'

type AnyClient = any

export type WeatherSources = {
  daily: Map<string, WeatherObservation>
  hourly: Map<string, HourlySeries>
}

export type CalendarDayRow = {
  day: string
  day_type: string
  name: string
  impact_index: number
  verified: boolean
}

export type AcademicPeriodRow = {
  start_date: string
  end_date: string
  period_type: string
  name: string
  manual_index: number | null
  audience: string | null
  is_confirmed: boolean
}

export type ContextSources = {
  weather: WeatherSources
  days: CalendarDayRow[]
  periods: AcademicPeriodRow[]
}

/** Человеческие названия типов особых дней. Совпадают с календарём модуля. */
const DAY_TYPE_LABELS: Record<string, string> = {
  PUBLIC_HOLIDAY: 'Государственный праздник',
  TRANSFERRED_DAY_OFF: 'Перенос выходного',
  WORKING_WEEKEND: 'Рабочая суббота',
  LONG_WEEKEND: 'Длинные выходные',
  RELIGIOUS_HOLIDAY: 'Религиозный праздник',
  LOCAL_EVENT: 'Событие в городе',
  INTERNAL_EVENT: 'Своё мероприятие',
  CLOSURE: 'Точка не работала',
  CUSTOM: 'Особый день',
}

const PERIOD_TYPE_LABELS: Record<string, string> = {
  SEMESTER: 'Семестр',
  VACATION: 'Каникулы',
  SUMMER_BREAK: 'Летние каникулы',
  EXAMS: 'Сессия',
  ADMISSION: 'Приёмная кампания',
  START_OF_YEAR: 'Начало учебного года',
  END_OF_YEAR: 'Конец учебного года',
  CUSTOM: 'Учебный период',
}

const AUDIENCE_LABELS: Record<string, string> = {
  schoolchildren: 'школьники',
  students: 'студенты',
  applicants: 'абитуриенты',
  all: 'все',
}

/**
 * Погода точки за период.
 *
 * Для прошедших дней берётся факт, для будущих — самый свежий прогноз.
 * Прогнозы хранятся снимками, поэтому «самый свежий» выбирается по
 * `captured_on`, а не перезаписью: иначе мы потеряли бы возможность честно
 * оценить, что знали заранее.
 */
export async function loadWeatherSources(
  supabase: AnyClient,
  companyId: string,
  from: string,
  to: string,
): Promise<WeatherSources> {
  const daily = new Map<string, WeatherObservation>()
  const hourly = new Map<string, HourlySeries>()

  const { data, error } = await supabase
    .from('store_kpi_weather')
    .select(
      'day, kind, captured_on, temperature_max, temperature_min, precipitation_mm, rain, snow, hourly',
    )
    .eq('company_id', companyId)
    .gte('day', from)
    .lte('day', to)
    .order('captured_on', { ascending: true })
  if (error) throw error

  const best = new Map<string, any>()
  for (const row of data || []) {
    const current = best.get(row.day)
    // Факт всегда важнее прогноза; среди прогнозов — самый поздний снимок.
    const better =
      !current ||
      (row.kind === 'actual' && current.kind !== 'actual') ||
      (row.kind === current.kind && row.captured_on >= current.captured_on)
    if (better) best.set(row.day, row)
  }

  for (const [day, row] of best) {
    daily.set(day, {
      day,
      temperature_max: row.temperature_max == null ? null : Number(row.temperature_max),
      temperature_min: row.temperature_min == null ? null : Number(row.temperature_min),
      precipitation_mm: row.precipitation_mm == null ? null : Number(row.precipitation_mm),
      rain: row.rain,
      snow: row.snow,
    })
    if (row.hourly) hourly.set(day, row.hourly as HourlySeries)
  }

  return { daily, hourly }
}

/** Погода, праздники и учебные периоды точки за период — одним заходом. */
export async function loadContextSources(
  supabase: AnyClient,
  companyId: string,
  organizationId: string | null,
  from: string,
  to: string,
): Promise<ContextSources> {
  const [weather, daysRes, periodsRes] = await Promise.all([
    loadWeatherSources(supabase, companyId, from, to),
    (async () => {
      let query = supabase
        .from('store_kpi_calendar_days')
        .select('day, day_type, name, impact_index, company_id, verified, organization_id')
        .gte('day', from)
        .lte('day', to)
      if (organizationId) query = query.eq('organization_id', organizationId)
      const { data, error } = await query
      if (error) throw error
      return data || []
    })(),
    (async () => {
      let query = supabase
        .from('store_kpi_academic_periods')
        .select(
          'start_date, end_date, period_type, name, manual_index, audience, is_confirmed, company_id, organization_id',
        )
        .lte('start_date', to)
        .gte('end_date', from)
      if (organizationId) query = query.eq('organization_id', organizationId)
      const { data, error } = await query
      if (error) throw error
      return data || []
    })(),
  ])

  // Точке видны и её собственные записи, и общие для организации.
  const mine = (row: any) => !row.company_id || String(row.company_id) === companyId

  return {
    weather,
    days: daysRes.filter(mine).map((d: any) => ({
      day: String(d.day),
      day_type: String(d.day_type),
      name: String(d.name || ''),
      impact_index: Number(d.impact_index) || 1,
      verified: Boolean(d.verified),
    })),
    periods: periodsRes.filter(mine).map((p: any) => ({
      start_date: String(p.start_date),
      end_date: String(p.end_date),
      period_type: String(p.period_type),
      name: String(p.name || ''),
      manual_index: p.manual_index == null ? null : Number(p.manual_index),
      audience: p.audience ?? null,
      is_confirmed: Boolean(p.is_confirmed),
    })),
  }
}

export type ShiftContext = {
  weather: {
    bucket: string
    label: string
    /** true — погода посчитана по окну смены, false — взята за сутки целиком. */
    windowed: boolean
    temperature_max: number | null
    temperature_min: number | null
    precipitation_mm: number | null
    /** Окно, за которое считалась погода: «21:00–09:00». */
    window_label: string
    summary: string
  } | null
  days: { name: string; type_label: string; impact_index: number; verified: boolean }[]
  periods: {
    name: string
    type_label: string
    audience_label: string | null
    index: number | null
    confirmed: boolean
  }[]
}

function two(n: number): string {
  return String(n).padStart(2, '0')
}

/** Погода смены человеческой фразой: без градусов её нечем читать. */
function weatherSummary(observation: WeatherObservation, windowed: boolean): string {
  const parts: string[] = []
  const bucket = weatherBucket(observation)

  if (observation.temperature_max != null && observation.temperature_min != null) {
    const max = Math.round(observation.temperature_max)
    const min = Math.round(observation.temperature_min)
    parts.push(min === max ? `${max}°` : `от ${min}° до ${max}°`)
  }
  if ((observation.precipitation_mm ?? 0) > 0) {
    parts.push(`осадки ${observation.precipitation_mm} мм`)
  }
  if (bucket === 'snow') parts.push('снег')
  else if (bucket === 'rain') parts.push('дождь')
  else if (bucket === 'hot') parts.push('жара')
  else if (bucket === 'cold') parts.push('мороз')

  const tail = windowed ? 'в часы смены' : 'за сутки целиком — почасовых данных на этот день нет'
  return parts.length > 0 ? `${parts.join(', ')} — ${tail}.` : `Погода известна ${tail}.`
}

/**
 * Контекст конкретной смены.
 *
 * Праздник берётся по дате смены, учебный период — по попаданию даты в
 * интервал, погода — по окну смены. Ночная смена, начавшаяся 31 декабря,
 * остаётся сменой 31 декабря: календарь считается по дате открытия, как её
 * видит и сам продавец.
 */
export function contextForShift(fact: ShiftFact, sources: ContextSources): ShiftContext {
  const { observation, windowed } = weatherForShift(fact, sources.weather.hourly, sources.weather.daily)
  const window = shiftWindow(fact)
  const endHour = (window.start + window.hours) % 24

  return {
    weather: observation
      ? {
          bucket: weatherBucket(observation),
          label: WEATHER_BUCKET_LABELS[weatherBucket(observation)],
          windowed,
          temperature_max: observation.temperature_max,
          temperature_min: observation.temperature_min,
          precipitation_mm: observation.precipitation_mm,
          window_label: `${two(window.start)}:00–${two(endHour)}:00`,
          summary: weatherSummary(observation, windowed),
        }
      : null,
    days: sources.days
      .filter((d) => d.day === fact.date)
      .map((d) => ({
        name: d.name,
        type_label: DAY_TYPE_LABELS[d.day_type] || d.day_type,
        impact_index: d.impact_index,
        verified: d.verified,
      })),
    periods: sources.periods
      .filter((p) => p.start_date <= fact.date && fact.date <= p.end_date)
      .map((p) => ({
        name: p.name,
        type_label: PERIOD_TYPE_LABELS[p.period_type] || p.period_type,
        audience_label: p.audience ? AUDIENCE_LABELS[p.audience] || p.audience : null,
        // Неподтверждённый период в расчёт не идёт, поэтому и коэффициент
        // показывать нечестно: он бы выглядел работающим.
        index: p.is_confirmed ? p.manual_index : null,
        confirmed: p.is_confirmed,
      })),
  }
}
