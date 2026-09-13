import { NextResponse } from 'next/server'

import { findIncompleteMonths } from '@/lib/analysis/data-completeness'
import { shiftMonth } from '@/lib/analysis/forecast-learning'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireAnyCapability } from '@/lib/server/capabilities'
import { fetchAllRows, kzTodayISO } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Не закрыт ли прошлый месяц: у каких точек не внесены отчёты за часть дней.
 * Для строки «Требует внимания» на дашборде. Правило то же, что у прогноза
 * (lib/analysis/data-completeness) — неполный месяц там же выпадает из обучения.
 */

type IncomeRow = {
  company_id: string
  date: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireAnyCapability(access, ['dashboard.view', 'reports.view', 'income.view'])
    if (denied) return denied

    const today = kzTodayISO()
    const currentMonth = today.slice(0, 7)
    const prevMonth = shiftMonth(currentMonth, -1)

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (scope.allowedCompanyIds !== null && scope.allowedCompanyIds.length === 0) {
      return NextResponse.json({ ok: true, data: { month: prevMonth, companies: [] } })
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    // Полгода с запасом: «обычная» заполненность точки считается по её прошлым месяцам
    const from = `${shiftMonth(currentMonth, -8)}-01`

    let companiesQuery: any = supabase.from('companies').select('id, name')
    if (scope.allowedCompanyIds !== null) companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)

    const [rows, companiesRes] = await Promise.all([
      fetchAllRows<IncomeRow>(() => {
        let q: any = supabase
          .from('incomes')
          .select('id, company_id, date, cash_amount, kaspi_amount, card_amount, online_amount')
          .gte('date', from)
          .lt('date', `${currentMonth}-01`)
          .order('date', { ascending: true })
          .order('id', { ascending: true })
        if (scope.allowedCompanyIds !== null) q = q.in('company_id', scope.allowedCompanyIds)
        return q
      }),
      companiesQuery,
    ])
    const nameOf = new Map<string, string>(((companiesRes?.data || []) as any[]).map((c) => [String(c.id), String(c.name || '—')]))

    const incomplete = findIncompleteMonths(
      rows.map((r) => ({
        company_id: String(r.company_id),
        date: String(r.date),
        cash: Number(r.cash_amount || 0),
        kaspi: Number(r.kaspi_amount || 0),
        card: Number(r.card_amount || 0),
        online: Number(r.online_amount || 0),
      })),
      currentMonth,
    ).filter((m) => m.month === prevMonth)

    return NextResponse.json({
      ok: true,
      data: {
        month: prevMonth,
        companies: incomplete.map((m) => ({ ...m, companyName: nameOf.get(m.companyId) || '—' })),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/data-completeness GET', message: error?.message || 'error' })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
