import 'server-only'

type IncomeRow = {
  id: string
  date: string
  shift: 'day' | 'night'
  kaspi_amount: number | null
  kaspi_before_midnight: number | null
}

type SupabaseLike = {
  from: (table: string) => any
}

export type DailyKaspiBucket = {
  key: 'day' | 'night-before-midnight' | 'previous-night-after-midnight'
  label: string
  amount: number
  rowCount: number
}

export type DailyKaspiReport = {
  date: string
  total: number
  isPrecise: boolean
  warning: string | null
  parts: DailyKaspiBucket[]
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function isValidDate(dateISO: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateISO)
}

function prevDayISO(dateISO: string) {
  const next = new Date(`${dateISO}T00:00:00`)
  next.setDate(next.getDate() - 1)
  return next.toISOString().slice(0, 10)
}

function nextDayISO(dateISO: string) {
  const next = new Date(`${dateISO}T00:00:00`)
  next.setDate(next.getDate() + 1)
  return next.toISOString().slice(0, 10)
}

function buildDailyKaspiReportFromRows(date: string, rows: IncomeRow[]): DailyKaspiReport {
  const previousDate = prevDayISO(date)

  let dayAmount = 0
  let nightBeforeMidnight = 0
  let previousNightAfterMidnight = 0
  let dayCount = 0
  let nightBeforeCount = 0
  let previousNightAfterCount = 0
  let isPrecise = true

  for (const row of rows) {
    const totalKaspi = Number(row.kaspi_amount || 0)
    const beforeMidnight = row.kaspi_before_midnight == null ? null : Number(row.kaspi_before_midnight || 0)

    if (row.date === date && row.shift === 'day') {
      dayAmount += totalKaspi
      dayCount += 1
      continue
    }

    if (row.date === date && row.shift === 'night') {
      if (beforeMidnight == null) {
        isPrecise = false
      }
      nightBeforeMidnight += Number(beforeMidnight || 0)
      nightBeforeCount += 1
      continue
    }

    if (row.date === previousDate && row.shift === 'night') {
      if (beforeMidnight == null) {
        isPrecise = false
        previousNightAfterMidnight += totalKaspi
      } else {
        previousNightAfterMidnight += Math.max(totalKaspi - beforeMidnight, 0)
      }
      previousNightAfterCount += 1
    }
  }

  const parts: DailyKaspiBucket[] = [
    {
      key: 'day',
      label: `Дневная смена ${date}`,
      amount: roundMoney(dayAmount),
      rowCount: dayCount,
    },
    {
      key: 'night-before-midnight',
      label: `Ночная смена ${date} до 00:00`,
      amount: roundMoney(nightBeforeMidnight),
      rowCount: nightBeforeCount,
    },
    {
      key: 'previous-night-after-midnight',
      label: `Ночная смена ${previousDate} после 00:00`,
      amount: roundMoney(previousNightAfterMidnight),
      rowCount: previousNightAfterCount,
    },
  ]

  return {
    date,
    total: roundMoney(parts.reduce((sum, item) => sum + item.amount, 0)),
    isPrecise,
    warning: isPrecise
      ? null
      : 'Есть старые ночные смены без разбивки Kaspi. Суточная сумма показана по доступным данным и может быть неточной.',
    parts,
  }
}

export function buildDailyKaspiSeriesFromRows(params: {
  dateFrom: string
  dateTo: string
  rows: IncomeRow[]
}): DailyKaspiReport[] {
  if (!isValidDate(params.dateFrom) || !isValidDate(params.dateTo)) {
    throw new Error('invalid-date-range')
  }

  const byDate = new Map<string, IncomeRow[]>()

  for (const row of params.rows) {
    const current = byDate.get(row.date)
    if (current) {
      current.push(row)
    } else {
      byDate.set(row.date, [row])
    }
  }

  const result: DailyKaspiReport[] = []
  let cursor = params.dateFrom
  while (cursor <= params.dateTo) {
    const previous = prevDayISO(cursor)
    const currentRows = [
      ...(byDate.get(cursor) || []),
      ...(byDate.get(previous) || []),
    ]
    result.push(buildDailyKaspiReportFromRows(cursor, currentRows))
    cursor = nextDayISO(cursor)
  }

  return result
}

export async function buildCompanyDailyKaspiReport(params: {
  supabase: SupabaseLike
  companyId: string
  date: string
}): Promise<DailyKaspiReport> {
  if (!isValidDate(params.date)) {
    throw new Error('invalid-date')
  }

  const previousDate = prevDayISO(params.date)

  const { data, error } = await params.supabase
    .from('incomes')
    .select('id,date,shift,kaspi_amount,kaspi_before_midnight')
    .eq('company_id', params.companyId)
    .gte('date', previousDate)
    .lte('date', params.date)

  if (error) throw error

  return buildDailyKaspiReportFromRows(params.date, (data || []) as IncomeRow[])
}

export async function buildCompanyDailyKaspiSeries(params: {
  supabase: SupabaseLike
  companyId: string
  dateFrom: string
  dateTo: string
}): Promise<DailyKaspiReport[]> {
  if (!isValidDate(params.dateFrom) || !isValidDate(params.dateTo)) {
    throw new Error('invalid-date-range')
  }

  const previousDate = prevDayISO(params.dateFrom)

  const { data, error } = await params.supabase
    .from('incomes')
    .select('id,date,shift,kaspi_amount,kaspi_before_midnight')
    .eq('company_id', params.companyId)
    .gte('date', previousDate)
    .lte('date', params.dateTo)

  if (error) throw error
  return buildDailyKaspiSeriesFromRows({
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    rows: (data || []) as IncomeRow[],
  })
}

export function sumDailyKaspiReports(items: DailyKaspiReport[]) {
  return roundMoney(items.reduce((sum, item) => sum + item.total, 0))
}
