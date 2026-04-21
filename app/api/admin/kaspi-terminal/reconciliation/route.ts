import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const to = url.searchParams.get('to') || ''
    const companyId = url.searchParams.get('company_id') || null
    if (!from || !to) return json({ error: 'from и to обязательны' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    const scopeIds = companyScope.allowedCompanyIds
    if (scopeIds !== null && scopeIds.length === 0) {
      return json({ ok: true, data: { rows: [], totals: { terminal: 0, incomes: 0, diff: 0 } } })
    }

    let terminalQuery = supabase
      .from('kaspi_terminal_daily')
      .select('date, company_id, amount')
      .gte('date', from)
      .lte('date', to)
    if (scopeIds !== null) terminalQuery = terminalQuery.in('company_id', scopeIds)
    if (companyId) terminalQuery = terminalQuery.eq('company_id', companyId)

    let incomesQuery = supabase
      .from('incomes')
      .select('date, company_id, kaspi_amount')
      .gte('date', from)
      .lte('date', to)
    if (scopeIds !== null) incomesQuery = incomesQuery.in('company_id', scopeIds)
    if (companyId) incomesQuery = incomesQuery.eq('company_id', companyId)

    let companiesQuery = supabase.from('companies').select('id, name')
    if (scopeIds !== null) companiesQuery = companiesQuery.in('id', scopeIds)

    const [terminalRes, incomesRes, companiesRes] = await Promise.all([terminalQuery, incomesQuery, companiesQuery])
    if (terminalRes.error) throw terminalRes.error
    if (incomesRes.error) throw incomesRes.error

    const companyNames = new Map<string, string>(
      (companiesRes.data || []).map((c: any) => [String(c.id), String(c.name || 'Точка')]),
    )

    type Cell = { date: string; companyId: string; terminal: number; incomes: number }
    const byKey = new Map<string, Cell>()
    const keyOf = (date: string, companyId: string) => `${date}|${companyId}`

    for (const row of terminalRes.data || []) {
      const date = String((row as any).date)
      const companyId = String((row as any).company_id || '')
      if (!date || !companyId) continue
      const key = keyOf(date, companyId)
      const cell = byKey.get(key) || { date, companyId, terminal: 0, incomes: 0 }
      cell.terminal += Number((row as any).amount || 0)
      byKey.set(key, cell)
    }
    for (const row of incomesRes.data || []) {
      const date = String((row as any).date)
      const companyId = String((row as any).company_id || '')
      if (!date || !companyId) continue
      const key = keyOf(date, companyId)
      const cell = byKey.get(key) || { date, companyId, terminal: 0, incomes: 0 }
      cell.incomes += Number((row as any).kaspi_amount || 0)
      byKey.set(key, cell)
    }

    const rows = Array.from(byKey.values())
      .map((cell) => ({
        date: cell.date,
        company_id: cell.companyId,
        company_name: companyNames.get(cell.companyId) || 'Точка',
        terminal: Math.round(cell.terminal),
        incomes: Math.round(cell.incomes),
        diff: Math.round(cell.terminal - cell.incomes),
      }))
      .sort((a, b) => (a.date === b.date ? a.company_name.localeCompare(b.company_name, 'ru') : b.date.localeCompare(a.date)))

    const totals = rows.reduce(
      (acc, r) => {
        acc.terminal += r.terminal
        acc.incomes += r.incomes
        acc.diff += r.diff
        return acc
      },
      { terminal: 0, incomes: 0, diff: 0 },
    )

    return json({ ok: true, data: { rows, totals } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/kaspi-terminal/reconciliation GET',
      message: error?.message || 'error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
