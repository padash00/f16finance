import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { addDaysISO } from '@/lib/core/date'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
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
    const denied = await requireStaffCapability(access, 'kpi.view')
    if (denied) return denied

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
    const todayIso = new Date().toISOString().slice(0, 10)
    const currentYear = new Date().getFullYear()
    // Для текущего года не считаем будущее как факт — обрезаем до сегодня
    // (как делает /api/admin/reports/bundle). Для прошлых годов — полный год.
    const factEnd = year >= currentYear ? todayIso : `${year}-12-31`
    // Для запроса планов — всегда полный год, иначе планы текущего месяца
    // (например period_end=2026-05-31 при сегодня=2026-05-13) выпадают.
    const yearEnd = `${year}-12-31`
    // На 1 день шире, чтоб поймать ночной kaspi с 31.12 прошлого года.
    const incomeFetchFrom = addDaysISO(yearStart, -1)
    // Прошлогодний диапазон для сезонности.
    const priorYear = year - 1
    const priorYearStart = `${priorYear}-01-01`
    const priorYearEnd = `${priorYear}-12-31`
    const priorIncomeFrom = addDaysISO(priorYearStart, -1)

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

    // Facts — incomes/expenses/point_sales за год (с late-night kaspi split).
    // ВАЖНО: PostgREST max-rows = 1000. Без пагинации режется → расходы
    // недосчитываются и прибыль завышается. Тянем чанками по 1000.
    const CHUNK = 1000

    async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
      const all: T[] = []
      let cursor = 0
      while (true) {
        const upper = cursor + CHUNK - 1
        const { data, error } = await buildQuery().range(cursor, upper)
        if (error) throw error
        const batch = (data || []) as T[]
        all.push(...batch)
        if (batch.length < CHUNK) break
        cursor += CHUNK
      }
      return all
    }

    const buildIncomesQ = () => {
      let q = supabase
        .from('incomes')
        .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, card_amount, online_amount, comment')
        .gte('date', incomeFetchFrom)
        .lte('date', factEnd)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }
    const buildExpensesQ = () => {
      let q = supabase
        .from('expenses')
        .select('date, company_id, cash_amount, kaspi_amount')
        .gte('date', yearStart)
        .lte('date', factEnd)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }
    const buildSalesQ = () => {
      let q = supabase
        .from('point_sales')
        .select('sale_date, company_id, total_amount')
        .gte('sale_date', yearStart)
        .lte('sale_date', factEnd)
        .order('sale_date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }

    const rawIncomes = await fetchAll<any>(buildIncomesQ)
    const incomes = splitIncomeKaspiByCalendarDay(rawIncomes as ReportIncomeCalendarRow[])

    let expenses: any[] = []
    try {
      expenses = await fetchAll<any>(buildExpensesQ)
    } catch (eErr: any) {
      await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kpi-plans:expenses', message: eErr?.message || 'expenses fetch error' })
    }

    let sales: any[] = []
    try {
      sales = await fetchAll<any>(buildSalesQ)
    } catch (sErr: any) {
      await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/kpi-plans:point_sales', message: sErr?.message || 'sales fetch error' })
    }

    // Прошлогодние факты — для сезонности и YoY. Тянем без жёсткой обвязки:
    // если упадёт — просто отдадим пустые данные, не ломаем основную выдачу.
    const buildPriorIncomesQ = () => {
      let q = supabase
        .from('incomes')
        .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, card_amount, online_amount, comment')
        .gte('date', priorIncomeFrom)
        .lte('date', priorYearEnd)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }
    const buildPriorExpensesQ = () => {
      let q = supabase
        .from('expenses')
        .select('date, company_id, cash_amount, kaspi_amount')
        .gte('date', priorYearStart)
        .lte('date', priorYearEnd)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }
    const buildPriorSalesQ = () => {
      let q = supabase
        .from('point_sales')
        .select('sale_date, company_id, total_amount')
        .gte('sale_date', priorYearStart)
        .lte('sale_date', priorYearEnd)
        .order('sale_date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }

    let priorIncomesRaw: any[] = []
    let priorExpenses: any[] = []
    let priorSales: any[] = []
    try { priorIncomesRaw = await fetchAll<any>(buildPriorIncomesQ) } catch {}
    try { priorExpenses = await fetchAll<any>(buildPriorExpensesQ) } catch {}
    try { priorSales = await fetchAll<any>(buildPriorSalesQ) } catch {}
    const priorIncomes = splitIncomeKaspiByCalendarDay(priorIncomesRaw as ReportIncomeCalendarRow[])

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

    // Дневные агрегаты для графиков динамики плана.
    // Возвращаем массив {date, company_id|null('org' для общего), revenue, expenses, checks}.
    const dailyMap = new Map<string, {
      date: string
      company_id: string | null
      revenue: number
      expenses: number
      checks: number
    }>()
    const bump = (date: string, companyId: string | null, patch: { revenue?: number; expenses?: number; checks?: number }) => {
      const key = `${date}|${companyId || 'org'}`
      const cur = dailyMap.get(key) || { date, company_id: companyId, revenue: 0, expenses: 0, checks: 0 }
      cur.revenue += patch.revenue || 0
      cur.expenses += patch.expenses || 0
      cur.checks += patch.checks || 0
      dailyMap.set(key, cur)
      // Дублируем как «общий» (company_id=null) для агрегации
      if (companyId) {
        const orgKey = `${date}|org`
        const orgCur = dailyMap.get(orgKey) || { date, company_id: null, revenue: 0, expenses: 0, checks: 0 }
        orgCur.revenue += patch.revenue || 0
        orgCur.expenses += patch.expenses || 0
        orgCur.checks += patch.checks || 0
        dailyMap.set(orgKey, orgCur)
      }
    }
    for (const r of facts.incomes) bump(r.date, r.company_id, { revenue: r.total })
    for (const r of facts.expenses) bump(r.date, r.company_id, { expenses: r.total })
    for (const r of facts.sales) bump(r.date, r.company_id, { checks: 1, revenue: 0 })
    const dailyAggregates = Array.from(dailyMap.values()).sort((a, b) => a.date.localeCompare(b.date))

    // Прошлогодние месячные итоги — для сезонности и YoY.
    // Формат: для каждой пары (company_id|null, month 1..12) — revenue/expenses/checks.
    const priorFacts = computeFacts({
      incomes: (priorIncomes || []) as any[],
      expenses: (priorExpenses || []) as any[],
      sales: (priorSales || []) as any[],
    })
    const priorMonthlyMap = new Map<string, {
      company_id: string | null
      month: number
      revenue: number
      expenses: number
      checks: number
    }>()
    const monthOf = (date: string) => Number(String(date || '').slice(5, 7))
    const bumpPrior = (m: number, companyId: string | null, patch: { revenue?: number; expenses?: number; checks?: number }) => {
      if (m < 1 || m > 12) return
      const key = `${companyId || 'org'}|${m}`
      const cur = priorMonthlyMap.get(key) || { company_id: companyId, month: m, revenue: 0, expenses: 0, checks: 0 }
      cur.revenue += patch.revenue || 0
      cur.expenses += patch.expenses || 0
      cur.checks += patch.checks || 0
      priorMonthlyMap.set(key, cur)
      if (companyId) {
        const orgKey = `org|${m}`
        const orgCur = priorMonthlyMap.get(orgKey) || { company_id: null, month: m, revenue: 0, expenses: 0, checks: 0 }
        orgCur.revenue += patch.revenue || 0
        orgCur.expenses += patch.expenses || 0
        orgCur.checks += patch.checks || 0
        priorMonthlyMap.set(orgKey, orgCur)
      }
    }
    for (const r of priorFacts.incomes) bumpPrior(monthOf(r.date), r.company_id, { revenue: r.total })
    for (const r of priorFacts.expenses) bumpPrior(monthOf(r.date), r.company_id, { expenses: r.total })
    for (const r of priorFacts.sales) bumpPrior(monthOf(r.date), r.company_id, { checks: 1 })
    const priorYearMonthly = Array.from(priorMonthlyMap.values()).sort((a, b) =>
      (a.company_id || 'org').localeCompare(b.company_id || 'org') || a.month - b.month,
    )

    return json({
      ok: true,
      data: {
        year,
        companies: companies || [],
        plans: enrichedPlans,
        dailyAggregates,
        priorYearMonthly,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/kpi-plans.GET',
      message: error?.message || 'error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось загрузить планы') }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'kpi.view')
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

    const actorUserId = ('user' in access ? access.user?.id : null) || null

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
        actorUserId,
        entityType: 'kpi-plan',
        entityId: String((existing as any).id),
        action: 'update',
        payload: { kind, target },
      })
      return json({ ok: true, data })
    }

    // Fallback: некоторые БД унаследовали legacy-колонки NOT NULL, которых
    // нет в актуальной схеме. Заполняем их детерминированно, чтобы INSERT
    // не падал. Если колонки в БД нет — retry без неё.
    const planKey = [companyId || 'org', kind, start].join('|')

    const insertPayload: Record<string, unknown> = {
      company_id: companyId,
      kind,
      target_amount: target,
      period_start: start,
      period_end: end,
      created_by: actorUserId,
      // Legacy-колонки (могут существовать в части БД):
      plan_key: planKey,
      month_start: start, // legacy: совпадает с period_start
      entity_type: 'kpi_plan', // legacy-тег типа записи
    }

    const optionalLegacyCols = ['plan_key', 'month_start', 'entity_type']
    // Возможные значения для legacy entity_type — если CHECK сужает домен,
    // перебираем по очереди. Финально — удалить из payload.
    const entityTypeFallbacks = ['kpi_plan', 'kpi', 'goal', 'plan', 'budget']
    let entityTypeIdx = 0
    let attempt: Record<string, unknown> = { ...insertPayload, entity_type: entityTypeFallbacks[0] }
    let inserted: any = null
    let uniqueRetry = false
    while (true) {
      const res = await supabase
        .from('kpi_plans')
        .insert([attempt])
        .select('*')
        .single()
      if (!res.error) {
        inserted = res.data
        break
      }
      const code = String((res.error as any)?.code || '')
      const msg = String(res.error?.message || '').toLowerCase()
      const details = String((res.error as any)?.details || '').toLowerCase()
      const combined = `${msg} ${details}`

      // 1) Колонки физически нет в схеме — выкидываем из payload.
      const columnMissing =
        combined.includes('does not exist') ||
        combined.includes('schema cache') ||
        combined.includes('could not find the')
      if (columnMissing) {
        const offending = optionalLegacyCols.find(
          (col) => combined.includes(col) && col in attempt,
        )
        if (offending) {
          delete attempt[offending]
          continue
        }
      }

      // 2) CHECK на entity_type — пробуем следующее значение.
      const isCheck = combined.includes('check constraint')
      const mentionsEntityType =
        combined.includes('entity_type') ||
        combined.includes('entity-type') ||
        combined.includes('entitytype')
      if (isCheck && mentionsEntityType && 'entity_type' in attempt) {
        entityTypeIdx += 1
        if (entityTypeIdx < entityTypeFallbacks.length) {
          attempt = { ...attempt, entity_type: entityTypeFallbacks[entityTypeIdx] }
          continue
        }
        // Все варианты не подошли — пробуем без поля совсем.
        delete attempt.entity_type
        continue
      }

      // 3) UNIQUE violation (23505) — запись уже есть по legacy unique-ключу
      // (например, на plan_key или month_start). Наш поиск existing не нашёл,
      // потому что искал по другому набору колонок. Делаем UPDATE.
      const isUnique = code === '23505' || combined.includes('duplicate key') || combined.includes('unique constraint')
      if (isUnique && !uniqueRetry) {
        uniqueRetry = true
        // Ищем по самым стабильным бизнес-ключам.
        // Попытка #1: plan_key (если такая колонка существует в БД).
        let foundId: string | null = null
        try {
          const byKey = await supabase
            .from('kpi_plans')
            .select('id')
            .eq('plan_key', planKey)
            .limit(1)
            .maybeSingle()
          if (!byKey.error && byKey.data) foundId = (byKey.data as any).id
        } catch {}

        // Попытка #2: company_id + period_start + kind.
        if (!foundId) {
          let q = supabase
            .from('kpi_plans')
            .select('id')
            .eq('period_start', start)
            .eq('kind', kind)
            .limit(1)
          q = companyId ? q.eq('company_id', companyId) : q.is('company_id', null)
          const byBiz = await q.maybeSingle()
          if (!byBiz.error && byBiz.data) foundId = (byBiz.data as any).id
        }

        if (foundId) {
          const upd = await supabase
            .from('kpi_plans')
            .update({ target_amount: target, period_end: end })
            .eq('id', foundId)
            .select('*')
            .single()
          if (upd.error) throw upd.error
          inserted = upd.data
          await writeAuditLog(supabase as any, {
            actorUserId,
            entityType: 'kpi-plan',
            entityId: String(foundId),
            action: 'update',
            payload: { kind, target },
          })
          return json({ ok: true, data: inserted })
        }
      }

      throw res.error
    }

    await writeAuditLog(supabase as any, {
      actorUserId,
      entityType: 'kpi-plan',
      entityId: String((inserted as any)?.id || ''),
      action: 'create',
      payload: { kind, target, period_start: start, period_end: end },
    })

    return json({ ok: true, data: inserted })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/kpi-plans.POST',
      message: error?.message || 'error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось сохранить план') }, 500)
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
    return json({ error: humanizeDbError(error, 'Не удалось удалить') }, 500)
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
