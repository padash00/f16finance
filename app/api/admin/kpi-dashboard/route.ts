import { NextResponse } from 'next/server'

import { calculateForecast, type CompanyCode } from '@/lib/kpiEngine'
import { requireCapability } from '@/lib/server/capabilities'
import { listOrganizationOperatorIds, resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type KpiRow = {
  plan_key: string
  month_start: string
  entity_type: 'collective' | 'operator' | 'role'
  company_code: string | null
  operator_id: string | null
  role_code: string | null
  turnover_target_month: number
  turnover_target_week: number
  shifts_target_month: number
  shifts_target_week: number
  meta: unknown
  is_locked: boolean
}

type IncomeRow = {
  date: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  operator_id?: string | null
  companies?: { code?: string | null } | null
}

type GenerateBody = {
  action?: 'generateCollectivePlans'
  monthStart?: string
}

const COMPANIES: CompanyCode[] = ['arena', 'ramen', 'extra']
const WEEKS_IN_MONTH = 4.345

// PostgREST режет ответ до 1000 строк — периодные выборки incomes забираем
// постранично, иначе планы/факты KPI считаются по обрезанным данным.
const PAGE = 1000
async function fetchAllPages(buildQuery: (from: number, to: number) => any): Promise<any[]> {
  const out: any[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canAccessKpi(access: {
  isSuperAdmin: boolean
  staffRole: string
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

function normalizeMonthStart(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}$/.test(trimmed)) return `${trimmed}-01`
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return `${trimmed.slice(0, 7)}-01`
  return null
}

function normalizeIsoDate(value: string | null | undefined) {
  if (!value) return null
  const trimmed = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null
  return trimmed
}

function parseLocalDate(dateStr: string) {
  const [year, month, day] = String(dateStr).slice(0, 10).split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}

function iso(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function endOfMonth(monthStart: string) {
  const start = parseLocalDate(monthStart)
  return iso(new Date(start.getFullYear(), start.getMonth() + 1, 0))
}

function getMonthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'kpi.view')
    if (denied) return denied as any
    if (!canAccessKpi(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(req.url)
    const monthStart = normalizeMonthStart(url.searchParams.get('monthStart'))
    const weekStart = normalizeIsoDate(url.searchParams.get('weekStart'))
    const weekEnd = normalizeIsoDate(url.searchParams.get('weekEnd'))

    if (!monthStart || !weekStart || !weekEnd) {
      return json({ error: 'monthStart, weekStart и weekEnd обязательны' }, 400)
    }

    const monthEnd = endOfMonth(monthStart)
    const target = parseLocalDate(monthStart)
    const prev1 = new Date(target.getFullYear(), target.getMonth() - 1, 1)
    const prev2 = new Date(target.getFullYear(), target.getMonth() - 2, 1)
    const fetchStart = `${getMonthKey(prev2)}-01`
    const fetchEnd = iso(new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0))

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const buildIncomesMonthQuery = (from: number, to: number) => {
      let q = supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, operator_id, companies!inner(code)')
        .gte('date', monthStart)
        .lte('date', monthEnd)
        .order('date', { ascending: true }).order('id', { ascending: true })
        .range(from, to)
      if (scope.allowedCompanyIds) q = q.in('company_id', scope.allowedCompanyIds)
      return q
    }
    const buildIncomesWeekQuery = (from: number, to: number) => {
      let q = supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, operator_id, companies!inner(code)')
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .order('date', { ascending: true }).order('id', { ascending: true })
        .range(from, to)
      if (scope.allowedCompanyIds) q = q.in('company_id', scope.allowedCompanyIds)
      return q
    }
    const buildHistQuery = (from: number, to: number) => {
      let q = supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code)')
        .gte('date', fetchStart)
        .lte('date', fetchEnd)
        .order('date', { ascending: true }).order('id', { ascending: true })
        .range(from, to)
      if (scope.allowedCompanyIds) q = q.in('company_id', scope.allowedCompanyIds)
      return q
    }

    const [{ data: plans, error: plansError }, incomesMonth, incomesWeek, hist] =
      await Promise.all([
        supabase.from('kpi_plans').select('*').eq('month_start', monthStart).eq('entity_type', 'collective'),
        fetchAllPages(buildIncomesMonthQuery),
        fetchAllPages(buildIncomesWeekQuery),
        fetchAllPages(buildHistQuery),
      ])

    if (plansError) throw plansError

    const operatorIds = new Set<string>()
    for (const row of ((incomesWeek || []) as IncomeRow[])) {
      if (row.operator_id) operatorIds.add(row.operator_id)
    }
    for (const row of ((incomesMonth || []) as IncomeRow[])) {
      if (row.operator_id) operatorIds.add(row.operator_id)
    }

    let operatorNames: Record<string, string> = {}
    if (operatorIds.size > 0) {
      let operatorIdsToFetch = Array.from(operatorIds)
      if (scope.allowedCompanyIds) {
        const allowedOperatorIds = new Set(
          await listOrganizationOperatorIds({
            activeOrganizationId: access.activeOrganization?.id || null,
            isSuperAdmin: access.isSuperAdmin,
          }),
        )
        operatorIdsToFetch = operatorIdsToFetch.filter((id) => allowedOperatorIds.has(id))
      }

      const { data: operatorsData, error: operatorsError } = await supabase
        .from('operators')
        .select('id, name')
        .in('id', operatorIdsToFetch)

      if (operatorsError) throw operatorsError

      operatorNames = Object.fromEntries(((operatorsData || []) as Array<{ id: string; name: string }>).map((item) => [item.id, item.name]))
    }

    const weekdayShare: Record<CompanyCode, number> = { arena: 4 / 7, ramen: 4 / 7, extra: 4 / 7 }
    const shareAgg: Record<CompanyCode, { wd: number; we: number }> = {
      arena: { wd: 0, we: 0 },
      ramen: { wd: 0, we: 0 },
      extra: { wd: 0, we: 0 },
    }

    for (const row of ((hist || []) as IncomeRow[])) {
      const companyCode = String(row.companies?.code || '').toLowerCase() as CompanyCode
      if (!COMPANIES.includes(companyCode)) continue
      const amount = Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0) + Number(row.card_amount || 0)
      const day = parseLocalDate(row.date).getDay()
      const key = day >= 1 && day <= 4 ? 'wd' : 'we'
      shareAgg[companyCode][key] += amount
    }

    for (const company of COMPANIES) {
      const total = shareAgg[company].wd + shareAgg[company].we
      weekdayShare[company] = total > 0 ? shareAgg[company].wd / total : 4 / 7
    }

    return json({
      collectivePlans: plans || [],
      weekRows: incomesWeek || [],
      monthRows: incomesMonth || [],
      weekdayShare,
      operatorNames,
    })
  } catch (error: any) {
    console.error('Admin KPI dashboard GET error', error)
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'kpi.edit')
    if (denied) return denied as any
    if (!canAccessKpi(access)) return json({ error: 'forbidden' }, 403)

    const body = (await req.json().catch(() => null)) as GenerateBody | null
    if (body?.action !== 'generateCollectivePlans') {
      return json({ error: 'unsupported-action' }, 400)
    }

    const monthStart = normalizeMonthStart(body.monthStart)
    if (!monthStart) {
      return json({ error: 'monthStart обязателен в формате YYYY-MM' }, 400)
    }

    const target = parseLocalDate(monthStart)
    const prev1 = new Date(target.getFullYear(), target.getMonth() - 1, 1)
    const prev2 = new Date(target.getFullYear(), target.getMonth() - 2, 1)
    const prev1Key = getMonthKey(prev1)
    const prev2Key = getMonthKey(prev2)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const incomes = await fetchAllPages((from, to) => {
      let q = supabase
        .from('incomes')
        .select('date, cash_amount, kaspi_amount, card_amount, companies!inner(code)')
        .gte('date', `${prev2Key}-01`)
        .lte('date', iso(new Date(prev1.getFullYear(), prev1.getMonth() + 1, 0)))
        .order('date', { ascending: true }).order('id', { ascending: true })
        .range(from, to)
      if (scope.allowedCompanyIds) q = q.in('company_id', scope.allowedCompanyIds)
      return q
    })

    const sums: Record<CompanyCode, { t1: number; t2: number }> = {
      arena: { t1: 0, t2: 0 },
      ramen: { t1: 0, t2: 0 },
      extra: { t1: 0, t2: 0 },
    }

    for (const row of ((incomes || []) as IncomeRow[])) {
      const companyCode = String(row.companies?.code || '').toLowerCase() as CompanyCode
      if (!COMPANIES.includes(companyCode)) continue

      const amount = Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0) + Number(row.card_amount || 0)
      const monthKey = String(row.date).slice(0, 7)
      if (monthKey === prev2Key) sums[companyCode].t2 += amount
      if (monthKey === prev1Key) sums[companyCode].t1 += amount
    }

    const rows: KpiRow[] = COMPANIES.map((companyCode) => {
      const calc = calculateForecast(target, sums[companyCode].t1, sums[companyCode].t2)
      const targetMonth = Math.round(calc.forecast)
      const targetWeek = Math.round(targetMonth / WEEKS_IN_MONTH)

      return {
        plan_key: `${monthStart}|collective|${companyCode}`,
        month_start: monthStart,
        entity_type: 'collective',
        company_code: companyCode,
        operator_id: null,
        role_code: null,
        turnover_target_month: targetMonth,
        turnover_target_week: targetWeek,
        shifts_target_month: 0,
        shifts_target_week: 0,
        meta: {
          prev2: Math.round(sums[companyCode].t2),
          prev1_est: Math.round(calc.prev1Estimated),
          trend: calc.trend.toFixed(1),
          generated_via: 'api/admin/kpi-dashboard',
        },
        is_locked: false,
      }
    })

    const { error: upsertError } = await supabase.from('kpi_plans').upsert(rows, { onConflict: 'plan_key' })
    if (upsertError) throw upsertError

    return json({ ok: true, rows })
  } catch (error: any) {
    console.error('Admin KPI dashboard POST error', error)
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
