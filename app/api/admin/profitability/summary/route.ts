import { NextResponse } from 'next/server'

import { computeMonthlyPnl, type MonthlyPnl } from '@/lib/domain/profitability'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Готовый ОПиУ по месяцам.
 *
 * Роут `/api/admin/profitability` отдаёт только ручные вводы владельца —
 * саму прибыль страница `/profitability` считает у себя, смешивая их с
 * журналами доходов и расходов. Мобильному приложению пришлось бы повторить
 * эту формулу на Swift, и две реализации одной EBITDA неизбежно разошлись бы.
 *
 * Здесь расчёт выполняется на сервере общей функцией `computeMonthlyPnl`,
 * и клиент получает готовые величины.
 *
 *   GET /api/admin/profitability/summary?from=2026-01&to=2026-08
 */

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

/** `YYYY-MM`; всё остальное отбрасываем. */
function normalizeMonth(raw: string | null): string | null {
  const value = (raw || '').trim()
  return /^\d{4}-\d{2}$/.test(value) ? value : null
}

/** Последний день месяца — границы запроса к журналам. */
function monthEnd(month: string): string {
  const [year, mon] = month.split('-').map(Number)
  const days = new Date(Date.UTC(year, mon, 0)).getUTCDate()
  return `${month}-${String(days).padStart(2, '0')}`
}

/** Перечень месяцев от `from` до `to` включительно. */
function monthsBetween(from: string, to: string): string[] {
  const result: string[] = []
  const [fromYear, fromMonth] = from.split('-').map(Number)
  const [toYear, toMonth] = to.split('-').map(Number)

  let year = fromYear
  let month = fromMonth
  // Ограничение на 120 месяцев — защита от опечатки в годе, которая иначе
  // раскрутила бы цикл на тысячи итераций.
  for (let guard = 0; guard < 120; guard += 1) {
    if (year > toYear || (year === toYear && month > toMonth)) break
    result.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return result
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'profitability.view')
    if (denied) return denied

    const url = new URL(req.url)
    const from = normalizeMonth(url.searchParams.get('from'))
    const to = normalizeMonth(url.searchParams.get('to'))
    if (!from || !to) {
      return json({ error: 'from и to в формате YYYY-MM' }, 400)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const months = monthsBetween(from, to)
    if (months.length === 0) {
      return json({ ok: true, data: { months: [] } })
    }
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: { months: [] } })
    }

    const dateFrom = `${from}-01`
    const dateTo = monthEnd(to)
    const orgId = access.activeOrganization?.id || null

    let incomeQuery = supabase
      .from('incomes')
      .select('date, company_id, cash_amount, kaspi_amount, card_amount, online_amount')
      .gte('date', dateFrom)
      .lte('date', dateTo)

    let expenseQuery = supabase
      .from('expenses')
      .select('date, company_id, category, cash_amount, kaspi_amount')
      .gte('date', dateFrom)
      .lte('date', dateTo)

    if (companyScope.allowedCompanyIds !== null) {
      incomeQuery = incomeQuery.in('company_id', companyScope.allowedCompanyIds)
      expenseQuery = expenseQuery.in('company_id', companyScope.allowedCompanyIds)
    }

    // Ручные вводы принадлежат организации: без фильтра суперадмин увидел бы
    // смесь строк разных клиентов за один месяц.
    let inputsQuery = supabase
      .from('monthly_profitability_inputs')
      .select('*')
      .gte('month', from)
      .lte('month', to)
    if (orgId) inputsQuery = inputsQuery.eq('organization_id', orgId)

    const [incomeRes, expenseRes, inputsRes, categoriesRes] = await Promise.all([
      incomeQuery,
      expenseQuery,
      inputsQuery,
      supabase.from('expense_categories').select('name, accounting_group'),
    ])

    if (incomeRes.error) throw incomeRes.error
    if (expenseRes.error) throw expenseRes.error
    if (inputsRes.error) throw inputsRes.error

    const categoryGroups: Record<string, string | null> = {}
    for (const row of (categoriesRes.data || []) as any[]) {
      const key = String(row.name || '').trim().toLowerCase()
      if (key) categoryGroups[key] = row.accounting_group ?? null
    }

    const inputsByMonth = new Map<string, any>()
    for (const row of (inputsRes.data || []) as any[]) {
      inputsByMonth.set(String(row.month), row)
    }

    // Доходы сворачиваем по месяцам заранее: иначе каждый месяц перебирал бы
    // весь массив, а за год это заметно.
    const incomeByMonth = new Map<string, { cash: number; kaspi: number; card: number; online: number }>()
    for (const row of (incomeRes.data || []) as any[]) {
      const month = String(row.date || '').slice(0, 7)
      if (!month) continue
      const current = incomeByMonth.get(month) || { cash: 0, kaspi: 0, card: 0, online: 0 }
      current.cash += Number(row.cash_amount || 0)
      current.kaspi += Number(row.kaspi_amount || 0)
      current.card += Number(row.card_amount || 0)
      current.online += Number(row.online_amount || 0)
      incomeByMonth.set(month, current)
    }

    const expenses = (expenseRes.data || []) as any[]

    const rows: MonthlyPnl[] = months.map((month) =>
      computeMonthlyPnl(
        month,
        incomeByMonth.get(month) || { cash: 0, kaspi: 0, card: 0, online: 0 },
        expenses,
        inputsByMonth.get(month) || null,
        categoryGroups,
      ),
    )

    return json({ ok: true, data: { months: rows } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/profitability/summary GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Не удалось посчитать ОПиУ' }, 500)
  }
}
