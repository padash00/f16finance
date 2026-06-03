import { NextResponse } from 'next/server'

import { addDaysISO } from '@/lib/core/date'
import { aggregateReportFromRows } from '@/lib/reports/aggregate-from-rows'
import { countImpreciseNightKaspiInRange, splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { lastMonthMtdRangeForCurrentMonth, type ForecastHints } from '@/lib/reports/forecast-hybrid'
import { calculatePrevPeriod, isFullMonthRange, previousCalendarMonthRange } from '@/lib/reports/period'
import { sumIncomeExpenseInRange } from '@/lib/reports/sum-range-totals'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// PostgREST режет ответ по db-max-rows (часто 1000). Тянем данные чанками
// и склеиваем, как в /api/admin/expenses и /api/admin/incomes.
const CHUNK = 1000
const MAX_ROWS = 200000

type ReportExpenseRow = {
  id: string
  date: string
  company_id: string
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const out: T[] = []
  let cursor = 0
  while (out.length < MAX_ROWS) {
    const { data, error } = await buildQuery().range(cursor, cursor + CHUNK - 1)
    if (error) throw error
    const batch = (data || []) as T[]
    out.push(...batch)
    if (batch.length < CHUNK) break
    cursor += CHUNK
  }
  return out
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const dateFrom = url.searchParams.get('from') || ''
    const dateTo = url.searchParams.get('to') || ''
    const asOf = url.searchParams.get('as_of') || new Date().toISOString().slice(0, 10)
    const companyId = url.searchParams.get('company_id')
    const shift = url.searchParams.get('shift') as 'day' | 'night' | null
    const group = (url.searchParams.get('group') || 'day') as 'day' | 'week' | 'month' | 'year'
    const includeExtra = url.searchParams.get('include_extra') === '1' || url.searchParams.get('include_extra') === 'true'
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return json({ error: 'from и to в формате YYYY-MM-DD' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: emptyDataResponse(dateFrom, dateTo) })
    }

    const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)
    const incomeFetchFrom = addDaysISO(prevFrom, -1)
    const expenseFetchFrom = prevFrom
    const expenseFetchTo = dateTo

    let companiesRes = await supabase.from('companies').select('id, name, code')
    if (companyScope.allowedCompanyIds !== null) {
      companiesRes = await supabase.from('companies').select('id, name, code').in('id', companyScope.allowedCompanyIds)
    }
    if (companiesRes.error) throw companiesRes.error
    const companies = (companiesRes.data || []) as { id: string; name: string; code: string | null }[]
    const nameById = new Map(companies.map((c) => [c.id, c.name || 'Точка'] as const))
    let extraCompanyId: string | null = null
    for (const c of companies) {
      const code = (c.code || '').toLowerCase()
      if (code === 'extra' || (c.name || '').toLowerCase().includes('extra')) {
        extraCompanyId = c.id
        break
      }
    }

    const companyName = (id: string) => nameById.get(id) ?? 'Неизвестно'

    // Стабильная сортировка по (date, id) обязательна для чанковой пагинации,
    // иначе строки с одинаковой датой могут продублироваться/потеряться между чанками.
    const buildIncomeQuery = () => {
      let q = supabase
        .from('incomes')
        .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount, comment')
        .gte('date', incomeFetchFrom)
        .lte('date', dateTo)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      if (companyId) q = q.eq('company_id', companyId)
      if (shift) q = q.eq('shift', shift)
      return q
    }

    const buildExpenseQuery = () => {
      let q = supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount, comment')
        .gte('date', expenseFetchFrom)
        .lte('date', expenseFetchTo)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      if (companyId) q = q.eq('company_id', companyId)
      return q
    }

    const [rowsInRaw, rowsExRaw] = await Promise.all([
      fetchAllRows<ReportIncomeCalendarRow>(buildIncomeQuery),
      fetchAllRows<ReportExpenseRow>(buildExpenseQuery),
    ])

    let rowsIn = rowsInRaw
    let rowsEx = rowsExRaw

    if (!includeExtra && !companyId && extraCompanyId) {
      rowsIn = rowsIn.filter((r) => r.company_id !== extraCompanyId)
      rowsEx = rowsEx.filter((r) => r.company_id !== extraCompanyId)
    }

    const impreciseNight = countImpreciseNightKaspiInRange(rowsIn, dateFrom, dateTo)
    const splitIncomes = splitIncomeKaspiByCalendarDay(rowsIn) as ReportIncomeCalendarRow[]

    const agg = aggregateReportFromRows({
      incomes: splitIncomes,
      expenses: rowsEx,
      dateFrom,
      dateTo,
      groupMode: group,
      companyName,
    })

    let forecastHints: ForecastHints | null = null
    if (isFullMonthRange(dateFrom, dateTo)) {
      const pm = previousCalendarMonthRange(dateFrom)
      const full = sumIncomeExpenseInRange(splitIncomes, rowsEx, pm.from, pm.to)
      const mtdR = lastMonthMtdRangeForCurrentMonth(dateFrom, asOf)
      if (mtdR) {
        const mtd = sumIncomeExpenseInRange(splitIncomes, rowsEx, mtdR.from, mtdR.to)
        forecastHints = {
          lastFullMonth: {
            from: pm.from,
            to: pm.to,
            totalIncome: full.totalIncome,
            totalExpense: full.totalExpense,
            profit: full.profit,
          },
          lastMonthMtd: {
            from: mtdR.from,
            to: mtdR.to,
            totalIncome: mtd.totalIncome,
            totalExpense: mtd.totalExpense,
            profit: mtd.profit,
            days: mtdR.days,
          },
        }
      }
    }

    return json({
      ok: true,
      data: {
        asOf,
        impreciseNightKaspiCount: impreciseNight,
        incomes: splitIncomes,
        expenses: rowsEx,
        aggregate: serializeAggregate(agg, dateFrom, dateTo),
        forecastHints,
        meta: { prevFrom, prevTo, incomeFetchFrom, expenseFetchFrom, expenseFetchTo },
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/reports/bundle GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

function emptyDataResponse(dateFrom: string, dateTo: string) {
  const { prevFrom, prevTo } = calculatePrevPeriod(dateFrom, dateTo)
  const z = {
    incomeCash: 0,
    incomeKaspi: 0,
    incomeOnline: 0,
    incomeCard: 0,
    incomeNonCash: 0,
    expenseCash: 0,
    expenseKaspi: 0,
    totalIncome: 0,
    totalExpense: 0,
    profit: 0,
    remainingCash: 0,
    remainingKaspi: 0,
    totalBalance: 0,
    transactionCount: 0,
    avgTransaction: 0,
  }
  const aggregate = {
    dateFrom,
    dateTo,
    totalsCur: { ...z },
    totalsPrev: { ...z },
    chartData: [] as { key: string }[],
    expenseByCategory: {} as Record<string, number>,
    incomeByCompany: {} as Record<string, unknown>,
    companyStats: {} as Record<string, unknown>,
    anomalies: [] as unknown[],
    prevFrom,
    prevTo,
    dailyIncome: {} as Record<string, number>,
    dailyExpense: {} as Record<string, number>,
  }
  return {
    asOf: new Date().toISOString().slice(0, 10),
    impreciseNightKaspiCount: 0,
    incomes: [],
    expenses: [],
    aggregate,
    forecastHints: null,
    meta: {
      prevFrom,
      prevTo,
      incomeFetchFrom: addDaysISO(prevFrom, -1),
      expenseFetchFrom: prevFrom,
      expenseFetchTo: dateTo,
    },
  }
}

function serializeAggregate(
  agg: ReturnType<typeof aggregateReportFromRows>,
  dateFrom: string,
  dateTo: string,
) {
  return {
    dateFrom,
    dateTo,
    totalsCur: agg.totalsCur,
    totalsPrev: agg.totalsPrev,
    chartData: agg.chartData,
    expenseByCategory: Object.fromEntries(agg.expenseByCategoryMap),
    incomeByCompany: Object.fromEntries(agg.incomeByCompanyMap),
    companyStats: Object.fromEntries(agg.companyStats),
    anomalies: agg.anomalies,
    prevFrom: agg.prevFrom,
    prevTo: agg.prevTo,
    dailyIncome: Object.fromEntries(agg.dailyIncome),
    dailyExpense: Object.fromEntries(agg.dailyExpense),
  }
}
