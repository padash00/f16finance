import { NextResponse } from 'next/server'

import { COUNTED_EXPENSE_FILTER } from '@/lib/domain/expense-status'
import {
  addDays,
  aggregatePos,
  almatyToday,
  buildExpenseCategories,
  buildOperators,
  buildSeries,
  buildWeekdays,
  comparisonRange,
  countShifts,
  daysBetween,
  pickGroup,
  posCompareWindow,
  type OwnerPosSale,
} from '@/lib/domain/owner-analytics'
import { aggregateReportFromRows } from '@/lib/reports/aggregate-from-rows'
import { isExtraCompany } from '@/lib/reports/extra-company'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { mergeDateRanges } from '@/lib/reports/period'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { hasCapability, requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

// PostgREST режет ответ до 1000 строк — читаем кусками со стабильной сортировкой.
const CHUNK = 1000
const MAX_ROWS = 200_000
/** Чеки с товарами тяжёлые: за год их десятки тысяч. Дальше — только суммы. */
const MAX_POS_ITEM_SALES = 50_000
const MAX_RANGE_DAYS = 400

async function fetchAllRows<T>(buildQuery: () => any, limit = MAX_ROWS): Promise<T[]> {
  const out: T[] = []
  let cursor = 0
  while (out.length < limit) {
    const { data, error } = await buildQuery().range(cursor, cursor + CHUNK - 1)
    if (error) throw error
    const batch = (data || []) as T[]
    out.push(...batch)
    if (batch.length < CHUNK) break
    cursor += CHUNK
  }
  return out
}

type IncomeRow = ReportIncomeCalendarRow & { operator_id: string | null }

/**
 * Аналитика владельца для мобильного приложения: KPI, график с базой
 * сравнения, точки, статьи расходов, операторы, дни недели и касса — одним
 * ответом под одним фильтром.
 *
 * GET ?from=YYYY-MM-DD&to=YYYY-MM-DD
 *     &company_ids=id1,id2   — набор точек; пусто — все точки организации
 *     &compare=prev|year     — база сравнения
 *     &include_extra=1       — складывать ли «экстра»-кассу в итоги
 *     &lite=1                — лёгкий ответ для главной: без товаров, статей
 *                              расходов и операторов
 */
export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    // Право на отчёты: здесь не только выручка, но и расходы с прибылью.
    // Права на доходы мало — с ним человек видит приход, но не то, куда ушли
    // деньги (как на сайте, где «Отчёты» закрыты тем же правом).
    const denied = await requireCapability(access, 'reports.view')
    if (denied) return denied

    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const to = url.searchParams.get('to') || ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
      return json({ error: 'from и to в формате YYYY-MM-DD, from не позже to' }, 400)
    }
    if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
      return json({ error: `Период не длиннее ${MAX_RANGE_DAYS} дней` }, 400)
    }
    const compare = url.searchParams.get('compare') === 'year' ? 'year' : 'prev'
    const includeExtra = ['1', 'true'].includes(url.searchParams.get('include_extra') || '')
    // Главной приложения нужны итоги и точки. Разбор чеков по товарам за месяц —
    // десятки тысяч строк, которые она не показывает, а просит дважды за вход.
    const lite = ['1', 'true'].includes(url.searchParams.get('lite') || '')
    const requestedIds = Array.from(
      new Set((url.searchParams.get('company_ids') || '').split(',').map((s) => s.trim()).filter(Boolean)),
    )

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (scope.allowedCompanyIds !== null) {
      const allowed = new Set(scope.allowedCompanyIds)
      if (requestedIds.some((id) => !allowed.has(id))) return json({ error: 'Точка недоступна' }, 403)
    }

    const canOperators = await hasCapability(access, 'operator-analytics.view')

    // Список точек для фильтра — все точки в пределах организации.
    let companiesQuery: any = supabase.from('companies').select('id, name, code').order('name')
    if (scope.allowedCompanyIds !== null) companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)
    const companiesRes = await companiesQuery
    if (companiesRes.error) throw companiesRes.error
    const companies = (companiesRes.data || []) as { id: string; name: string | null; code: string | null }[]
    const nameById = new Map(companies.map((c) => [c.id, c.name || 'Точка'] as const))

    // «Экстра»-касса выпадает из итогов, только если её не выбрали явно.
    const extraIds = new Set(companies.filter(isExtraCompany).map((c) => c.id))
    const selectedIds = requestedIds.length
      ? requestedIds
      : companies.filter((c) => includeExtra || !extraIds.has(c.id)).map((c) => c.id)

    const today = almatyToday()
    // Данные есть только по сегодня: база сравнения обрезается той же длиной,
    // иначе 10 дней месяца сравниваются с целым прошлым месяцем.
    const through = to < today ? to : today
    const { prevFrom, prevTo: prevToFull } = comparisonRange(from, to, compare)
    const prevCut = through >= from ? addDays(prevFrom, daysBetween(from, through)) : prevFrom
    const prevTo = prevCut < prevToFull ? prevCut : prevToFull
    const group = pickGroup(from, to)

    const period = { from, to, through, prevFrom, prevTo, compare, group, partial: to >= today }

    // Нет точек или период целиком в будущем — считать нечего. Раньше будущий
    // период сравнивал один день базы с нулём.
    if (selectedIds.length === 0 || through < from) {
      return json({ ok: true, data: emptyResponse(period, companies, requestedIds) })
    }

    // Доходам нужен день до начала: ночная смена переносит безнал за полночь.
    const incomeRanges = mergeDateRanges([
      { from: addDays(from, -1), to: through < from ? from : through },
      { from: addDays(prevFrom, -1), to: prevTo },
    ])
    const expenseRanges = mergeDateRanges([
      { from, to: through < from ? from : through },
      { from: prevFrom, to: prevTo },
    ])

    const incomeQuery = (a: string, b: string) =>
      supabase
        .from('incomes')
        .select('id, date, company_id, shift, zone, operator_id, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount, comment')
        .in('company_id', selectedIds)
        .gte('date', a)
        .lte('date', b)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
    const expenseQuery = (a: string, b: string) =>
      supabase
        .from('expenses')
        .select('id, date, company_id, category, cash_amount, kaspi_amount')
        .in('company_id', selectedIds)
        .gte('date', a)
        .lte('date', b)
        .or(COUNTED_EXPENSE_FILTER)
        .order('date', { ascending: true })
        .order('id', { ascending: true })

    // Справочник статей — своей организации (как в /api/admin/reports/bundle).
    const orgId = access.activeOrganization?.id || null
    let categoriesQuery: any = supabase.from('expense_categories').select('name, accounting_group')
    if (!access.isSuperAdmin) categoriesQuery = categoriesQuery.eq('organization_id', orgId || '00000000-0000-0000-0000-000000000000')
    else if (orgId) categoriesQuery = categoriesQuery.eq('organization_id', orgId)

    const [incomesRaw, expenses, categoriesRes] = await Promise.all([
      Promise.all(incomeRanges.map((r) => fetchAllRows<IncomeRow>(() => incomeQuery(r.from, r.to)))).then((p) => p.flat()),
      Promise.all(expenseRanges.map((r) => fetchAllRows<any>(() => expenseQuery(r.from, r.to)))).then((p) => p.flat()),
      categoriesQuery,
    ])

    const incomes = splitIncomeKaspiByCalendarDay(incomesRaw) as IncomeRow[]
    const categoryGroups: Record<string, string | null> = {}
    for (const row of ((categoriesRes as any)?.data || []) as { name: string | null; accounting_group: string | null }[]) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }

    const agg = aggregateReportFromRows({
      incomes,
      expenses,
      dateFrom: from,
      dateTo: through < from ? from : through,
      groupMode: 'day',
      companyName: (id) => nameById.get(id) ?? 'Точка',
      prevFrom,
      prevTo,
      categoryGroups,
    })

    const kpi = (t: typeof agg.totalsCur, shifts: number) => ({
      revenue: Math.round(t.totalIncome),
      expense: Math.round(t.totalExpense),
      profit: Math.round(t.profit),
      /** Прибыль как в ОПиУ: без покупки оборудования и выплат партнёрам */
      pnlProfit: Math.round(t.pnlProfit ?? t.profit),
      cash: Math.round(t.incomeCash),
      kaspi: Math.round(t.incomeKaspi),
      card: Math.round(t.incomeCard),
      online: Math.round(t.incomeOnline),
      shifts,
    })

    const byCompany = selectedIds
      .map((id) => {
        const cur = agg.companyStats.get(id)
        const prev = agg.companyStatsPrev.get(id)
        return {
          id,
          name: nameById.get(id) ?? 'Точка',
          revenue: Math.round(cur?.income ?? 0),
          expense: Math.round(cur?.expense ?? 0),
          profit: Math.round(cur?.profit ?? 0),
          prevRevenue: Math.round(prev?.income ?? 0),
          prevProfit: Math.round(prev?.profit ?? 0),
        }
      })
      .sort((a, b) => b.revenue - a.revenue)

    const series = buildSeries({ incomes, expenses, from, to, prevFrom, prevTo, group, through })
    const weekdays = buildWeekdays({ incomes, from, to: through })

    let operators: ReturnType<typeof buildOperators> | null = null
    if (canOperators && !lite) {
      const ids = Array.from(new Set(incomes.map((r) => r.operator_id).filter(Boolean))) as string[]
      const names = new Map<string, string>()
      for (let i = 0; i < ids.length; i += 500) {
        const { data, error } = await supabase.from('operators').select('id, name, short_name').in('id', ids.slice(i, i + 500))
        if (error) throw error
        for (const o of data || []) names.set(String(o.id), o.short_name?.trim() || o.name?.trim() || 'Оператор')
      }
      operators = buildOperators({ incomes, from, to: through, prevFrom, prevTo, operatorName: (id) => names.get(id) || 'Оператор' })
    }

    const pos = await loadPos(supabase, selectedIds, { from, to, prevFrom, prevTo: prevToFull }, { items: !lite })

    return json({
      ok: true,
      data: {
        period,
        companies: companies.map((c) => ({ id: c.id, name: c.name || 'Точка', isExtra: extraIds.has(c.id) })),
        selectedCompanyIds: requestedIds,
        kpi: {
          current: kpi(agg.totalsCur, countShifts(incomes, from, through)),
          previous: kpi(agg.totalsPrev, countShifts(incomes, prevFrom, prevTo)),
        },
        series,
        byCompany,
        weekdays,
        expenseCategories: !lite ? buildExpenseCategories({ expenses, from, to: through, prevFrom, prevTo }) : null,
        operators,
        pos,
      },
    })
  } catch (error: any) {
    if (error?.message === 'company-out-of-scope') return json({ error: 'Точка недоступна' }, 403)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/owner-analytics GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

async function loadPos(
  supabase: any,
  companyIds: string[],
  range: { from: string; to: string; prevFrom: string; prevTo: string },
  options: { items: boolean },
) {
  const window = posCompareWindow({ ...range, now: new Date() })
  const SALE_SELECT = options.items
    ? 'id, sold_at, total_amount, cash_amount, kaspi_amount, card_amount, online_amount, items:point_sale_items(quantity, total_price, universal_name, inventory_items(name, default_purchase_price, category:category_id(name)))'
    : 'id, sold_at, total_amount, cash_amount, kaspi_amount, card_amount, online_amount'
  // Без товаров строки лёгкие — лимит как у отчётов, а не как у чеков с позициями.
  const currentLimit = options.items ? MAX_POS_ITEM_SALES : MAX_ROWS

  const salesQuery = (select: string, a: string, b: string) => () =>
    supabase
      .from('point_sales')
      .select(select)
      .in('company_id', companyIds)
      .gte('sold_at', a)
      .lt('sold_at', b)
      .order('sold_at', { ascending: true })
      .order('id', { ascending: true })

  const [current, previous] = await Promise.all([
    fetchAllRows<OwnerPosSale>(salesQuery(SALE_SELECT, window.current.from, window.current.to), currentLimit),
    fetchAllRows<OwnerPosSale>(salesQuery('id, sold_at, total_amount', window.previous.from, window.previous.to)),
  ])

  // Точки без кассы (клуб на отчётах смен): блок не показываем вовсе, а не
  // рисуем нули, которые читаются как «ничего не продали».
  if (current.length === 0 && previous.length === 0) return null

  const cur = aggregatePos(current)
  const prevAmount = previous.reduce((s, r) => s + Number(r.total_amount || 0), 0)
  return {
    ...cur,
    // Без позиций себестоимость неизвестна: «прибыль» по кассе была бы равна
    // выручке, и это прочиталось бы как стопроцентная маржа.
    ...(options.items ? {} : { grossProfit: null, topItems: [], byCategory: [] }),
    truncated: current.length >= currentLimit,
    previous: {
      amount: Math.round(prevAmount),
      receipts: previous.length,
      avgCheck: previous.length ? Math.round(prevAmount / previous.length) : 0,
      /** База обрезана тем же часом, что и сегодня */
      sameTime: window.truncated,
    },
  }
}

function emptyResponse(
  period: Record<string, unknown>,
  companies: { id: string; name: string | null; code: string | null }[],
  requestedIds: string[],
) {
  const zero = { revenue: 0, expense: 0, profit: 0, pnlProfit: 0, cash: 0, kaspi: 0, card: 0, online: 0, shifts: 0 }
  return {
    period,
    companies: companies.map((c) => ({ id: c.id, name: c.name || 'Точка', isExtra: isExtraCompany(c) })),
    selectedCompanyIds: requestedIds,
    kpi: { current: zero, previous: zero },
    series: [],
    byCompany: [],
    weekdays: [],
    expenseCategories: null,
    operators: null,
    pos: null,
  }
}
