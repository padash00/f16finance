import { NextResponse } from 'next/server'

import { buildMonthlyForecast, type ForecastIncomeRow, type ForecastExpenseRow } from '@/lib/analysis/monthly-forecast'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

const PAGE_SIZE = 5000

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store' } })
}

function todayISO() {
  const d = new Date()
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}

async function fetchAll(
  supabase: any,
  table: 'incomes' | 'expenses',
  select: string,
  from: string,
  to: string,
  allowed: string[] | null,
) {
  const all: any[] = []
  let page = 0
  while (true) {
    let q = supabase.from(table).select(select).gte('date', from).lte('date', to)
      .order('date', { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
    if (allowed !== null) {
      if (allowed.length === 0) return []
      q = q.in('company_id', allowed)
    }
    const { data, error } = await q
    if (error) throw error
    const rows = data ?? []
    all.push(...rows)
    if (rows.length < PAGE_SIZE) break
    page++
  }
  return all
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const companyId = url.searchParams.get('company_id')

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId && companyId !== 'all' ? companyId : null,
      isSuperAdmin: access.isSuperAdmin,
    })
    const allowed = companyScope.allowedCompanyIds

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const to = todayISO()
    const from = '2020-01-01' // вся история

    const [incomeRows, expenseRows] = await Promise.all([
      fetchAll(supabase, 'incomes', 'date, company_id, cash_amount, kaspi_amount, card_amount, online_amount', from, to, allowed),
      fetchAll(supabase, 'expenses', 'date, company_id, category, cash_amount, kaspi_amount', from, to, allowed),
    ])

    const incomes: ForecastIncomeRow[] = incomeRows.map((r) => ({
      date: r.date, cash: r.cash_amount || 0, kaspi: r.kaspi_amount || 0, card: r.card_amount || 0, online: r.online_amount || 0,
    }))
    const expenses: ForecastExpenseRow[] = expenseRows.map((r) => ({
      date: r.date, category: r.category ?? null, cash: r.cash_amount || 0, kaspi: r.kaspi_amount || 0,
    }))

    const forecast = buildMonthlyForecast(incomes, expenses, to)
    return json({ forecast })
  } catch (error: any) {
    if (error?.message === 'company-out-of-scope') return json({ error: 'Компания недоступна' }, 403)
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/monthly-forecast GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
