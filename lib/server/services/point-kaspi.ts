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

export type PointDailyKaspiBucket = {
  key: 'day' | 'night-before-midnight' | 'previous-night-after-midnight'
  label: string
  amount: number
  rowCount: number
}

export type PointDailyKaspiReport = {
  date: string
  total: number
  isPrecise: boolean
  warning: string | null
  parts: PointDailyKaspiBucket[]
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

function prevDayISO(dateISO: string) {
  const next = new Date(`${dateISO}T00:00:00`)
  next.setDate(next.getDate() - 1)
  return next.toISOString().slice(0, 10)
}

function isValidDate(dateISO: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(dateISO)
}

export async function buildPointDailyKaspiReport(params: {
  supabase: SupabaseLike
  companyId: string
  date: string
}): Promise<PointDailyKaspiReport> {
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

  let dayAmount = 0
  let nightBeforeMidnight = 0
  let previousNightAfterMidnight = 0
  let dayCount = 0
  let nightBeforeCount = 0
  let previousNightAfterCount = 0
  let isPrecise = true

  for (const row of ((data || []) as IncomeRow[])) {
    const totalKaspi = Number(row.kaspi_amount || 0)
    const beforeMidnight = row.kaspi_before_midnight == null ? null : Number(row.kaspi_before_midnight || 0)

    if (row.date === params.date && row.shift === 'day') {
      dayAmount += totalKaspi
      dayCount += 1
      continue
    }

    if (row.date === params.date && row.shift === 'night') {
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

  const parts: PointDailyKaspiBucket[] = [
    {
      key: 'day',
      label: `Дневная смена ${params.date}`,
      amount: roundMoney(dayAmount),
      rowCount: dayCount,
    },
    {
      key: 'night-before-midnight',
      label: `Ночная смена ${params.date} до 00:00`,
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
    date: params.date,
    total: roundMoney(parts.reduce((sum, item) => sum + item.amount, 0)),
    isPrecise,
    warning: isPrecise
      ? null
      : 'Есть старые ночные смены без разбивки Kaspi. Суточная сумма показана по доступным данным и может быть неточной.',
    parts,
  }
}
