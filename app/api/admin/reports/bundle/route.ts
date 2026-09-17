import { NextResponse } from 'next/server'

import { addDaysISO } from '@/lib/core/date'
import { COUNTED_EXPENSE_FILTER } from '@/lib/domain/expense-status'
import { aggregateReportFromRows } from '@/lib/reports/aggregate-from-rows'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { groupExpensesByArticle } from '@/lib/reports/expense-groups'
import { countImpreciseNightKaspiInRange, splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { lastMonthMtdRangeForCurrentMonth, type ForecastHints } from '@/lib/reports/forecast-hybrid'
import { calculatePrevPeriod, isFullMonthRange, mergeDateRanges, previousCalendarMonthRange, sameRangeLastYear } from '@/lib/reports/period'
import { sumIncomeExpenseInRange } from '@/lib/reports/sum-range-totals'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireAnyCapability, requireCapability } from '@/lib/server/capabilities'
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
    // Итоги без сырых строк (rows=0) нужны и главному дашборду — у него своё право
    // dashboard.view. Строки операций (суммы, комментарии) — только с правом на отчёты.
    const denied =
      url.searchParams.get('rows') === '0'
        ? await requireAnyCapability(access, ['reports.view', 'dashboard.view'])
        : await requireCapability(access, 'reports.view')
    if (denied) return denied
    const dateFrom = url.searchParams.get('from') || ''
    const dateTo = url.searchParams.get('to') || ''
    const asOf = url.searchParams.get('as_of') || new Date().toISOString().slice(0, 10)
    const companyId = url.searchParams.get('company_id')
    const shift = url.searchParams.get('shift') as 'day' | 'night' | null
    const group = (url.searchParams.get('group') || 'day') as 'day' | 'week' | 'month' | 'year'
    const includeExtra = url.searchParams.get('include_extra') === '1' || url.searchParams.get('include_extra') === 'true'
    // Сырые строки в ответе:
    //   (нет)     — все строки за оба периода, как раньше (/tax, мобильное приложение);
    //   0         — без строк: /reports для итогов и графиков, ответ в разы легче;
    //   current   — только строки выбранного периода: /reports грузит их лениво
    //               для «Деталей», модалки и PDF.
    const rowsMode = url.searchParams.get('rows')
    // База сравнения: prev — предыдущий период той же длины (по умолчанию), year — тот же период годом раньше.
    const compare = url.searchParams.get('compare') === 'year' ? 'year' : 'prev'
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

    const { prevFrom, prevTo } =
      compare === 'year' ? sameRangeLastYear(dateFrom, dateTo) : calculatePrevPeriod(dateFrom, dateTo)

    // Тянем только нужные даты: текущий период, базу сравнения и — для прогноза
    // полного месяца — прошлый календарный месяц. Раньше брался сплошной отрезок
    // от начала базы до конца периода: при сравнении с прошлым годом это был бы
    // целый год строк ради одной недели.
    const neededRanges = [
      { from: dateFrom, to: dateTo },
      { from: prevFrom, to: prevTo },
    ]
    if (isFullMonthRange(dateFrom, dateTo)) neededRanges.push(previousCalendarMonthRange(dateFrom))
    // Доходам нужен ещё день до начала отрезка: ночная смена переносит часть безнала за полночь.
    const incomeRanges = mergeDateRanges(neededRanges.map((r) => ({ from: addDaysISO(r.from, -1), to: r.to })))
    const expenseRanges = mergeDateRanges(neededRanges)
    const incomeFetchFrom = incomeRanges[0].from
    const expenseFetchFrom = expenseRanges[0].from
    const expenseFetchTo = expenseRanges[expenseRanges.length - 1].to

    // Один билдер с условным .in(): раньше сначала БЕЗУСЛОВНО выполнялся запрос
    // по всем организациям, и только потом результат перезаписывался отскоупленным.
    let companiesQuery: any = supabase.from('companies').select('id, name, code')
    if (companyScope.allowedCompanyIds !== null) {
      companiesQuery = companiesQuery.in('id', companyScope.allowedCompanyIds)
    }
    const companiesRes = await companiesQuery
    if (companiesRes.error) throw companiesRes.error
    const companies = (companiesRes.data || []) as { id: string; name: string; code: string | null }[]
    const nameById = new Map(companies.map((c) => [c.id, c.name || 'Точка'] as const))
    const extraCompanyId = companies.find(isExtraCompany)?.id ?? null

    const companyName = (id: string) => nameById.get(id) ?? 'Неизвестно'

    // Стабильная сортировка по (date, id) обязательна для чанковой пагинации,
    // иначе строки с одинаковой датой могут продублироваться/потеряться между чанками.
    const buildIncomeQuery = (from: string, to: string) => {
      let q = supabase
        .from('incomes')
        .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount, comment')
        .gte('date', from)
        .lte('date', to)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      if (companyId) q = q.eq('company_id', companyId)
      if (shift) q = q.eq('shift', shift)
      return q
    }

    const buildExpenseQuery = (from: string, to: string) => {
      let q = supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount, comment')
        .gte('date', from)
        .lte('date', to)
        .or(COUNTED_EXPENSE_FILTER)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      if (companyId) q = q.eq('company_id', companyId)
      return q
    }

    // Справочник статей — только своей организации: чужая категория с тем же
    // именем перетёрла бы статью (тот же скоуп, что в /api/admin/profitability/summary).
    const orgId = access.activeOrganization?.id || null
    let categoriesQuery: any = supabase.from('expense_categories').select('name, accounting_group')
    if (!access.isSuperAdmin) categoriesQuery = categoriesQuery.eq('organization_id', orgId || '00000000-0000-0000-0000-000000000000')
    else if (orgId) categoriesQuery = categoriesQuery.eq('organization_id', orgId)

    const [rowsInRaw, rowsExRaw, categoriesRes] = await Promise.all([
      // Отрезки не пересекаются и идут по возрастанию — склейка сохраняет порядок (date, id).
      Promise.all(
        incomeRanges.map((r) => fetchAllRows<ReportIncomeCalendarRow>(() => buildIncomeQuery(r.from, r.to))),
      ).then((parts) => parts.flat()),
      Promise.all(
        expenseRanges.map((r) => fetchAllRows<ReportExpenseRow>(() => buildExpenseQuery(r.from, r.to))),
      ).then((parts) => parts.flat()),
      categoriesQuery,
    ])

    let rowsIn = rowsInRaw
    let rowsEx = rowsExRaw

    if (!includeExtra && !companyId && extraCompanyId) {
      rowsIn = rowsIn.filter((r) => r.company_id !== extraCompanyId)
      rowsEx = rowsEx.filter((r) => r.company_id !== extraCompanyId)
    }

    const impreciseNight = countImpreciseNightKaspiInRange(rowsIn, dateFrom, dateTo)
    const splitIncomes = splitIncomeKaspiByCalendarDay(rowsIn) as ReportIncomeCalendarRow[]

    // Справочник не открылся — статьи угадываются по названиям, отчёт не падает.
    const categoryGroups: Record<string, string | null> = {}
    for (const row of ((categoriesRes as any)?.data || []) as { name: string | null; accounting_group: string | null }[]) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }

    const agg = aggregateReportFromRows({
      incomes: splitIncomes,
      expenses: rowsEx,
      dateFrom,
      dateTo,
      groupMode: group,
      companyName,
      prevFrom,
      prevTo,
      // Для «прибыли как в ОПиУ»: CAPEX и выплаты партнёрам — вне P&L
      categoryGroups,
    })
    const expenseByGroup = groupExpensesByArticle({ expenses: rowsEx, dateFrom, dateTo, prevFrom, prevTo, categoryGroups })

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
        incomes:
          rowsMode === '0' ? [] :
          rowsMode === 'current' ? splitIncomes.filter((r) => r.date >= dateFrom && r.date <= dateTo) :
          splitIncomes,
        expenses:
          rowsMode === '0' ? [] :
          rowsMode === 'current' ? rowsEx.filter((r) => r.date >= dateFrom && r.date <= dateTo) :
          rowsEx,
        aggregate: serializeAggregate(agg, dateFrom, dateTo),
        expenseByGroup,
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
    companyStatsPrev: {},
    companyDaily: {},
  }
  return {
    asOf: new Date().toISOString().slice(0, 10),
    impreciseNightKaspiCount: 0,
    incomes: [],
    expenses: [],
    aggregate,
    forecastHints: null,
    expenseByGroup: [],
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
    companyStatsPrev: Object.fromEntries(agg.companyStatsPrev),
    companyDaily: Object.fromEntries(
      Array.from(agg.companyDaily, ([companyId, days]) => [companyId, Object.fromEntries(days)] as const),
    ),
  }
}
