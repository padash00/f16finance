import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { addDaysISO } from '@/lib/core/date'
import { isExtraCompany } from '@/lib/reports/extra-company'
// `kpi.view` в каталоге прав не существует вовсе: выдать его через /access
// было нельзя, и раздел «Цели» отвечал отказом всем, кроме суперадмина.
// Права страницы называются `goals.*` — их и спрашиваем.
import { requireStaffCapability } from '@/lib/server/capabilities'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { kzTodayISO } from '@/lib/server/forecast-inputs'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * KPI планы по периодам и точкам (/goals).
 *
 * Таблица kpi_plans:
 *   - company_id (null = общий план организации)
 *   - organization_id — чей план; для общего плана обязательна
 *     (миграция 20260914_kpi_plans_organization.sql)
 *   - kind: '<period>.<metric>', например 'month.revenue', 'year.profit'.
 *   - target_amount, period_start / period_end
 *
 * Факт считается как в /reports: безнал ночной смены — на следующий день,
 * F16 Extra не входит в итоги сети (в своей карточке точки — входит), текущий
 * год — по вчерашний день по Казахстану (сегодняшние отчёты ещё не внесены).
 *
 * GET ?year=2026 — планы на год + факт; POST — upsert; DELETE ?id= или ?ids=a,b.
 */

type Metric = 'revenue' | 'profit' | 'checks' | 'avg_check' | 'margin'
type PeriodKind = 'year' | 'h1' | 'h2' | 'month'

const VALID_METRICS: Metric[] = ['revenue', 'profit', 'checks', 'avg_check', 'margin']
const VALID_PERIODS: PeriodKind[] = ['year', 'h1', 'h2', 'month']

const MIGRATION_HINT =
  'Общие цели организации ещё не включены: примените миграцию 20260914_kpi_plans_organization.sql в SQL Editor. Пока можно задать цели по точкам.'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function isMissingOrgColumn(error: any) {
  const text = `${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return error?.code === '42703' || (text.includes('organization_id') && (text.includes('does not exist') || text.includes('schema cache') || text.includes('could not find')))
}

function periodBounds(period: PeriodKind, year: number, monthIdx?: number) {
  if (period === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` }
  if (period === 'h1') return { start: `${year}-01-01`, end: `${year}-06-30` }
  if (period === 'h2') return { start: `${year}-07-01`, end: `${year}-12-31` }
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

