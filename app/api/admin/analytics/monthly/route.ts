import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { addDaysISO } from '@/lib/core/date'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function monthKey(dateStr: string) {
  return dateStr.slice(0, 7) // YYYY-MM
}

function buildMonthRange(year: number) {
  const months: string[] = []
  for (let m = 1; m <= 12; m++) {
    months.push(`${year}-${String(m).padStart(2, '0')}`)
  }
  return months
}

type MonthlyAggregate = {
  month: string
  cash: number
  kaspi: number
  card: number
  online: number
  revenue: number
  expenses: number
  profit: number
  margin_pct: number
  checks_count: number
  avg_check: number
  by_company: Record<string, {
    cash: number
    kaspi: number
    card: number
    online: number
    revenue: number
    checks_count: number
  }>
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'analytics.view')
    if (denied) return denied

    const url = new URL(req.url)
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()), 10)
    if (!Number.isFinite(year) || year < 2000 || year > 2200) {
      return json({ error: 'invalid year' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : null

    if (!supabase) {
      return json({ error: 'no admin supabase' }, 500)
    }

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const yearStart = `${year}-01-01`
    const todayIso = new Date().toISOString().slice(0, 10)
    const currentYear = new Date().getFullYear()
    // Для текущего года обрезаем диапазон до сегодня, чтобы будущие плановые
    // записи в expenses/incomes не попадали в «факт». Для прошлых годов —
    // полный год.
    const yearEnd = year >= currentYear ? todayIso : `${year}-12-31`
    const prevYearStart = `${year - 1}-01-01`
    // Тянем incomes за один день шире, чтобы поймать ночной kaspi из
    // последнего дня предыдущего года (после полуночи он относится на 1.01).
    const incomeFetchFrom = addDaysISO(prevYearStart, -1)

    // ── Companies ───────────────────────────────────────────────────────────
    let companiesQuery = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({
          ok: true,
          data: { year, companies: [], months: [], previousYear: [] },
        })
      }
      companiesQuery = companiesQuery.in('id', companyScope.allowedCompanyIds)
    }
    const { data: companies, error: companiesError } = await companiesQuery
    if (companiesError) throw companiesError

    // ── Incomes (текущий + прошлый год для YoY) ─────────────────────────────
    // PostgREST max-rows = 1000 → пагинируем чанками, иначе расходы/доходы
    // недосчитываются и итоги искажаются.
    const CHUNK = 1000

    async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
      const all: T[] = []
      let cursor = 0
      while (true) {
        const upper = cursor + CHUNK - 1
        const { data, error } = await buildQuery().range(cursor, upper)
        if (error) throw error
        const batch = (data || []) as T[]
        all.push(...batch)
        if (batch.length < CHUNK) break
        cursor += CHUNK
      }
      return all
    }

    const buildIncomesQuery = () => {
      let q = supabase
        .from('incomes')
        .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, card_amount, online_amount, comment')
        .gte('date', incomeFetchFrom)
        .lte('date', yearEnd)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }
    const rawIncomes = await fetchAll<any>(buildIncomesQuery)
    const incomes = splitIncomeKaspiByCalendarDay(rawIncomes as ReportIncomeCalendarRow[])

    // ── Expenses (текущий год) ───────────────────────────────────────────────
    const buildExpensesQuery = () => {
      let q = supabase
        .from('expenses')
        .select('date, company_id, cash_amount, kaspi_amount')
        .gte('date', yearStart)
        .lte('date', yearEnd)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }
    let expenses: any[] = []
    try {
      expenses = await fetchAll<any>(buildExpensesQuery)
    } catch (expensesError: any) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/analytics/monthly:expenses',
        message: expensesError?.message || 'expenses fetch failed',
      })
    }

    // ── point_sales для подсчёта чеков и среднего чека ──────────────────────
    const buildSalesQuery = () => {
      let q = supabase
        .from('point_sales')
        .select('sale_date, company_id, total_amount')
        .gte('sale_date', yearStart)
        .lte('sale_date', yearEnd)
        .order('sale_date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }
    let sales: any[] = []
    try {
      sales = await fetchAll<any>(buildSalesQuery)
    } catch (salesError: any) {
      await writeSystemErrorLogSafe({
        scope: 'server',
        area: 'api/admin/analytics/monthly:point_sales',
        message: salesError?.message || 'point_sales fetch failed',
      })
    }

    // ── Агрегация по месяцам ─────────────────────────────────────────────────
    const currentMonths = buildMonthRange(year)
    const prevMonths = buildMonthRange(year - 1)

    const emptyAgg = (m: string): MonthlyAggregate => ({
      month: m,
      cash: 0,
      kaspi: 0,
      card: 0,
      online: 0,
      revenue: 0,
      expenses: 0,
      profit: 0,
      margin_pct: 0,
      checks_count: 0,
      avg_check: 0,
      by_company: {},
    })

    const months: Record<string, MonthlyAggregate> = {}
    const previousYear: Record<string, { revenue: number }> = {}
    for (const m of currentMonths) months[m] = emptyAgg(m)
    for (const m of prevMonths) previousYear[m] = { revenue: 0 }

    for (const row of (incomes || []) as any[]) {
      const date = String(row.date || '')
      const mk = monthKey(date)
      const cash = Number(row.cash_amount || 0)
      const kaspi = Number(row.kaspi_amount || 0)
      const card = Number(row.card_amount || 0)
      const online = Number(row.online_amount || 0)
      const total = cash + kaspi + card + online
      const companyId = String(row.company_id || '')

      if (months[mk]) {
        const agg = months[mk]
        agg.cash += cash
        agg.kaspi += kaspi
        agg.card += card
        agg.online += online
        agg.revenue += total
        if (!agg.by_company[companyId]) {
          agg.by_company[companyId] = { cash: 0, kaspi: 0, card: 0, online: 0, revenue: 0, checks_count: 0 }
        }
        const c = agg.by_company[companyId]
        c.cash += cash
        c.kaspi += kaspi
        c.card += card
        c.online += online
        c.revenue += total
      } else if (previousYear[mk]) {
        previousYear[mk].revenue += total
      }
    }

    for (const row of (expenses || []) as any[]) {
      const mk = monthKey(String(row.date || ''))
      if (!months[mk]) continue
      months[mk].expenses += Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0)
    }

    for (const row of (sales || []) as any[]) {
      const mk = monthKey(String(row.sale_date || ''))
      if (!months[mk]) continue
      const companyId = String(row.company_id || '')
      months[mk].checks_count += 1
      if (!months[mk].by_company[companyId]) {
        months[mk].by_company[companyId] = { cash: 0, kaspi: 0, card: 0, online: 0, revenue: 0, checks_count: 0 }
      }
      months[mk].by_company[companyId].checks_count += 1
    }

    // Финальные расчёты: profit, margin, avg_check
    for (const m of currentMonths) {
      const agg = months[m]
      agg.profit = Math.round((agg.revenue - agg.expenses) * 100) / 100
      agg.margin_pct = agg.revenue > 0 ? Math.round((agg.profit / agg.revenue) * 10000) / 100 : 0
      agg.avg_check = agg.checks_count > 0 ? Math.round(agg.revenue / agg.checks_count) : 0
      // round
      agg.cash = Math.round(agg.cash * 100) / 100
      agg.kaspi = Math.round(agg.kaspi * 100) / 100
      agg.card = Math.round(agg.card * 100) / 100
      agg.online = Math.round(agg.online * 100) / 100
      agg.revenue = Math.round(agg.revenue * 100) / 100
      agg.expenses = Math.round(agg.expenses * 100) / 100
    }

    return json({
      ok: true,
      data: {
        year,
        companies: companies || [],
        months: currentMonths.map((m) => months[m]),
        previousYear: prevMonths.map((m) => ({ month: m, revenue: Math.round(previousYear[m].revenue * 100) / 100 })),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/analytics/monthly',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось собрать аналитику по месяцам' }, 500)
  }
}
