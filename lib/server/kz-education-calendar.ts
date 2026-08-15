/**
 * Справочники Казахстана как источник календаря модуля.
 *
 * Два набора данных с разными ролями:
 *
 *   * **Праздники** — нерабочие дни, переносы выходных и периоды непрерывного
 *     отдыха. Даты официальные, влияние на спрос неизвестно и потому
 *     нейтральное: модуль выучит его сам, когда накопится история.
 *   * **Учебный календарь** — семестры, каникулы, приёмные кампании. Здесь
 *     влияние оценил составитель справочника, и это именно оценка, а не
 *     измерение на ваших продажах.
 *
 * Разделение ролей строгое: длинные выходные заводятся только из справочника
 * праздников. В учебном календаре они тоже есть, но оттуда их брать нельзя —
 * один и тот же Новый год попал бы и в «учебный контекст», и в «состав
 * календаря», то есть в две разные части месячного индекса.
 */

import {
  KZ_EDUCATION_CALENDAR,
  KZ_PUBLIC_HOLIDAYS,
  type EducationCalendarEntry,
  type PublicHolidayEvent,
} from '@/lib/data/kz-calendar'

export type { EducationCalendarEntry, PublicHolidayEvent }

/** Русские названия из справочника → типы периодов модуля. */
const PERIOD_TYPE: Record<string, string> = {
  Каникулы: 'VACATION',
  'Летние каникулы': 'SUMMER_BREAK',
  'Начало учебного года': 'START_OF_YEAR',
  'Конец учебного года': 'END_OF_YEAR',
  'Приёмная кампания': 'ADMISSION',
  Сессия: 'EXAMS',
  Семестр: 'SEMESTER',
  Другое: 'CUSTOM',
}

/**
 * Шкала влияния учебного справочника (−3…+4) → множитель спроса.
 *
 * Шаг намеренно мелкий: это чужая оценка. Границы те же, что у месячного
 * индекса, — за них выходить нельзя ни при каких значениях.
 */
const STEP = 0.05
const MIN_INDEX = 0.85
const MAX_INDEX = 1.2

export function strengthToIndex(strength: number): number {
  const raw = 1 + (Number(strength) || 0) * STEP
  return Math.round(Math.max(MIN_INDEX, Math.min(MAX_INDEX, raw)) * 100) / 100
}

/** Насколько можно верить датам записи. */
export function confidenceOf(status: string): number {
  if (status === 'confirmed') return 1
  if (status === 'preliminary') return 0.7
  return 0.5
}

const MAX_HOLIDAY_SPAN_DAYS = 6

function spanDays(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`)
  const b = new Date(`${to}T00:00:00`)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1
}

/**
 * Записи учебного справочника, которые на самом деле про праздники.
 *
 * Их берут не отсюда, а из справочника праздников: там официальные даты и
 * переносы. Здесь они только опознаются, чтобы не задвоиться.
 */
export function isHolidayWeekend(entry: EducationCalendarEntry): boolean {
  if (entry.type !== 'Другое') return false
  if (spanDays(entry.start_date, entry.end_date) > MAX_HOLIDAY_SPAN_DAYS) return false
  const name = entry.name.toLowerCase()
  return name.includes('выходн') || name.includes('праздн')
}

export function loadEducationCalendar(): EducationCalendarEntry[] {
  return KZ_EDUCATION_CALENDAR
}

export function loadPublicHolidays(): PublicHolidayEvent[] {
  return KZ_PUBLIC_HOLIDAYS
}

export type CalendarSplit = {
  periods: EducationCalendarEntry[]
  holidayWeekends: EducationCalendarEntry[]
}

export function splitEducationCalendar(entries: EducationCalendarEntry[]): CalendarSplit {
  const periods: EducationCalendarEntry[] = []
  const holidayWeekends: EducationCalendarEntry[] = []
  for (const entry of entries) {
    if (isHolidayWeekend(entry)) holidayWeekends.push(entry)
    else periods.push(entry)
  }
  return { periods, holidayWeekends }
}

export function periodTypeOf(entry: EducationCalendarEntry): string {
  return PERIOD_TYPE[entry.type] || 'CUSTOM'
}

export type HolidayDayRow = {
  day: string
  day_type: 'PUBLIC_HOLIDAY' | 'TRANSFERRED_DAY_OFF' | 'LONG_WEEKEND'
  name: string
  verified: boolean
  source_name: string
  source_url: string
}

/** Длинные выходные считаем от трёх дней подряд — короче это обычный уик-энд. */
const LONG_WEEKEND_FROM_DAYS = 3

/**
 * Разворачивает праздники в отдельные дни календаря.
 *
 * Берётся вариант пятидневной недели: именно её ритм задаёт поток покупателей
 * в городе, даже если сам магазин работает без выходных.
 *
 * Влияние всех дней остаётся нейтральным (1.00). Придумывать коэффициент
 * празднику, по которому нет собственной истории, нельзя — модуль посчитает
 * его сам, когда данные накопятся.
 */
export function expandHolidays(events: PublicHolidayEvent[]): HolidayDayRow[] {
  const out: HolidayDayRow[] = []

  for (const event of events) {
    const week = event.five_day_week || event.six_day_week
    if (!week) continue

    const verified = event.verification_status === 'confirmed'
    const meta = { name: event.name, verified, source_name: event.source_name, source_url: event.source_url }

    for (const day of week.holiday_dates || []) {
      out.push({ day, day_type: 'PUBLIC_HOLIDAY', ...meta })
    }
    for (const day of week.transfer_days_off || []) {
      out.push({ day, day_type: 'TRANSFERRED_DAY_OFF', name: `${event.name} — перенос выходного`, verified, source_name: event.source_name, source_url: event.source_url })
    }

    const rest = week.continuous_rest_period
    if (rest && rest.days >= LONG_WEEKEND_FROM_DAYS) {
      out.push({
        day: rest.start,
        day_type: 'LONG_WEEKEND',
        name: `${event.name} — длинные выходные (${rest.days} дн.)`,
        verified,
        source_name: event.source_name,
        source_url: event.source_url,
      })
    }
  }

  return out
}

/** События без дат — например, Курбан айт: его дата плавает по лунному календарю. */
export function holidaysNeedingDates(events: PublicHolidayEvent[]): PublicHolidayEvent[] {
  return events.filter((e) => {
    const week = e.five_day_week || e.six_day_week
    return !week || (week.holiday_dates || []).length === 0
  })
}