const CHUNK = 1000
async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
  const all: T[] = []
  for (let cursor = 0; ; cursor += CHUNK) {
    const { data, error } = await buildQuery().range(cursor, cursor + CHUNK - 1)
    if (error) throw error
    const batch = (data || []) as T[]
    all.push(...batch)
    if (batch.length < CHUNK) break
  }
  return all
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'goals.view')
    if (denied) return denied

    const url = new URL(req.url)
    const today = kzTodayISO()
    const currentYear = Number(today.slice(0, 4))
    const year = parseInt(url.searchParams.get('year') || String(currentYear), 10)
    if (!Number.isFinite(year) || year < 2000 || year > 2200) return json({ error: 'invalid year' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const orgId = access.activeOrganization?.id || null
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: orgId,
      isSuperAdmin: access.isSuperAdmin,
    })

    const yearStart = `${year}-01-01`
    const yearEnd = `${year}-12-31`
    // Будущее фактом не считаем; текущий год — по вчера (сегодня отчёты ещё не внесены)
    const factEnd = year > currentYear ? addDaysISO(yearStart, -1) : year === currentYear ? addDaysISO(today, -1) : yearEnd
    const priorYear = year - 1
    const priorYearStart = `${priorYear}-01-01`
    const priorYearEnd = `${priorYear}-12-31`

    let cq = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ ok: true, data: { year, companies: [], plans: [], dailyAggregates: [], priorYearMonthly: [], priorYearDaily: [], factEnd, orgPlansAvailable: false, excludedCompanies: [] } })
      }
      cq = cq.in('id', companyScope.allowedCompanyIds)
    }

    // Планы: точек своей организации + общие планы своей организации
    const buildPlansQ = (withOrg: boolean) => {
      let q = supabase
        .from('kpi_plans')
        .select(withOrg ? 'id, company_id, organization_id, kind, target_amount, period_start, period_end' : 'id, company_id, kind, target_amount, period_start, period_end')
        .gte('period_start', yearStart)
        .lte('period_end', yearEnd)
      if (companyScope.allowedCompanyIds !== null) {
        const ids = companyScope.allowedCompanyIds.join(',')
        q = withOrg && orgId ? q.or(`company_id.in.(${ids}),and(company_id.is.null,organization_id.eq.${orgId})`) : q.in('company_id', companyScope.allowedCompanyIds)
      }
      return q
    }

    const [{ data: companiesData, error: cErr }, plansFirst] = await Promise.all([cq, buildPlansQ(true)])
    if (cErr) throw cErr
    let orgPlansAvailable = true
    let plansRes: any = plansFirst
    if (plansRes.error && isMissingOrgColumn(plansRes.error)) {
      orgPlansAvailable = false
      plansRes = await buildPlansQ(false)
    }
    if (plansRes.error) throw plansRes.error
    const plans = (plansRes.data || []) as any[]

    // Только цели, без факта — например, для недельного баланса: считать
    // доходы за два года ради сумм целей незачем
    if (url.searchParams.get('plans_only') === '1') {
      return json({
        ok: true,
        data: {
          year,
          plans: plans.map((p) => ({ id: p.id, company_id: p.company_id ?? null, kind: p.kind, target_amount: Number(p.target_amount || 0), period_start: p.period_start, period_end: p.period_end })),
        },
      })
    }

    const companies = (companiesData || []) as Array<{ id: string; name: string; code: string | null }>
    const extraIds = new Set(companies.filter(isExtraCompany).map((c) => String(c.id)))
    const inNetwork = (companyId: string | null) => !companyId || !extraIds.has(companyId)

    const scopeIn = (q: any) => (companyScope.allowedCompanyIds !== null ? q.in('company_id', companyScope.allowedCompanyIds) : q)
    const incomeCols = 'id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, card_amount, online_amount'
    const buildIncomesQ = (from: string, to: string) => () =>
      scopeIn(supabase.from('incomes').select(incomeCols).gte('date', from).lte('date', to).order('date', { ascending: true }).order('id', { ascending: true }))
    const buildExpensesQ = (from: string, to: string) => () =>
      scopeIn(supabase.from('expenses').select('id, date, company_id, cash_amount, kaspi_amount').gte('date', from).lte('date', to).order('date', { ascending: true }).order('id', { ascending: true }))
    const buildSalesQ = (from: string, to: string) => () =>
      scopeIn(supabase.from('point_sales').select('id, sale_date, company_id').gte('sale_date', from).lte('sale_date', to).order('sale_date', { ascending: true }).order('id', { ascending: true }))

    // Прошлый год и продажи прощают ошибку — страница важнее полноты сравнения,
    // а без доходов текущего года считать нечего.
    const soft = async (load: () => Promise<any[]>, area?: string): Promise<any[]> => {
      try {
        return await load()
      } catch (error: any) {
        if (area) await writeSystemErrorLogSafe({ scope: 'server', area, message: error?.message || 'fetch error' })
        return []
      }
    }

    // День до начала года: ночная смена переносит часть безнала за полночь
    const [rawIncomes, expenses, sales, priorIncomesRaw, priorExpenses, priorSales] = await Promise.all([
      fetchAll<any>(buildIncomesQ(addDaysISO(yearStart, -1), factEnd)),
      soft(() => fetchAll<any>(buildExpensesQ(yearStart, factEnd)), 'api/admin/kpi-plans:expenses'),
      soft(() => fetchAll<any>(buildSalesQ(yearStart, factEnd)), 'api/admin/kpi-plans:point_sales'),
      soft(() => fetchAll<any>(buildIncomesQ(addDaysISO(priorYearStart, -1), priorYearEnd))),
      soft(() => fetchAll<any>(buildExpensesQ(priorYearStart, priorYearEnd))),
      soft(() => fetchAll<any>(buildSalesQ(priorYearStart, priorYearEnd))),
    ])

    const inYear = (from: string, to: string) => (r: { date: string }) => r.date >= from && r.date <= to
    const facts = computeFacts({
      incomes: splitIncomeKaspiByCalendarDay(rawIncomes as ReportIncomeCalendarRow[]) as any[],
      expenses,
      sales,
    })
    facts.incomes = facts.incomes.filter(inYear(yearStart, factEnd))
    const priorFacts = computeFacts({
      incomes: splitIncomeKaspiByCalendarDay(priorIncomesRaw as ReportIncomeCalendarRow[]) as any[],
      expenses: priorExpenses,
      sales: priorSales,
    })
    priorFacts.incomes = priorFacts.incomes.filter(inYear(priorYearStart, priorYearEnd))

    const enrichedPlans = plans.map((p: any) => {
      const parsed = parseKind(p.kind)
      const factValue = computeMetricForPeriod({
        facts,
        companyId: p.company_id || null,
        inNetwork,
        start: p.period_start,
        end: p.period_end,
        metric: parsed?.metric || 'revenue',
      })
      return {
        ...p,
        organization_id: p.organization_id ?? null,
        period_kind: parsed?.period || null,
        metric: parsed?.metric || null,
        fact_value: factValue,
        achievement_pct: p.target_amount > 0 ? Math.round((factValue / Number(p.target_amount)) * 10000) / 100 : 0,
        is_closed: p.period_end <= factEnd,
      }
    })

    // Дневные ряды: по точке и «общий» (company_id = null) — без Extra
    type DayRow = { date: string; company_id: string | null; revenue: number; expenses: number; checks: number }
    const dailyRows = (source: Buckets) => {
      const map = new Map<string, DayRow>()
      const bump = (date: string, companyId: string | null, patch: Partial<Omit<DayRow, 'date' | 'company_id'>>) => {
        const keys: Array<string | null> = [companyId]
        if (companyId && inNetwork(companyId)) keys.push(null)
        for (const key of keys) {
          const mapKey = `${date}|${key || 'org'}`
          const cur = map.get(mapKey) || { date, company_id: key, revenue: 0, expenses: 0, checks: 0 }
          cur.revenue += patch.revenue || 0
          cur.expenses += patch.expenses || 0
          cur.checks += patch.checks || 0
          map.set(mapKey, cur)
        }
      }
      for (const r of source.incomes) bump(r.date, r.company_id, { revenue: r.total })
      for (const r of source.expenses) bump(r.date, r.company_id, { expenses: r.total })
      for (const r of source.sales) bump(r.date, r.company_id, { checks: 1 })
      return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date))
    }
    const dailyAggregates = dailyRows(facts)
    const priorYearDaily = dailyRows(priorFacts)

    const priorMonthlyMap = new Map<string, { company_id: string | null; month: number; revenue: number; expenses: number; checks: number }>()
    for (const r of priorYearDaily) {
      const month = Number(r.date.slice(5, 7))
      const key = `${r.company_id || 'org'}|${month}`
      const cur = priorMonthlyMap.get(key) || { company_id: r.company_id, month, revenue: 0, expenses: 0, checks: 0 }
      cur.revenue += r.revenue
      cur.expenses += r.expenses
      cur.checks += r.checks
      priorMonthlyMap.set(key, cur)
    }
    const priorYearMonthly = Array.from(priorMonthlyMap.values()).sort(
      (a, b) => (a.company_id || 'org').localeCompare(b.company_id || 'org') || a.month - b.month,
    )

    return json({
      ok: true,
      data: {
        year,
        companies,
        plans: enrichedPlans,
        dailyAggregates,
        priorYearMonthly,
        priorYearDaily: priorYearDaily.map((row) => ({ date: row.date, company_id: row.company_id, revenue: row.revenue, expenses: row.expenses })),
        factEnd,
        orgPlansAvailable: orgPlansAvailable && (Boolean(orgId) || access.isSuperAdmin),
        orgPlansHint: orgPlansAvailable ? null : MIGRATION_HINT,
        excludedCompanies: companies.filter((c) => extraIds.has(String(c.id))).map((c) => c.name),
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kpi-plans.GET', message: error?.message || 'error' })
    return json({ error: humanizeDbError(error, 'Не удалось загрузить планы') }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'goals.create')
    if (denied) return denied

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

    const orgId = access.activeOrganization?.id || null
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    // Изоляция. План точки — только точки своей организации. Общий план —
    // только своей организации: без неё (не суперадмин) задавать его некому.
    let planOrgId: string | null = orgId
    if (companyId) {
      try {
        await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin, requestedCompanyId: companyId })
      } catch {
        return json({ error: 'forbidden' }, 403)
      }
      const { data: company } = await supabase.from('companies').select('organization_id').eq('id', companyId).maybeSingle()
      planOrgId = (company as any)?.organization_id || orgId
    } else if (!access.isSuperAdmin && !orgId) {
      return json({ error: 'Нет активной организации' }, 400)
    }

    const { start, end } = periodBounds(periodKind, year, monthIdx)
    const kind = `${periodKind}.${metric}`
    const actorUserId = ('user' in access ? access.user?.id : null) || null

    // Существующий план с тем же ключом
    let existingQ = supabase.from('kpi_plans').select('id').eq('period_start', start).eq('kind', kind).limit(1)
    if (companyId) existingQ = existingQ.eq('company_id', companyId)
    else existingQ = planOrgId ? existingQ.is('company_id', null).eq('organization_id', planOrgId) : existingQ.is('company_id', null).is('organization_id', null)
    const { data: existing, error: existErr } = await existingQ.maybeSingle()
    if (existErr) {
      if (!companyId && isMissingOrgColumn(existErr)) return json({ error: MIGRATION_HINT }, 409)
      throw existErr
    }

    if (existing) {
      const { data, error } = await supabase
        .from('kpi_plans')
        .update({ target_amount: target, period_end: end })
        .eq('id', (existing as any).id)
        .select('*')
        .single()
      if (error) throw error
      await writeAuditLog(supabase as any, { actorUserId, entityType: 'kpi-plan', entityId: String((existing as any).id), action: 'update', payload: { kind, target } })
      return json({ ok: true, data })
    }

    // plan_key/month_start/entity_type — legacy-колонки части баз: заполняем,
    // а если колонки нет — убираем из вставки. organization_id у плана точки
    // тоже можно убрать (до миграции), у общего плана — нельзя: без него
    // план снова стал бы виден всем организациям.
    const planKey = [planOrgId || 'global', companyId || 'org', kind, start].join('|')
    const optionalCols = ['plan_key', 'month_start', 'entity_type', ...(companyId ? ['organization_id'] : [])]
    const entityTypeFallbacks = ['kpi_plan', 'kpi', 'goal', 'plan', 'budget']
    let entityTypeIdx = 0
    let attempt: Record<string, unknown> = {
      company_id: companyId,
      organization_id: planOrgId,
      kind,
      target_amount: target,
      period_start: start,
      period_end: end,
      created_by: actorUserId,
      plan_key: planKey,
      month_start: start,
      entity_type: entityTypeFallbacks[0],
    }
    let inserted: any = null
    let uniqueRetry = false
    while (true) {
      const res = await supabase.from('kpi_plans').insert([attempt]).select('*').single()
      if (!res.error) {
        inserted = res.data
        break
      }
      const code = String((res.error as any)?.code || '')
      const combined = `${res.error?.message || ''} ${(res.error as any)?.details || ''}`.toLowerCase()

      if (combined.includes('does not exist') || combined.includes('schema cache') || combined.includes('could not find the')) {
        const offending = optionalCols.find((col) => combined.includes(col) && col in attempt)
        if (offending) {
          delete attempt[offending]
          continue
        }
        if (!companyId && isMissingOrgColumn(res.error)) return json({ error: MIGRATION_HINT }, 409)
      }

      if (combined.includes('check constraint') && combined.includes('entity_type') && 'entity_type' in attempt) {
        entityTypeIdx += 1
        if (entityTypeIdx < entityTypeFallbacks.length) attempt = { ...attempt, entity_type: entityTypeFallbacks[entityTypeIdx] }
        else delete attempt.entity_type
        continue
      }

      // Запись уже есть по legacy-ключу — обновляем найденную
      const isUnique = code === '23505' || combined.includes('duplicate key') || combined.includes('unique constraint')
      if (isUnique && !uniqueRetry) {
        uniqueRetry = true
        let foundId: string | null = null
        try {
          const byKey = await supabase.from('kpi_plans').select('id').eq('plan_key', planKey).limit(1).maybeSingle()
          if (!byKey.error && byKey.data) foundId = (byKey.data as any).id
        } catch {}
        if (!foundId && companyId) {
          const byBiz = await supabase.from('kpi_plans').select('id').eq('period_start', start).eq('kind', kind).eq('company_id', companyId).limit(1).maybeSingle()
          if (!byBiz.error && byBiz.data) foundId = (byBiz.data as any).id
        }
        if (foundId) {
          const upd = await supabase.from('kpi_plans').update({ target_amount: target, period_end: end }).eq('id', foundId).select('*').single()
          if (upd.error) throw upd.error
          await writeAuditLog(supabase as any, { actorUserId, entityType: 'kpi-plan', entityId: String(foundId), action: 'update', payload: { kind, target } })
          return json({ ok: true, data: upd.data })
        }
      }

      throw res.error
    }

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'kpi-plan',
      entityId: String(inserted?.id || ''),
      action: 'create',
      payload: { kind, target, period_start: start, period_end: end, company_id: companyId },
    })

    return json({ ok: true, data: inserted })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kpi-plans.POST', message: error?.message || 'error' })
    return json({ error: humanizeDbError(error, 'Не удалось сохранить план') }, 500)
  }
}

