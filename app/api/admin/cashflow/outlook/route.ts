import { NextResponse } from 'next/server'

import { forecastForScope } from '@/lib/analysis/forecast-scope'
import { weekdayWeights } from '@/lib/analysis/goal-pace'
import { addDaysISO } from '@/lib/core/date'
import {
  balanceAt,
  dailyChannelNet,
  pickAnchor,
  projectMonthEnd,
  splitIncomes,
  upcomingPayments,
  type BalanceAnchor,
  type MonthProjection,
  type UpcomingPayment,
} from '@/lib/domain/cashflow-report'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { fetchAllRows, kzTodayISO, loadForecastInputs } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { COUNTED_EXPENSE_FILTER } from '@/lib/domain/expense-status'

/**
 * Платежи и деньги до конца месяца (/cashflow → «Платежи»).
 *
 *   GET /api/admin/cashflow/outlook[?company_id=…]
 *
 * - регулярные платежи из шаблонов расходов на 31 день вперёд;
 * - прогноз до конца месяца: выручка и расходы — модель /analysis (что
 *   осталось после факта), платежи — в их дни;
 * - остаток на сегодня — по отметке остатка; от него — самая низкая точка.
 *
 * Охват — деньги: у организации все точки, включая F16 Extra.
 */

export const dynamic = 'force-dynamic'

