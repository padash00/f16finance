import { NextResponse } from 'next/server'

import { buildCashflowReport, type BalanceAnchor } from '@/lib/domain/cashflow-report'
import { addDaysISO } from '@/lib/core/date'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { fetchAllRows } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Движение денег за период (/cashflow) — считает сервер, lib/domain/cashflow-report.
 *
 *   GET /api/admin/cashflow/summary?from=2026-08-01&to=2026-08-31[&company_id=…][&include_extra=1]
 *
 * `days` и `totals` — старый формат, их читает приложение (apple/OrdaKit,
 * CashflowReport); остальное — для страницы: потоки нал/безнал, назначение
 * расходов, точки, остаток денег по отметке.
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const isDate = (value: string | null): value is string => !!value && /^\d{4}-\d{2}-\d{2}$/.test(value)
/** Отметку остатка старше этого срока до начала периода не используем — слишком много строк тянуть */
const MAX_ANCHOR_LOOKBACK_DAYS = 400

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'cashflow.view')
    if (denied) return denied

    const url = new URL(req.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!isDate(from) || !isDate(to) || from > to) return json({ error: 'from и to в формате YYYY-MM-DD' }, 400)

    const companyId = url.searchParams.get('company_id') || null
    const includeExtra = url.searchParams.get('include_extra') === '1'
    const organizationId = access.activeOrganization?.id || null

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const companyScope = await resolveCompanyScope({ activeOrganizationId: organizationId, isSuperAdmin: access.isSuperAdmin, requestedCompanyId: companyId })
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: { from, to, days: [], totals: null } })
    }
    const scopeIds = companyId ? [companyId] : companyScope.allowedCompanyIds

    let companiesQ: any = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds) companiesQ = companiesQ.in('id', companyScope.allowedCompanyIds)

    // Отметки остатка — только своей организации; таблицы может ещё не быть
    let anchors: BalanceAnchor[] = []
    let balanceAvailable = false
    if (organizationId) {
      const { data, error } = await supabase
        .from('cash_balance_anchors')
        .select('id, company_id, as_of_date, cash_amount, cashless_amount, note')
        .eq('organization_id', organizationId)
        .lte('as_of_date', to)
        .order('as_of_date', { ascending: false })
      if (!error) {
        balanceAvailable = true
        anchors = ((data || []) as any[]).map((a) => ({ ...a, cash_amount: Number(a.cash_amount), cashless_amount: Number(a.cashless_amount) }))
      }
    }

    const length = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1
    const prevFrom = addDaysISO(from, -length)
    const relevantAnchor = anchors.find((a) => (companyId ? a.company_id === companyId : !a.company_id))
    const oldestAllowed = addDaysISO(from, -MAX_ANCHOR_LOOKBACK_DAYS)
    const usableAnchors = anchors.filter((a) => a.as_of_date >= oldestAllowed)
    const loadFrom = relevantAnchor && relevantAnchor.as_of_date >= oldestAllowed && relevantAnchor.as_of_date < prevFrom ? relevantAnchor.as_of_date : prevFrom

    const [companiesRes, incomes, expenses, categoriesRes] = await Promise.all([
      companiesQ,
      // День до начала: ночная смена переносит безнал за полночь
      fetchAllRows<any>(() => {
        let q = supabase
          .from('incomes')
          .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount')
          .gte('date', addDaysISO(loadFrom, -1))
          .lte('date', to)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
        if (scopeIds) q = q.in('company_id', scopeIds)
        return q
      }),
      fetchAllRows<any>(() => {
        let q = supabase
          .from('expenses')
          .select('id, date, company_id, category, cash_amount, kaspi_amount, status, comment, one_off_payee')
          .gte('date', loadFrom)
          .lte('date', to)
          .neq('status', 'declined')
          .order('date', { ascending: true })
          .order('id', { ascending: true })
        if (scopeIds) q = q.in('company_id', scopeIds)
        return q
      }),
      (() => {
        let q: any = supabase.from('expense_categories').select('name, accounting_group')
        if (!access.isSuperAdmin) q = q.eq('organization_id', organizationId || '00000000-0000-0000-0000-000000000000')
        else if (organizationId) q = q.eq('organization_id', organizationId)
        return q
      })(),
    ])
    if (companiesRes.error) throw companiesRes.error

    const categoryGroups: Record<string, string | null> = {}
    for (const row of ((categoriesRes as any)?.data || []) as Array<{ name: string | null; accounting_group: string | null }>) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }

    const report = buildCashflowReport({
      incomes,
      expenses,
      companies: (companiesRes.data || []) as any[],
      categoryGroups,
      from,
      to,
      includeExtra,
      companyId,
      anchors: usableAnchors,
    })

    return json({ ok: true, data: { ...report, balanceAvailable } })
  } catch (error: any) {
    if (error?.message === 'company-out-of-scope') return json({ error: 'Точка недоступна' }, 403)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/cashflow/summary GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Не удалось посчитать движение денег' }, 500)
  }
}
