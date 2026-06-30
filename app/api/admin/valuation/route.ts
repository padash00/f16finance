import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { addDaysISO } from '@/lib/core/date'
import { resolveFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Группы расходов, которые вычитаются из выручки до EBITDA (по PL_CHAIN).
const EBITDA_OPEX_GROUPS: FinancialGroup[] = [
  'cogs',
  'operating',
  'pos_commission',
  'payroll',
  'payroll_advance',
  'payroll_tax',
]
// Группы, которые вычитаются ПОСЛЕ EBITDA (для расчёта чистой прибыли).
const BELOW_EBITDA_GROUPS: FinancialGroup[] = [
  'depreciation',
  'financial_expenses',
  'income_tax',
  'non_operating',
]

function firstOfMonthISO(year: number, monthIdx0: number) {
  return `${year}-${String(monthIdx0 + 1).padStart(2, '0')}-01`
}
function lastOfMonthISO(year: number, monthIdx0: number) {
  const last = new Date(year, monthIdx0 + 1, 0).getDate()
  return `${year}-${String(monthIdx0 + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}
function monthKey(dateIso: string) {
  return String(dateIso || '').slice(0, 7)
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    // Оценка стоимости бизнеса — крайне чувствительно: только владелец/суперадмин.
    if (!access.isSuperAdmin && access.staffRole !== 'owner') {
      return json({ error: 'forbidden' }, 403)
    }
    const denied = await requireCapability(access, 'valuation.view')
    if (denied) return denied

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: null })
    }

    // ── Период: последние 24 ПОЛНЫХ месяца, заканчивая прошлым месяцем ──────
    const now = new Date()
    // последний полный месяц
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0) // 0-й день текущего = последний день прошлого
    const endYear = lastMonthEnd.getFullYear()
    const endMonth0 = lastMonthEnd.getMonth()
    const periodEnd = lastOfMonthISO(endYear, endMonth0)
    // 24 месяца назад — первый день
    const startRef = new Date(endYear, endMonth0 - 23, 1)
    const periodStart = firstOfMonthISO(startRef.getFullYear(), startRef.getMonth())
    const incomeFetchFrom = addDaysISO(periodStart, -1) // ловим ночной kaspi

    // Список месячных ключей в хронологическом порядке (24 шт.)
    const monthKeys: string[] = []
    for (let i = 0; i < 24; i++) {
      const d = new Date(startRef.getFullYear(), startRef.getMonth() + i, 1)
      monthKeys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }

    // ── Категории расходов → финансовая группа (только своя орг) ─────────────
    let catQuery = supabase
      .from('expense_categories')
      .select('name, accounting_group')
    if (!access.isSuperAdmin) catQuery = catQuery.eq('organization_id', access.activeOrganization?.id || '00000000-0000-0000-0000-000000000000')
    const { data: categoryRows, error: catErr } = await catQuery
    if (catErr) throw catErr
    const groupByCategoryName = new Map<string, string>()
    for (const row of (categoryRows || []) as any[]) {
      groupByCategoryName.set(String(row.name || '').trim().toLowerCase(), String(row.accounting_group || ''))
    }

    // ── Пагинированная выборка (PostgREST max-rows = 1000) ──────────────────
    const CHUNK = 1000
    async function fetchAll<T>(buildQuery: () => any): Promise<T[]> {
      const all: T[] = []
      let cursor = 0
      while (true) {
        const { data, error } = await buildQuery().range(cursor, cursor + CHUNK - 1)
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
        .lte('date', periodEnd)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }
    const buildExpensesQ = () => {
      let q = supabase
        .from('expenses')
        .select('date, company_id, category, cash_amount, kaspi_amount')
        .gte('date', periodStart)
        .lte('date', periodEnd)
        .order('date', { ascending: true })
      if (companyScope.allowedCompanyIds !== null) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    }

    const rawIncomes = await fetchAll<any>(buildIncomesQ)
    const incomes = splitIncomeKaspiByCalendarDay(rawIncomes as ReportIncomeCalendarRow[])
    let expenses: any[] = []
    try {
      expenses = await fetchAll<any>(buildExpensesQ)
    } catch (eErr: any) {
      await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/valuation:expenses', message: eErr?.message || 'expenses fetch error' })
    }

    // ── Помесячная агрегация ────────────────────────────────────────────────
    type MonthAgg = { revenue: number; ebitdaOpex: number; belowEbitda: number }
    const byMonth = new Map<string, MonthAgg>()
    for (const k of monthKeys) byMonth.set(k, { revenue: 0, ebitdaOpex: 0, belowEbitda: 0 })
    const companiesWithRevenue = new Set<string>()

    for (const r of incomes) {
      const k = monthKey(String(r.date || ''))
      const agg = byMonth.get(k)
      if (!agg) continue
      const total =
        Number(r.cash_amount || 0) +
        Number(r.kaspi_amount || 0) +
        Number((r as any).card_amount || 0) +
        Number((r as any).online_amount || 0)
      agg.revenue += total
      if ((r as any).company_id && total > 0) companiesWithRevenue.add(String((r as any).company_id))
    }

    for (const e of expenses) {
      const k = monthKey(String(e.date || ''))
      const agg = byMonth.get(k)
      if (!agg) continue
      const amount = Number(e.cash_amount || 0) + Number(e.kaspi_amount || 0)
      if (amount === 0) continue
      const explicitGroup = groupByCategoryName.get(String(e.category || '').trim().toLowerCase()) || null
      const group = resolveFinancialGroup(e.category, explicitGroup)
      if (EBITDA_OPEX_GROUPS.includes(group)) agg.ebitdaOpex += amount
      else if (BELOW_EBITDA_GROUPS.includes(group)) agg.belowEbitda += amount
      // capex и profit_distribution в P&L не входят — игнорируем
    }

    const monthly = monthKeys.map((k) => {
      const agg = byMonth.get(k)!
      const ebitda = agg.revenue - agg.ebitdaOpex
      const net = ebitda - agg.belowEbitda
      return {
        month: k,
        revenue: Math.round(agg.revenue),
        ebitda: Math.round(ebitda),
        net_profit: Math.round(net),
        ebitda_margin: agg.revenue > 0 ? Math.round((ebitda / agg.revenue) * 1000) / 10 : 0,
      }
    })

    const last12 = monthly.slice(12)
    const prev12 = monthly.slice(0, 12)
    const sum = (arr: typeof monthly, key: 'revenue' | 'ebitda' | 'net_profit') =>
      arr.reduce((s, m) => s + m[key], 0)

    const revenue12 = sum(last12, 'revenue')
    const ebitda12 = sum(last12, 'ebitda')
    const net12 = sum(last12, 'net_profit')
    const ebitdaPrev12 = sum(prev12, 'ebitda')
    const ebitdaMargin = revenue12 > 0 ? Math.round((ebitda12 / revenue12) * 1000) / 10 : 0

    // Тренд EBITDA год к году
    const trendPct = ebitdaPrev12 > 0
      ? Math.round(((ebitda12 - ebitdaPrev12) / ebitdaPrev12) * 1000) / 10
      : null

    // Стабильность маржи: коэффициент вариации EBITDA-маржи за 12 мес
    const activeMonths = last12.filter((m) => m.revenue > 0)
    const margins = activeMonths.map((m) => m.ebitda_margin)
    let marginCv: number | null = null
    if (margins.length >= 3) {
      const mean = margins.reduce((s, v) => s + v, 0) / margins.length
      if (mean !== 0) {
        const variance = margins.reduce((s, v) => s + (v - mean) ** 2, 0) / margins.length
        marginCv = Math.round((Math.sqrt(variance) / Math.abs(mean)) * 100) / 100
      }
    }

    const companiesCount = companiesWithRevenue.size

    // ── Умный мультипликатор ────────────────────────────────────────────────
    const BASE_MULTIPLE = 3.0
    const factors: Array<{ key: string; label: string; status: 'good' | 'neutral' | 'bad'; effect: number; note: string }> = []
    let multiple = BASE_MULTIPLE

    // Тренд
    if (trendPct == null) {
      factors.push({ key: 'trend', label: 'Тренд EBITDA год к году', status: 'neutral', effect: 0, note: 'Недостаточно истории за прошлый год' })
    } else if (trendPct >= 15) {
      multiple += 1.0
      factors.push({ key: 'trend', label: 'Тренд EBITDA год к году', status: 'good', effect: 1.0, note: `Рост +${trendPct}% — сильный плюс к оценке` })
    } else if (trendPct >= 5) {
      multiple += 0.5
      factors.push({ key: 'trend', label: 'Тренд EBITDA год к году', status: 'good', effect: 0.5, note: `Рост +${trendPct}%` })
    } else if (trendPct <= -15) {
      multiple -= 1.5
      factors.push({ key: 'trend', label: 'Тренд EBITDA год к году', status: 'bad', effect: -1.5, note: `Падение ${trendPct}% — серьёзный риск для инвестора` })
    } else if (trendPct <= -5) {
      multiple -= 0.7
      factors.push({ key: 'trend', label: 'Тренд EBITDA год к году', status: 'bad', effect: -0.7, note: `Падение ${trendPct}%` })
    } else {
      factors.push({ key: 'trend', label: 'Тренд EBITDA год к году', status: 'neutral', effect: 0, note: `Без значимого тренда (${trendPct > 0 ? '+' : ''}${trendPct}%)` })
    }

    // Стабильность маржи
    if (marginCv == null) {
      factors.push({ key: 'stability', label: 'Стабильность маржи', status: 'neutral', effect: 0, note: 'Недостаточно данных для оценки' })
    } else if (marginCv < 0.2) {
      multiple += 0.5
      factors.push({ key: 'stability', label: 'Стабильность маржи', status: 'good', effect: 0.5, note: 'Маржа ровная из месяца в месяц — предсказуемый бизнес' })
    } else if (marginCv > 0.5) {
      multiple -= 0.5
      factors.push({ key: 'stability', label: 'Стабильность маржи', status: 'bad', effect: -0.5, note: 'Маржа сильно скачет — инвестор закладывает риск' })
    } else {
      factors.push({ key: 'stability', label: 'Стабильность маржи', status: 'neutral', effect: 0, note: 'Умеренные колебания маржи' })
    }

    // Уровень EBITDA-маржи
    if (ebitdaMargin >= 25) {
      multiple += 0.5
      factors.push({ key: 'margin', label: 'EBITDA-маржа', status: 'good', effect: 0.5, note: `${ebitdaMargin}% — высокая операционная маржа` })
    } else if (ebitdaMargin < 8) {
      multiple -= 0.5
      factors.push({ key: 'margin', label: 'EBITDA-маржа', status: 'bad', effect: -0.5, note: `${ebitdaMargin}% — низкая маржа, бизнес работает «на тоненького»` })
    } else {
      factors.push({ key: 'margin', label: 'EBITDA-маржа', status: 'neutral', effect: 0, note: `${ebitdaMargin}% — нормальная маржа` })
    }

    // Диверсификация по точкам
    if (companiesCount >= 3) {
      multiple += 0.3
      factors.push({ key: 'diversification', label: 'Диверсификация', status: 'good', effect: 0.3, note: `${companiesCount} точки приносят выручку — риск распределён` })
    } else {
      factors.push({ key: 'diversification', label: 'Диверсификация', status: 'neutral', effect: 0, note: `${companiesCount} ${companiesCount === 1 ? 'точка' : 'точки'} с выручкой` })
    }

    // Зависимость от владельца — оценить автоматически нельзя.
    factors.push({
      key: 'owner_dependency',
      label: 'Зависимость от владельца',
      status: 'neutral',
      effect: 0,
      note: 'Оцените сами: если бизнес крутится без вас (есть управляющие, процессы) — инвестор добавит к мультипликатору; если всё на вас — снимет.',
    })

    // Зажимаем мультипликатор в разумных рамках
    multiple = Math.max(1.5, Math.min(6.0, Math.round(multiple * 10) / 10))
    const lowMultiple = Math.max(1.0, Math.round((multiple - 1) * 10) / 10)
    const highMultiple = Math.min(7.0, Math.round((multiple + 1) * 10) / 10)

    const profitable = ebitda12 > 0
    const valuation = profitable
      ? {
          low: Math.round(ebitda12 * lowMultiple),
          mid: Math.round(ebitda12 * multiple),
          high: Math.round(ebitda12 * highMultiple),
        }
      : { low: 0, mid: 0, high: 0 }

    return json({
      ok: true,
      data: {
        period: { start: periodStart, end: periodEnd },
        revenue_12mo: revenue12,
        ebitda_12mo: ebitda12,
        ebitda_prev_12mo: ebitdaPrev12,
        net_profit_12mo: net12,
        ebitda_margin: ebitdaMargin,
        trend_pct: trendPct,
        margin_cv: marginCv,
        companies_count: companiesCount,
        profitable,
        multiple: { base: BASE_MULTIPLE, low: lowMultiple, mid: multiple, high: highMultiple },
        valuation,
        factors,
        monthly,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/valuation.GET',
      message: error?.message || 'error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось рассчитать оценку бизнеса') }, 500)
  }
}
