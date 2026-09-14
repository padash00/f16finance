import { NextResponse } from 'next/server'

import { forecastForScope } from '@/lib/analysis/forecast-scope'
import { DEFAULT_TAX_RATE, normalizeRate } from '@/lib/domain/tax'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { kzTodayISO, loadForecastInputs } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Идущий месяц для /profitability: факт по вчера и прогноз к концу месяца —
 * модель из «Прогноз и точность» (/analysis). Отдельный маршрут, потому что
 * /analysis закрыт своим правом и аддоном ИИ, а ОПиУ смотрят по праву ОПиУ.
 *
 * Прибыль модели — выручка минус текущие расходы (без разовых, покупки
 * оборудования и выплат партнёрам) и до налога; налог досчитываем ставкой.
 */

export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'profitability.view')
    if (denied) return denied
    if (!hasAdminSupabaseCredentials()) return NextResponse.json({ error: 'no admin supabase' }, { status: 500 })

    const url = new URL(req.url)
    const includeExtra = url.searchParams.get('include_extra') === '1'
    const taxRate = normalizeRate(url.searchParams.get('tax_rate') ?? DEFAULT_TAX_RATE)
    const organizationId = access.activeOrganization?.id || null
    const scope = await resolveCompanyScope({ activeOrganizationId: organizationId, isSuperAdmin: access.isSuperAdmin })
    const today = kzTodayISO()
    const month = today.slice(0, 7)
    if (scope.allowedCompanyIds && scope.allowedCompanyIds.length === 0) return NextResponse.json({ ok: true, data: { month, outlook: null, taxRate } })

    const supabase = createAdminSupabaseClient()
    let companiesQ: any = supabase.from('companies').select('id, name, code')
    if (scope.allowedCompanyIds) companiesQ = companiesQ.in('id', scope.allowedCompanyIds)
    const [companiesRes, inputs] = await Promise.all([
      companiesQ,
      loadForecastInputs(supabase, { companyIds: scope.allowedCompanyIds, organizationId, isSuperAdmin: access.isSuperAdmin, to: today }),
    ])
    const extraIds = new Set(((companiesRes?.data || []) as any[]).filter(isExtraCompany).map((c) => String(c.id)))
    const scoped = includeExtra
      ? inputs
      : { ...inputs, incomes: inputs.incomes.filter((r) => !extraIds.has(r.company_id)), expenses: inputs.expenses.filter((r) => !extraIds.has(r.company_id)) }

    const outlook = forecastForScope({ ...scoped, today, companyId: null }).outlook
    return NextResponse.json(
      {
        ok: true,
        data: outlook
          ? { month, taxRate, knownDays: outlook.knownDays, daysInMonth: outlook.daysInMonth, fact: outlook.fact, outlook: outlook.outlook }
          : { month, taxRate, outlook: null },
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/profitability/outlook GET', message: error?.message || 'error' })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
