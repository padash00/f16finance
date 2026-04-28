import type { DataPoint } from '@/lib/analysis/types'

export const dayNames = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']

export const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

export const parseISODateSafe = (dateStr: string) => new Date(`${dateStr}T12:00:00`)

export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

export const generateDateRange = (start: Date, end: Date): string[] => {
  const res: string[] = []
  const s = new Date(start)
  const e = new Date(end)
  s.setHours(12, 0, 0, 0)
  e.setHours(12, 0, 0, 0)

  const days = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
  for (let i = 0; i < days; i++) {
    const d = new Date(s)
    d.setDate(s.getDate() + i)
    res.push(toISODateLocal(d))
  }
  return res
}

export const addDaysISO = (iso: string, delta: number): string => {
  const d = parseISODateSafe(iso)
  d.setDate(d.getDate() + delta)
  return toISODateLocal(d)
}

export const median = (arr: number[]): number => {
  if (!arr.length) return 0
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export const mad = (arr: number[], med: number): number => {
  if (!arr.length) return 0
  return median(arr.map((v) => Math.abs(v - med)))
}

export const winsorize = (arr: number[], med: number, sigma: number, k = 4) => {
  if (!arr.length) return arr
  const lo = med - k * sigma
  const hi = med + k * sigma
  return arr.map((v) => clamp(v, lo, hi))
}

export const linearTrendSlope = (y: number[]): number => {
  const n = y.length
  if (n <= 1) return 0
  let sx = 0,
    sy = 0,
    sxy = 0,
    sxx = 0
  for (let i = 0; i < n; i++) {
    sx += i
    sy += y[i]!
    sxy += i * y[i]!
    sxx += i * i
  }
  const denom = n * sxx - sx * sx
  if (denom === 0) return 0
  return (n * sxy - sx * sy) / denom
}

export const safeMargin = (profit: number, income: number) => {
  if (!income || income <= 0) return 0
  return (profit / income) * 100
}

export const detectTrend = (values: number[]): 'up' | 'down' | 'stable' => {
  if (values.length < 3) return 'stable'
  const first = values[0]!
  const last = values[values.length - 1]!
  const change = ((last - first) / (first || 1)) * 100
  if (change > 5) return 'up'
  if (change < -5) return 'down'
  return 'stable'
}

export const startOfWeekISO = (dateStr: string) => {
  const d = parseISODateSafe(dateStr)
  const day = d.getDay()
  const diffToMon = (day + 6) % 7
  d.setDate(d.getDate() - diffToMon)
  return toISODateLocal(d)
}

export const getMonthKey = (dateStr: string) => dateStr.slice(0, 7)

export const shiftMonthKey = (monthKey: string, diff: number) => {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year!, (month || 1) - 1 + diff, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export const summarizeMonthFacts = (rows: DataPoint[], monthKey: string) => {
  return rows
    .filter((row) => getMonthKey(row.date) === monthKey)
    .reduce(
      (acc, row) => {
        acc.income += row.income
        acc.expense += row.expense
        acc.profit += row.profit ?? row.income - row.expense
        return acc
      },
      { income: 0, expense: 0, profit: 0 },
    )
}

export const summarizeMonthForecast = (rows: DataPoint[], monthKey: string) => {
  return rows
    .filter((row) => getMonthKey(row.date) === monthKey)
    .reduce(
      (acc, row) => {
        acc.income += row.income
        acc.profit += row.profit ?? row.income - row.expense
        return acc
      },
      { income: 0, profit: 0 },
    )
}

export const aggregateWeekly = (data: DataPoint[]): DataPoint[] => {
  const map = new Map<string, DataPoint>()
  for (const d of data) {
    const wk = startOfWeekISO(d.date)
    const cur = map.get(wk)
    if (!cur) {
      map.set(wk, {
        date: wk,
        income: d.income,
        expense: d.expense,
        profit: d.profit,
        margin: d.margin,
        dayOfWeek: 1,
        dayName: 'Нед',
        type: d.type,
        planned_income: d.planned_income || 0,
        planned_expense: d.planned_expense || 0,
        incomeCash: d.incomeCash,
        incomeKaspi: d.incomeKaspi,
        incomeCard: d.incomeCard,
        incomeOnline: d.incomeOnline,
      })
    } else {
      cur.income += d.income
      cur.expense += d.expense
      cur.profit += d.profit
      cur.margin = safeMargin(cur.profit, cur.income)
      cur.planned_income = (cur.planned_income || 0) + (d.planned_income || 0)
      cur.planned_expense = (cur.planned_expense || 0) + (d.planned_expense || 0)
      cur.incomeCash += d.incomeCash
      cur.incomeKaspi += d.incomeKaspi
      cur.incomeCard += d.incomeCard
      cur.incomeOnline += d.incomeOnline
      if (d.type === 'forecast') cur.type = 'forecast'
    }
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
}

export const formatAnomalyTypeLabel = (a: { type: string }) =>
  a.type === 'income_low' ? 'Низкий доход' : a.type === 'income_high' ? 'Высокий доход' : 'Высокий расход'

/** Детерминированный хэш для кеша AI (без JSON.stringify всего дерева). */
export function buildAiCacheKey(params: {
  from: string
  to: string
  companyId: string
  includeZero: boolean
  dataForAi: {
    dataRangeStart: string
    dataRangeEnd: string
    totalIncome: number
    totalExpense: number
    confidenceScore: number
    riskLevel: string
    planIncomeAchievementPct: number
  }
}): string {
  const d = params.dataForAi
  return [
    'v4',
    params.from,
    params.to,
    params.companyId,
    params.includeZero ? '1' : '0',
    d.dataRangeStart,
    d.dataRangeEnd,
    String(Math.round(d.totalIncome)),
    String(Math.round(d.totalExpense)),
    String(d.confidenceScore),
    d.riskLevel,
    String(d.planIncomeAchievementPct),
  ].join('|')
}
