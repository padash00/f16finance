import 'server-only'

import type { LearnExpenseRow, LearnIncomeRow } from '@/lib/analysis/forecast-learning'
import { splitIncomeKaspiByCalendarDay, type ReportIncomeCalendarRow } from '@/lib/reports/income-calendar-kaspi'

/**
 * Данные для месячного прогноза: вся история доходов и расходов точек и
 * справочник статей организации.
 *
 * Общий для страницы /analysis и крона фиксации прогнозов — чтобы
 * зафиксированный 1-го числа прогноз и прогноз на странице считались из одних
 * и тех же цифр.
 */

export type ForecastIncomeInput = LearnIncomeRow & { company_id: string }
export type ForecastExpenseInput = LearnExpenseRow & { company_id: string }

const CHUNK = 1000
const HISTORY_FROM = '2020-01-01'

/** Сегодня по Казахстану (UTC+5): сервер живёт в UTC, а месяц начинается у нас */
export function kzTodayISO(now = new Date()): string {
  return new Date(now.getTime() + 5 * 3_600_000).toISOString().slice(0, 10)
}

export async function fetchAllRows<T>(buildQuery: () => any): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await buildQuery().range(from, from + CHUNK - 1)
    if (error) throw error
    const batch = (data || []) as T[]
    rows.push(...batch)
    // Сервер отдаёт не больше 1000 строк за раз — неполный кусок значит конец
    if (batch.length < CHUNK) break
  }
  return rows
}

export async function loadForecastInputs(
  supabase: any,
  params: {
    /** null — без фильтра (суперадмин вне организации) */
    companyIds: string[] | null
    organizationId: string | null
    isSuperAdmin: boolean
    to: string
  },
): Promise<{
  incomes: ForecastIncomeInput[]
  expenses: ForecastExpenseInput[]
  categoryGroups: Record<string, string | null>
}> {
  const { companyIds, organizationId, isSuperAdmin, to } = params
  if (companyIds !== null && companyIds.length === 0) return { incomes: [], expenses: [], categoryGroups: {} }

  const incomeQuery = () => {
    let q = supabase
      .from('incomes')
      .select('id, date, company_id, shift, zone, cash_amount, kaspi_amount, kaspi_before_midnight, online_amount, card_amount, comment')
      .gte('date', HISTORY_FROM)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
    if (companyIds !== null) q = q.in('company_id', companyIds)
    return q
  }
  const expenseQuery = () => {
    let q = supabase
      .from('expenses')
      .select('id, date, company_id, category, cash_amount, kaspi_amount')
      .gte('date', HISTORY_FROM)
      .lte('date', to)
      .order('date', { ascending: true })
      .order('id', { ascending: true })
    if (companyIds !== null) q = q.in('company_id', companyIds)
    return q
  }

  // Справочник статей — только своей организации: чужая категория с тем же
  // именем перетёрла бы статью (тот же скоуп, что в ОПиУ и /reports)
  let categoriesQuery = supabase.from('expense_categories').select('name, accounting_group')
  if (!isSuperAdmin) categoriesQuery = categoriesQuery.eq('organization_id', organizationId || '00000000-0000-0000-0000-000000000000')
  else if (organizationId) categoriesQuery = categoriesQuery.eq('organization_id', organizationId)

  const [incomeRows, expenseRows, categoriesRes] = await Promise.all([
    fetchAllRows<ReportIncomeCalendarRow>(incomeQuery),
    fetchAllRows<any>(expenseQuery),
    categoriesQuery,
  ])

  // Как в отчётах: безнал ночной смены после полуночи — на следующий день.
  // Иначе на границе месяцев факт расходился бы с /reports.
  const splitIncomes = splitIncomeKaspiByCalendarDay(incomeRows) as ReportIncomeCalendarRow[]

  const categoryGroups: Record<string, string | null> = {}
  for (const row of ((categoriesRes as any)?.data || []) as Array<{ name: string | null; accounting_group: string | null }>) {
    const key = String(row.name || '').trim().toLowerCase()
    if (key) categoryGroups[key] = row.accounting_group ?? null
  }

  return {
    incomes: splitIncomes.map((r: any) => ({
      company_id: String(r.company_id),
      date: String(r.date),
      cash: Number(r.cash_amount || 0),
      kaspi: Number(r.kaspi_amount || 0),
      card: Number(r.card_amount || 0),
      online: Number(r.online_amount || 0),
    })),
    expenses: expenseRows.map((r: any) => ({
      company_id: String(r.company_id),
      date: String(r.date),
      category: r.category ?? null,
      cash: Number(r.cash_amount || 0),
      kaspi: Number(r.kaspi_amount || 0),
    })),
    categoryGroups,
  }
}
