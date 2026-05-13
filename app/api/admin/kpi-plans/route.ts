import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * KPI планы по периодам и точкам.
 *
 * Используется таблица kpi_plans:
 *   - company_id (null = общий по организации)
 *   - kind: формат '<period>.<metric>', например 'month.revenue', 'year.profit',
 *           'h1.checks', 'h2.avg_check'. Допустимые period: year, h1, h2, month.
 *           Допустимые metric: revenue, profit, checks, avg_check, margin.
 *   - target_amount
 *   - period_start / period_end
 *
 * GET ?year=2026 — возвращает список планов на год + рассчитанный факт по каждому.
 * POST — upsert (company_id+period_start+kind уникальна по факту).
 * DELETE ?id=... — удалить.
 */

type Metric = 'revenue' | 'profit' | 'checks' | 'avg_check' | 'margin'
type PeriodKind = 'year' | 'h1' | 'h2' | 'month'

const VALID_METRICS: Metric[] = ['revenue', 'profit', 'checks', 'avg_check', 'margin']
const VALID_PERIODS: PeriodKind[] = ['year', 'h1', 'h2', 'month']

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function periodBounds(period: PeriodKind, year: number, monthIdx?: number) {
  if (period === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` }
  if (period === 'h1') return { start: `${year}-01-01`, end: `${year}-06-30` }
  if (period === 'h2') return { start: `${year}-07-01`, end: `${year}-12-31` }
  // month: monthIdx 0..11
  const m = String((monthIdx || 0) + 1).padStart(2, '0')
  const last = new Date(year, (monthIdx || 0) + 1, 0).getDate()
  return { start: `${year}-${m}-01`, end: `${year}-${m}-${String(last).padStart(2, '0')}` }
}

function parseKind(kind: string): { period: PeriodKind; metric: Metric } | null {
  const [p, m] = String(kind || '').split('.')
  if (!VALID_PERIODS.includes(p as PeriodKind)) return null
  if (!VALID_METRICS.includes(m as Metric)) return null
  return { period: p as PeriodKind, metric: m as Metric }
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const year = parseInt(url.searchParams.get('year') || String(new Date().getFullYear()), 10)
    if (!Number.isFinite(year) || year < 2000 || year > 2200) return json({ error: 'invalid year' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const yearStart = `${year}-01-01`
    const yearEnd = `${year}-12-31`

    // Companies
    let cq = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ ok: true, data: { year, companies: [], plans: [], facts: {} } })
      }
      cq = cq.in('id', companyScope.allowedCompanyIds)
    }
    const { data: companies, error: cErr } = await cq
    if (cErr) throw cErr

    // Plans — на год и пересекающиеся (year/h1/h2/months)
    let pq = supabase
      .from('kpi_plans')
      .select('id, company_id, kind, target_amount, period_start, period_end')
      .gte('period_start', yearStart)
      .lte('period_end', yearEnd)
    if (companyScope.allowedCompanyIds !== null) {
      // company_id IS NULL (общий) OR в списке доступных
      const allowed = companyScope.allowedCompanyIds.join(',')
      pq = pq.or(`company_id.is.null,company_id.in.(${allowed})`)
    }
    const { data: plans, error: pErr } = await pq
    if (pErr) throw pErr

    // Facts — incomes/expenses/point_sales за год
    let incomesQ = supabase
      .from('incomes')
      .select('date, company_id, cash_amount, kaspi_amount, card_amount, online_amount')
      .gte('date', yearStart)
      .lte('date', yearEnd)
    if (companyScope.allowedCompanyIds !== null) incomesQ = incomesQ.in('company_id', companyScope.allowedCompanyIds)
    const { data: incomes, error: iErr } = await incomesQ
    if (iErr) throw iErr

    let expensesQ = supabase
      .from('expenses')
      .select('date, company_id, cash_amount, kaspi_amount')
      .gte('date', yearStart)
      .lte('date', yearEnd)
    if (companyScope.allowedCompanyIds !== null) expensesQ = expensesQ.in('company_id', companyScope.allowedCompanyIds)
    const { data: expenses, error: eErr } = await expensesQ
    if (eErr) {
      await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kpi-plans:expenses', message: eErr.message })
    }

    let salesQ = supabase
      .from('point_sales')
      .select('sale_date, company_id, total_amount')
      .gte('sale_date', yearStart)
      .lte('sale_date', yearEnd)
    if (companyScope.allowedCompanyIds !== null) salesQ = salesQ.in('company_id', companyScope.allowedCompanyIds)
    const { data: sales, error: sErr } = await salesQ
    if (sErr) {
      await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kpi-plans:point_sales', message: sErr.message })
    }

    // Агрегаторы: ключ '${companyId}|${start}|${end}' (companyId = '' для общего)
    const facts = computeFacts({
      incomes: (incomes || []) as any[],
      expenses: (expenses || []) as any[],
      sales: (sales || []) as any[],
    })

    // Для каждого плана — посчитать факт за его период (общий или по компании)
    const enrichedPlans = (plans || []).map((p: any) => {
      const parsed = parseKind(p.kind)
      const factValue = computeMetricForPeriod({
        facts,
        companyId: p.company_id || null,
        start: p.period_start,
        end: p.period_end,
        metric: parsed?.metric || 'revenue',
      })
      return {
        ...p,
        period_kind: parsed?.period || null,
        metric: parsed?.metric || null,
        fact_value: factValue,
        achievement_pct: p.target_amount > 0 ? Math.round((factValue / Number(p.target_amount)) * 10000) / 100 : 0,
        is_closed: new Date(`${p.period_end}T23:59:59Z`).getTime() < Date.now(),
      }
    })

    return json({
      ok: true,
      data: {
        year,
        companies: companies || [],
        plans: enrichedPlans,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/kpi-plans.GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось загрузить планы' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const body = await req.json().catch(() => null)
    const companyId: string | null = body?.company_id || null
    const periodKind: PeriodKind = body?.period_kind
    const metric: Metric = body?.metric
    const target = Number(body?.target_amount || 0)
    const year = Number(body?.year || new Date().getFullYear())
    const monthIdx = body?.month_idx != null ? Number(body.month_idx) : undefined

    if (!VALID_PERIODS.includes(periodKind)) return json({ error: 'invalid period_kind' }, 400)
    if (!VALID_METRICS.includes(metric)) return json({ error: 'invalid metric' }, 400)
    if (!Number.isFinite(target) || target < 0) return json({ error: 'invalid target_amount' }, 400)

    if (companyId) {
      await resolveCompanyScope({
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
        requestedCompanyId: companyId,
      })
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const { start, end } = periodBounds(periodKind, year, monthIdx)
    const kind = `${periodKind}.${metric}`

    // upsert: ищем существующий план с теми же company_id, period_start, kind
    const existingQ = supabase
      .from('kpi_plans')
      .select('id')
      .eq('period_start', start)
      .eq('kind', kind)
      .limit(1)
    const filteredQ = companyId
      ? existingQ.eq('company_id', companyId)
      : existingQ.is('company_id', null)

    const { data: existing, error: existErr } = await filteredQ.maybeSingle()
    if (existErr) throw existErr

    if (existing) {
      const { data, error } = await supabase
        .from('kpi_plans')
        .update({ target_amount: target, period_end: end })
        .eq('id', (existing as any).id)
        .select('*')
        .single()
      if (error) throw error
      await writeAuditLog(supabase as any, {
        actorUserId: access.user?.id || null,
        entityType: 'kpi-plan',
        entityId: String((existing as any).id),
        action: 'update',
        payload: { kind, target },
      })
      return json({ ok: true, data })
    }

    const { data, error } = await supabase
      .from('kpi_plans')
      .insert([{
        company_id: companyId,
        kind,
        target_amount: target,
        period_start: start,
        period_end: end,
        created_by: access.user?.id || null,
      }])
      .select('*')
      .single()
    if (error) throw error

    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      entityType: 'kpi-plan',
      entityId: String((data as any).id),
      action: 'create',
      payload: { kind, target, period_start: start, period_end: end },
    })

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/kpi-plans.POST',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось сохранить план' }, 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const id = String(url.searchParams.get('id') || '').trim()
    if (!id) return json({ error: 'id required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const { error } = await supabase.from('kpi_plans').delete().eq('id', id)
    if (error) throw error

    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      entityType: 'kpi-plan',
      entityId: id,
      action: 'delete',
      payload: {},
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/kpi-plans.DELETE',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось удалить' }, 500)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Buckets = {
  incomes: Array<{ date: string; company_id: string | null; total: number }>
  expenses: Array<{ date: string; company_id: string | null; total: number }>
  sales: Array<{ date: string; company_id: string | null; total: number }>
}

function computeFacts(params: {
  incomes: any[]
  expenses: any[]
  sales: any[]
}): Buckets {
  return {
    incomes: params.incomes.map((r) => ({
      date: String(r.date || ''),
      company_id: r.company_id || null,
      total:
        Number(r.cash_amount || 0) +
        Number(r.kaspi_amount || 0) +
        Number(r.card_amount || 0) +
        Number(r.online_amount || 0),
    })),
    expenses: params.expenses.map((r) => ({
      date: String(r.date || ''),
      company_id: r.company_id || null,
      total: Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0),
    })),
    sales: params.sales.map((r) => ({
      date: String(r.sale_date || ''),
      company_id: r.company_id || null,
      total: Number(r.total_amount || 0),
    })),
  }
}

function inRange(date: string, start: string, end: string) {
  return date >= start && date <= end
}

function computeMetricForPeriod(params: {
  facts: Buckets
  companyId: string | null
  start: string
  end: string
  metric: Metric
}): number {
  const matchCompany = (rowCompany: string | null) =>
    params.companyId == null ? true : rowCompany === params.companyId

  const revenue = params.facts.incomes
    .filter((r) => inRange(r.date, params.start, params.end) && matchCompany(r.company_id))
    .reduce((s, r) => s + r.total, 0)

  if (params.metric === 'revenue') return Math.round(revenue * 100) / 100

  const expenses = params.facts.expenses
    .filter((r) => inRange(r.date, params.start, params.end) && matchCompany(r.company_id))
    .reduce((s, r) => s + r.total, 0)

  if (params.metric === 'profit') return Math.round((revenue - expenses) * 100) / 100
  if (params.metric === 'margin') return revenue > 0 ? Math.round(((revenue - expenses) / revenue) * 10000) / 100 : 0

  const checks = params.facts.sales
    .filter((r) => inRange(r.date, params.start, params.end) && matchCompany(r.company_id))
    .reduce((s) => s + 1, 0)

  if (params.metric === 'checks') return checks
  if (params.metric === 'avg_check') return checks > 0 ? Math.round(revenue / checks) : 0

  return 0
}