export async function DELETE(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'goals.delete')
    if (denied) return denied

    const url = new URL(req.url)
    const ids = Array.from(
      new Set(
        [url.searchParams.get('id') || '', ...(url.searchParams.get('ids') || '').split(',')]
          .map((s) => s.trim())
          .filter(Boolean),
      ),
    ).slice(0, 100)
    if (!ids.length) return json({ error: 'id required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    // Изоляция: план точки — своей организации; общий план — только своей
    // организации (до миграции общий план ни к кому не привязан → только суперадмин)
    if (!access.isSuperAdmin) {
      let rows: any[] | null = null
      const withOrg = await supabase.from('kpi_plans').select('id, company_id, organization_id').in('id', ids)
      if (withOrg.error) {
        if (!isMissingOrgColumn(withOrg.error)) throw withOrg.error
        const plain = await supabase.from('kpi_plans').select('id, company_id').in('id', ids)
        if (plain.error) throw plain.error
        rows = plain.data || []
      } else {
        rows = withOrg.data || []
      }
      if (rows.length !== ids.length) return json({ error: 'not-found' }, 404)
      const orgId = access.activeOrganization?.id || null
      const scope = await resolveCompanyScope({ activeOrganizationId: orgId, isSuperAdmin: access.isSuperAdmin })
      for (const plan of rows) {
        const cId = plan.company_id ? String(plan.company_id) : null
        const allowed = cId
          ? !scope.allowedCompanyIds || scope.allowedCompanyIds.includes(cId)
          : Boolean(orgId) && plan.organization_id === orgId
        if (!allowed) return json({ error: 'forbidden' }, 403)
      }
    }

    const { error } = await supabase.from('kpi_plans').delete().in('id', ids)
    if (error) throw error

    await writeAuditLog(supabase as any, {
      actorUserId: access.user?.id || null,
      entityType: 'kpi-plan',
      entityId: ids[0],
      action: 'delete',
      payload: { ids },
    })

    return json({ ok: true, deleted: ids.length })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kpi-plans.DELETE', message: error?.message || 'error' })
    return json({ error: humanizeDbError(error, 'Не удалось удалить') }, 500)
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

type Buckets = {
  incomes: Array<{ date: string; company_id: string | null; total: number }>
  expenses: Array<{ date: string; company_id: string | null; total: number }>
  sales: Array<{ date: string; company_id: string | null }>
}

function computeFacts(params: { incomes: any[]; expenses: any[]; sales: any[] }): Buckets {
  return {
    incomes: params.incomes.map((r) => ({
      date: String(r.date || ''),
      company_id: r.company_id || null,
      total: Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0),
    })),
    expenses: params.expenses.map((r) => ({
      date: String(r.date || ''),
      company_id: r.company_id || null,
      total: Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0),
    })),
    sales: params.sales.map((r) => ({ date: String(r.sale_date || ''), company_id: r.company_id || null })),
  }
}

function computeMetricForPeriod(params: {
  facts: Buckets
  companyId: string | null
  inNetwork: (companyId: string | null) => boolean
  start: string
  end: string
  metric: Metric
}): number {
  const match = (row: { date: string; company_id: string | null }) =>
    row.date >= params.start &&
    row.date <= params.end &&
    (params.companyId == null ? params.inNetwork(row.company_id) : row.company_id === params.companyId)

  const revenue = params.facts.incomes.filter(match).reduce((s, r) => s + r.total, 0)
  if (params.metric === 'revenue') return Math.round(revenue * 100) / 100

  const expenses = params.facts.expenses.filter(match).reduce((s, r) => s + r.total, 0)
  if (params.metric === 'profit') return Math.round((revenue - expenses) * 100) / 100
  if (params.metric === 'margin') return revenue > 0 ? Math.round(((revenue - expenses) / revenue) * 10000) / 100 : 0

  const checks = params.facts.sales.filter(match).length
  if (params.metric === 'checks') return checks
  if (params.metric === 'avg_check') return checks > 0 ? Math.round(revenue / checks) : 0
  return 0
}
