import { NextResponse } from 'next/server'

import {
  forecastForScope,
  snapshotFromRow,
  type ForecastByCompany,
  type ForecastSnapshotView,
  type MonthlyForecastResponse,
} from '@/lib/analysis/forecast-scope'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireAnyCapability } from '@/lib/server/capabilities'
import { requireAddon } from '@/lib/server/entitlements'
import { kzTodayISO, loadForecastInputs } from '@/lib/server/forecast-inputs'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Прогноз на следующий месяц в трёх сценариях и история его точности (/analysis).
 *
 * - `next` — прогноз, который модель строит по закрытым месяцам, откалиброванный
 *   по собственным прошлым промахам (lib/analysis/forecast-learning);
 * - `snapshots` — прогнозы, зафиксированные кроном 1-го числа, со сверкой факта;
 * - `byCompany` — то же по каждой точке, когда точка не выбрана.
 */

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function isMissingTable(error: any) {
  const message = String(error?.message || '')
  return error?.code === '42P01' || message.includes('does not exist') || message.includes('Could not find the table') || message.includes('schema cache')
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const addonDenied = await requireAddon(access, 'addon.ai')
    if (addonDenied) return addonDenied
    // /forecast слит в /analysis: пускаем с правом любой из двух страниц
    const denied = await requireAnyCapability(access, ['analysis.view', 'forecast.view'])
    if (denied) return denied

    const url = new URL(req.url)
    const rawCompanyId = url.searchParams.get('company_id')
    const selectedCompanyId = rawCompanyId && rawCompanyId !== 'all' ? rawCompanyId : null
    const organizationId = access.activeOrganization?.id || null

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: organizationId,
      requestedCompanyId: selectedCompanyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const today = kzTodayISO()
    const currentMonth = today.slice(0, 7)

    const inputs = await loadForecastInputs(supabase, {
      companyIds: companyScope.allowedCompanyIds,
      organizationId,
      isSuperAdmin: access.isSuperAdmin,
      to: today,
    })
    const main = forecastForScope({ ...inputs, today, companyId: selectedCompanyId })

    // Зафиксированные прогнозы ведутся по организации
    let snapshots: ForecastSnapshotView[] = []
    let snapshotsWarning: string | null = null
    if (organizationId) {
      const { data, error } = await supabase
        .from('forecast_snapshots')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('scope_key', selectedCompanyId || 'all')
        .order('target_month', { ascending: true })
      if (error) {
        if (!isMissingTable(error)) throw error
        snapshotsWarning =
          'Фиксация прогнозов ещё не включена: в базе нет таблицы forecast_snapshots. Примените миграцию 20260913_forecast_snapshots.sql.'
      } else {
        snapshots = ((data || []) as Record<string, any>[]).map(snapshotFromRow)
      }
    } else {
      snapshotsWarning = 'Зафиксированные прогнозы ведутся по организации — выберите организацию.'
    }

    let byCompany: ForecastByCompany[] | null = null
    if (!selectedCompanyId) {
      let companiesQuery: any = supabase.from('companies').select('id, name')
      if (companyScope.allowedCompanyIds !== null) companiesQuery = companiesQuery.in('id', companyScope.allowedCompanyIds)
      const { data: companies } = await companiesQuery
      const nameOf = new Map<string, string>(((companies || []) as any[]).map((c) => [String(c.id), String(c.name || '—')]))

      const withIncome = new Set(inputs.incomes.map((r) => r.company_id))
      byCompany = []
      for (const id of withIncome) {
        const scope = forecastForScope({ ...inputs, today, companyId: id })
        if (!scope.next.scenarios) continue
        byCompany.push({
          id,
          name: nameOf.get(id) || '—',
          scenarios: scope.next.scenarios,
          recentError: scope.next.accuracy.recentError.income,
          checks: scope.next.accuracy.checks,
        })
      }
      byCompany.sort((a, b) => b.scenarios.realistic.income - a.scenarios.realistic.income)
      if (byCompany.length < 2) byCompany = null
    }

    const payload: MonthlyForecastResponse = {
      forecast: main.monthly,
      next: main.next,
      current: {
        month: currentMonth,
        model: main.current,
        snapshot: snapshots.find((s) => s.targetMonth === currentMonth) ?? null,
      },
      snapshots,
      snapshotsWarning,
      byCompany,
    }
    return json(payload)
  } catch (error: any) {
    if (error?.message === 'company-out-of-scope') return json({ error: 'Компания недоступна' }, 403)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/monthly-forecast GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
