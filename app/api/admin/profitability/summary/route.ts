import { NextResponse } from 'next/server'

import { buildProfitabilityReport } from '@/lib/domain/profitability-report'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { fetchAllRows } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * ОПиУ по месяцам — считает сервер, lib/domain/profitability-report.
 * Только из журналов доходов и расходов, как /income и /expenses.
 *
 *   GET /api/admin/profitability/summary?from=2026-01&to=2026-08
 *     [&include_extra=1]   — F16 Extra в итогах (по умолчанию нет, как в /income)
 *     [&with_previous=1]   — досчитать месяц до периода для сравнения
 *
 * `months` — формат приложения (apple/OrdaKit, PnlReport). Остальное — для
 * страницы: точки, статьи, сверка, неполные месяцы.
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

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const orgId = access.activeOrganization?.id || null
    const companyScope = await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin })
    const empty = { months: [], previous: null, companies: [], incompleteMonths: [], extra: { names: [], included: includeExtra } }
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
    let categoriesQ: any = supabase.from('expense_categories').select('name, accounting_group')
    if (!access.isSuperAdmin) categoriesQ = categoriesQ.eq('organization_id', orgFilterId)
    else if (orgId) categoriesQ = categoriesQ.eq('organization_id', orgId)

    const [companiesRes, categoriesRes, incomes, expenses] = await Promise.all([
      companiesQ,
      categoriesQ,
      fetchAllRows<any>(() =>
        scopeIn(
          supabase
            .from('incomes')
            .select('id, date, company_id, cash_amount, kaspi_amount, card_amount, online_amount')
            .gte('date', dateFrom)
            .lte('date', dateTo)
            .order('date', { ascending: true })
            .order('id', { ascending: true }),
        ),
      ),
      // Отклонённые отсекает расчёт (и показывает в сверке): у части строк
      // статус пустой, и `status <> 'declined'` в SQL выбросил бы их тоже
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

    const categoryGroups: Record<string, string | null> = {}
    for (const row of (categoriesRes?.data || []) as any[]) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }

    const report = buildProfitabilityReport({
      incomes,
      expenses,
      companies: (companiesRes.data || []) as any[],
      categoryGroups,
      months,
      visibleFrom: from,
      includeExtra,
    })

    return json({ ok: true, data: report })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/profitability/summary GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Не удалось посчитать ОПиУ' }, 500)
  }
}
