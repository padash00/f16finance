import { NextResponse } from 'next/server'

import { buildProfitabilityReport } from '@/lib/domain/profitability-report'
import { DEFAULT_TAX_RATE, normalizeRate } from '@/lib/domain/tax'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { fetchAllRows } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * ОПиУ по месяцам — считает сервер, lib/domain/profitability-report.
 *
 *   GET /api/admin/profitability/summary?from=2026-01&to=2026-08
 *     [&include_extra=1]   — F16 Extra в итогах (по умолчанию нет, как в /reports)
 *     [&tax_rate=2]        — ставка налога с выручки, % (по умолчанию как на /tax)
 *     [&with_previous=1]   — досчитать месяц до периода для «что изменилось»
 *
 * `months` — формат приложения (apple/OrdaKit, PnlReport). Остальное — для
 * страницы: точки, статьи, неполные месяцы.
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const normalizeMonth = (raw: string | null) => {
  const value = (raw || '').trim()
  return /^\d{4}-\d{2}$/.test(value) ? value : null
}

const shiftMonth = (month: string, offset: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + offset, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

const monthEnd = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`
}

const prevDayISO = (dateISO: string) => {
  const d = new Date(`${dateISO}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function monthsBetween(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from, guard = 0; m <= to && guard < 120; m = shiftMonth(m, 1), guard++) out.push(m)
  return out
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'profitability.view')
    if (denied) return denied

    const url = new URL(req.url)
    const from = normalizeMonth(url.searchParams.get('from'))
    const to = normalizeMonth(url.searchParams.get('to'))
    if (!from || !to || from > to) return json({ error: 'from и to в формате YYYY-MM' }, 400)
    const includeExtra = url.searchParams.get('include_extra') === '1'
    const withPrevious = url.searchParams.get('with_previous') === '1'
    const taxRate = normalizeRate(url.searchParams.get('tax_rate') ?? DEFAULT_TAX_RATE)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const orgId = access.activeOrganization?.id || null
    const companyScope = await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin })
    const empty = { taxRate, months: [], previous: null, companies: [], categoriesByMonth: {}, impreciseNightByMonth: {}, incompleteMonths: [], extra: { names: [], included: includeExtra } }
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) return json({ ok: true, data: empty })
    // Без организации не-суперадмин не видит ничего: фильтры ниже иначе исчезли бы
    if (!access.isSuperAdmin && !orgId) return json({ ok: true, data: empty })
    const orgFilterId = orgId || '00000000-0000-0000-0000-000000000000'

    const firstMonth = withPrevious ? shiftMonth(from, -1) : from
    const months = monthsBetween(firstMonth, to)
    const dateFrom = `${firstMonth}-01`
    const dateTo = monthEnd(to)
    const scopeIn = (q: any) => (companyScope.allowedCompanyIds !== null ? q.in('company_id', companyScope.allowedCompanyIds) : q)

    let companiesQ: any = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds !== null) companiesQ = companiesQ.in('id', companyScope.allowedCompanyIds)
    let inputsQ: any = supabase.from('monthly_profitability_inputs').select('*').gte('month', dateFrom).lte('month', `${to}-01`)
    if (!access.isSuperAdmin) inputsQ = inputsQ.eq('organization_id', orgFilterId)
    else if (orgId) inputsQ = inputsQ.eq('organization_id', orgId)
    let categoriesQ: any = supabase.from('expense_categories').select('name, accounting_group')
    if (!access.isSuperAdmin) categoriesQ = categoriesQ.eq('organization_id', orgFilterId)
    else if (orgId) categoriesQ = categoriesQ.eq('organization_id', orgId)

    const [companiesRes, inputsRes, categoriesRes, incomes, expenses] = await Promise.all([
      companiesQ,
      inputsQ,
      categoriesQ,
      // День до периода: ночная смена переносит безнал за полночь
      fetchAllRows<any>(() =>
        scopeIn(
          supabase
            .from('incomes')
            .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, card_amount, online_amount')
            .gte('date', prevDayISO(dateFrom))
            .lte('date', dateTo)
            .order('date', { ascending: true })
            .order('id', { ascending: true }),
        ),
      ),
      // Отклонённые отсекает расчёт: у части строк статус пустой, и
      // `status <> 'declined'` в SQL выбросил бы их вместе с отклонёнными
      fetchAllRows<any>(() =>
        scopeIn(
          supabase
            .from('expenses')
            .select('id, date, company_id, category, cash_amount, kaspi_amount, status, comment')
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .order('date', { ascending: true })
            .order('id', { ascending: true }),
        ),
      ),
    ])
    if (companiesRes.error) throw companiesRes.error
    if (inputsRes.error) throw inputsRes.error

    const categoryGroups: Record<string, string | null> = {}
    for (const row of (categoriesRes?.data || []) as any[]) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }
    // `month` в базе — дата 2026-01-01, месяцы периода — 2026-01
    const inputsByMonth: Record<string, any> = {}
    for (const row of (inputsRes.data || []) as any[]) inputsByMonth[String(row.month).slice(0, 7)] = row

    const report = buildProfitabilityReport({
      incomes,
      expenses,
      companies: (companiesRes.data || []) as any[],
      categoryGroups,
      inputsByMonth,
      months,
      visibleFrom: from,
      includeExtra,
      taxRate,
    })

    return json({ ok: true, data: report })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/profitability/summary GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Не удалось посчитать ОПиУ' }, 500)
  }
}
