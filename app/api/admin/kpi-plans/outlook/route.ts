import { NextResponse } from 'next/server'

import { shiftMonth, type RunningMonthOutlook, type Scenarios } from '@/lib/analysis/forecast-learning'
import { forecastForScope, snapshotFromRow } from '@/lib/analysis/forecast-scope'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { kzTodayISO, loadForecastInputs } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'

/**
 * Прогноз для /goals: сколько выйдет к концу идущего месяца и сколько
 * ожидать в следующем — та же модель, что на /analysis (сверяется с фактом).
 * Отдельный маршрут, потому что /analysis закрыт своим правом и аддоном ИИ,
 * а цели видит тот, у кого есть право на цели.
 *
 * Сеть — без F16 Extra (как в /reports); каждая точка — отдельно.
 */

export type GoalsOutlookScope = { outlook: RunningMonthOutlook | null; next: Scenarios | null }
export type GoalsOutlookResponse = {
  month: string
  nextMonth: string
  org: GoalsOutlookScope
  companies: Record<string, GoalsOutlookScope>
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'goals.view')
    if (denied) return denied
    if (!hasAdminSupabaseCredentials()) return NextResponse.json({ error: 'no admin supabase' }, { status: 500 })

    const supabase = createAdminSupabaseClient()
    const organizationId = access.activeOrganization?.id || null
    const scope = await resolveCompanyScope({ activeOrganizationId: organizationId, isSuperAdmin: access.isSuperAdmin })
    const today = kzTodayISO()
    const month = today.slice(0, 7)
    const empty: GoalsOutlookResponse = { month, nextMonth: shiftMonth(month, 1), org: { outlook: null, next: null }, companies: {} }
    if (scope.allowedCompanyIds && scope.allowedCompanyIds.length === 0) return NextResponse.json(empty)

    let companiesQ: any = supabase.from('companies').select('id, name, code')
    if (scope.allowedCompanyIds) companiesQ = companiesQ.in('id', scope.allowedCompanyIds)

    const [inputs, companiesRes] = await Promise.all([
      loadForecastInputs(supabase, { companyIds: scope.allowedCompanyIds, organizationId, isSuperAdmin: access.isSuperAdmin, to: today }),
      companiesQ,
    ])
    const companies = (companiesRes?.data || []) as Array<{ id: string; name: string | null; code: string | null }>
    const extraIds = new Set(companies.filter(isExtraCompany).map((c) => String(c.id)))

    // Прогноз на начало месяца — зафиксированный 1-го числа, если есть
    let startScenarios: Scenarios | null = null
    if (organizationId) {
      const { data, error } = await supabase
        .from('forecast_snapshots')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('scope_key', 'all')
        .eq('target_month', `${month}-01`)
        .maybeSingle()
      if (!error && data) startScenarios = snapshotFromRow(data as Record<string, any>).scenarios
    }

    const network = {
      ...inputs,
      incomes: inputs.incomes.filter((r) => !extraIds.has(r.company_id)),
      expenses: inputs.expenses.filter((r) => !extraIds.has(r.company_id)),
    }
    const org = forecastForScope({ ...network, today, companyId: null, startScenarios })

    const result: GoalsOutlookResponse = {
      month,
      nextMonth: shiftMonth(month, 1),
      org: { outlook: org.outlook, next: org.next.scenarios },
      companies: {},
    }
    for (const id of new Set(inputs.incomes.map((r) => r.company_id))) {
      const s = forecastForScope({ ...inputs, today, companyId: id })
      result.companies[id] = { outlook: s.outlook, next: s.next.scenarios }
    }

    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kpi-plans/outlook GET', message: error?.message || 'error' })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