export type CashflowOutlook = {
  today: string
  payments: UpcomingPayment[]
  projection: MonthProjection | null
  balanceToday: { cash: number; cashless: number; total: number } | null
  anchor: BalanceAnchor | null
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'cashflow.view')
    if (denied) return denied
    if (!hasAdminSupabaseCredentials()) return NextResponse.json({ error: 'no admin supabase' }, { status: 500 })

    const url = new URL(req.url)
    const companyId = url.searchParams.get('company_id') || null
    const organizationId = access.activeOrganization?.id || null
    const scope = await resolveCompanyScope({ activeOrganizationId: organizationId, isSuperAdmin: access.isSuperAdmin, requestedCompanyId: companyId })
    const today = kzTodayISO()
    const yesterday = addDaysISO(today, -1)
    const empty: CashflowOutlook = { today, payments: [], projection: null, balanceToday: null, anchor: null }
    if (scope.allowedCompanyIds && scope.allowedCompanyIds.length === 0) return NextResponse.json({ ok: true, data: empty })

    const supabase = createAdminSupabaseClient()
    const scopeIds = companyId ? [companyId] : scope.allowedCompanyIds
    const include = (id: string) => (companyId ? id === companyId : !scope.allowedCompanyIds || scope.allowedCompanyIds.includes(id))

    let companiesQ: any = supabase.from('companies').select('id, name, code')
    if (scope.allowedCompanyIds) companiesQ = companiesQ.in('id', scope.allowedCompanyIds)
    let templatesQ: any = supabase
      .from('expense_templates')
      .select('id, name, category, amount, payment_type, company_id, recurring_day_of_month, recurring_active, recurring_last_run_at')
      .not('recurring_day_of_month', 'is', null)
    if (scopeIds) templatesQ = templatesQ.in('company_id', scopeIds)

    let anchors: BalanceAnchor[] = []
    if (organizationId) {
      const { data, error } = await supabase
        .from('cash_balance_anchors')
        .select('id, company_id, as_of_date, cash_amount, cashless_amount, note')
        .eq('organization_id', organizationId)
        .lte('as_of_date', today)
      if (!error) anchors = ((data || []) as any[]).map((a) => ({ ...a, cash_amount: Number(a.cash_amount), cashless_amount: Number(a.cashless_amount) }))
    }
    const anchor = pickAnchor(anchors, companyId, today)

    const [companiesRes, templatesRes, inputs] = await Promise.all([
      companiesQ,
      templatesQ,
      loadForecastInputs(supabase, { companyIds: scopeIds, organizationId, isSuperAdmin: access.isSuperAdmin, to: today }),
    ])
    const companies = (companiesRes?.data || []) as Array<{ id: string; name: string; code: string | null }>
    const payments = upcomingPayments({ templates: (templatesRes?.data || []) as any[], companies, today, horizonDays: 31, include })

    // Остаток на конец вчера — нужны строки со статусом расходов с даты отметки
    let balanceToday: CashflowOutlook['balanceToday'] = null
    if (anchor) {
      const since = anchor.as_of_date < yesterday ? anchor.as_of_date : yesterday
      const [incomeRows, expenseRows] = await Promise.all([
        fetchAllRows<any>(() => {
          let q = supabase
            .from('incomes')
            .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount')
            .gte('date', addDaysISO(since, -1))
            .lte('date', today)
            .order('date', { ascending: true })
            .order('id', { ascending: true })
          if (scopeIds) q = q.in('company_id', scopeIds)
          return q
        }),
        fetchAllRows<any>(() => {
          let q = supabase
            .from('expenses')
            .select('id, date, company_id, category, cash_amount, kaspi_amount, status')
            .gte('date', since)
            .lte('date', today)
            .or(COUNTED_EXPENSE_FILTER)
            .order('date', { ascending: true })
            .order('id', { ascending: true })
          if (scopeIds) q = q.in('company_id', scopeIds)
          return q
        }),
      ])
      const daily = dailyChannelNet(splitIncomes(incomeRows), expenseRows, include)
      balanceToday = balanceAt(yesterday, anchor, daily)
    }

    // Выручка и расходы до конца месяца: модель /analysis, иначе среднее за 4 недели
    const monthStart = `${today.slice(0, 7)}-01`
    const scopeForecast = forecastForScope({ ...inputs, today, companyId })
    const outlook = scopeForecast.outlook
    const revenueByDate = new Map<string, number>()
    const expenseByDate = new Map<string, number>()
    for (const r of inputs.incomes) {
      if (companyId && r.company_id !== companyId) continue
      revenueByDate.set(r.date, (revenueByDate.get(r.date) || 0) + (r.cash || 0) + (r.kaspi || 0) + (r.card || 0) + (r.online || 0))
    }
    for (const r of inputs.expenses) {
      if (companyId && r.company_id !== companyId) continue
      expenseByDate.set(r.date, (expenseByDate.get(r.date) || 0) + (r.cash || 0) + (r.kaspi || 0))
    }
    const sumRange = (map: Map<string, number>, from: string, to: string) => {
      let s = 0
      for (const [d, v] of map) if (d >= from && d <= to) s += v
      return s
    }
    const rhythmFrom = addDaysISO(yesterday, -55)
    const weights = weekdayWeights(Array.from(revenueByDate.entries()).filter(([d]) => d >= rhythmFrom && d <= yesterday).map(([date, value]) => ({ date, value })))

    const [y, m] = today.split('-').map(Number)
    const daysLeft = new Date(Date.UTC(y, m, 0)).getUTCDate() - Number(today.slice(8, 10)) + 1
    let incomeLeft: number
    let expenseLeft: number
    let source: 'model' | 'average'
    if (outlook) {
      incomeLeft = outlook.outlook.realistic.income - outlook.fact.income
      expenseLeft = outlook.outlook.realistic.expense - outlook.fact.expense
      source = 'model'
    } else {
      const from28 = addDaysISO(yesterday, -27)
      incomeLeft = (sumRange(revenueByDate, from28, yesterday) / 28) * daysLeft
      expenseLeft = (sumRange(expenseByDate, from28, yesterday) / 28) * daysLeft
      source = 'average'
    }
    const hasHistory = sumRange(revenueByDate, addDaysISO(monthStart, -60), yesterday) > 0
    const projection = hasHistory
      ? projectMonthEnd({ today, incomeLeft, expenseLeft, payments, weights, balanceStart: balanceToday ? balanceToday.total : null, source })
      : null

    return NextResponse.json({ ok: true, data: { today, payments, projection, balanceToday, anchor } satisfies CashflowOutlook }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    if (error?.message === 'company-out-of-scope') return NextResponse.json({ error: 'Точка недоступна' }, { status: 403 })
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/cashflow/outlook GET', message: error?.message || 'error' })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
