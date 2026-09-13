import { shiftMonth } from '@/lib/analysis/forecast-learning'

/**
 * Неполные месяцы: у точки нет записей доходов за часть дней.
 *
 * Система считает месяц закрытым по календарю, а отчёты смен могут внести не
 * все. Недовнесённый месяц выглядит как провал выручки: модель прогноза
 * засчитала бы себе промах, потянула прогноз вниз и расширила коридор. Поэтому
 * такие месяцы исключаются из обучения и помечаются.
 *
 * «Обычная» заполненность берётся по полноценным месяцам самой точки: магазин
 * с выходным по воскресеньям не помечается из-за четырёх пустых дней.
 */

export type IncompleteMonth = {
  /** YYYY-MM */
  month: string
  companyId: string
  /** Дней с доходом */
  days: number
  /** Сколько дней обычно бывает у этой точки в месяце такой длины */
  expectedDays: number
  daysInMonth: number
}

type IncomeLike = { company_id: string; date: string; cash?: number; kaspi?: number; card?: number; online?: number }

/** Сколько дней может не хватать без пометки: разовые закрытия и праздники */
const MISSING_DAYS_TOLERANCE = 3
/** «Обычная» заполненность — медиана последних полноценных месяцев */
const TYPICAL_WINDOW = 6

const daysIn = (ym: string) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate()

function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Неполные закрытые месяцы (строго до `beforeMonth`) по каждой точке */
export function findIncompleteMonths(incomes: IncomeLike[], beforeMonth: string): IncompleteMonth[] {
  const dates = new Map<string, Map<string, Set<string>>>()
  for (const r of incomes) {
    if (!r.date || r.date.slice(0, 7) >= beforeMonth) continue
    if ((r.cash || 0) + (r.kaspi || 0) + (r.card || 0) + (r.online || 0) <= 0) continue
    let months = dates.get(r.company_id)
    if (!months) {
      months = new Map()
      dates.set(r.company_id, months)
    }
    const month = r.date.slice(0, 7)
    let set = months.get(month)
    if (!set) {
      set = new Set()
      months.set(month, set)
    }
    set.add(r.date)
  }

  const prevMonth = shiftMonth(beforeMonth, -1)
  const out: IncompleteMonth[] = []

  for (const [companyId, months] of dates) {
    const active = [...months.keys()].sort()
    if (!active.length) continue
    const first = active[0]
    const last = active[active.length - 1]
    // Точка работала совсем недавно, а за прошлый месяц нет ни одной записи — скорее не внесли
    const end = last < prevMonth && last >= shiftMonth(prevMonth, -2) ? prevMonth : last
    // Пока полноценных месяцев нет, «обычная» заполненность — лучший месяц точки
    const bestFill = Math.max(...active.map((m) => (months.get(m)?.size ?? 0) / daysIn(m)))

    const fullFills: number[] = []
    for (let month = first; month <= end; month = shiftMonth(month, 1)) {
      const dim = daysIn(month)
      const days = months.get(month)?.size ?? 0
      const recent = fullFills.slice(-TYPICAL_WINDOW)
      const typical = Math.min(1, recent.length ? median(recent) : bestFill)
      const expectedDays = Math.round(typical * dim)

      if (days === 0 || expectedDays - days >= MISSING_DAYS_TOLERANCE) {
        out.push({ month, companyId, days, expectedDays, daysInMonth: dim })
      } else {
        // «Обычную» заполненность задают только полноценные месяцы
        fullFills.push(days / dim)
      }
    }
  }

  return out.sort((a, b) => a.month.localeCompare(b.month) || a.companyId.localeCompare(b.companyId))
}
