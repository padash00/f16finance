import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

function isDate(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s)
}

// Постранично собираем все строки (Supabase отдаёт максимум ~1000 за раз).
async function fetchAll(makeQuery: (from: number, to: number) => any): Promise<any[]> {
  const PAGE = 1000
  const out: any[] = []
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE
    const to = from + PAGE - 1
    const { data, error } = await makeQuery(from, to)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

type IncomeAgg = { cash: number; kaspi: number; online: number; card: number; total: number }
function emptyIncome(): IncomeAgg {
  return { cash: 0, kaspi: 0, online: 0, card: 0, total: 0 }
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!isDate(from) || !isDate(to)) return json({ error: 'from-to-required' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: { from, to, companies: [], totals: null } })
    }

    // Компании
    let companiesQ = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds) companiesQ = companiesQ.in('id', companyScope.allowedCompanyIds)
    const { data: companies, error: compErr } = await companiesQ
    if (compErr) throw compErr

    // Доходы за период
    const incomes = await fetchAll((f, t) => {
      let q = supabase
        .from('incomes')
        .select('company_id, cash_amount, kaspi_amount, online_amount, card_amount')
        .gte('date', from)
        .lte('date', to)
        .range(f, t)
      if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    })

    // Расходы за период (без отклонённых)
    const expenses = await fetchAll((f, t) => {
      let q = supabase
        .from('expenses')
        .select('company_id, category, cash_amount, kaspi_amount, status')
        .gte('date', from)
        .lte('date', to)
        .neq('status', 'declined')
        .range(f, t)
      if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    })

    // Агрегация по компании
    const incomeByCompany = new Map<string, IncomeAgg>()
    for (const r of incomes) {
      const cid = String(r.company_id)
      const agg = incomeByCompany.get(cid) || emptyIncome()
      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const online = Number(r.online_amount || 0)
      const card = Number(r.card_amount || 0)
      agg.cash += cash
      agg.kaspi += kaspi
      agg.online += online
      agg.card += card
      agg.total += cash + kaspi + online + card
      incomeByCompany.set(cid, agg)
    }

    // category -> сумма, по компании
    const expenseByCompany = new Map<string, Map<string, number>>()
    for (const r of expenses) {
      const cid = String(r.company_id)
      const cat = (r.category || 'Без категории').trim() || 'Без категории'
      const amount = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      const m = expenseByCompany.get(cid) || new Map<string, number>()
      m.set(cat, (m.get(cat) || 0) + amount)
      expenseByCompany.set(cid, m)
    }

    // Сборка по компаниям
    const grandIncome = emptyIncome()
    const grandExpenseByCat = new Map<string, number>()

    const companyBlocks = (companies || []).map((c: any) => {
      const inc = incomeByCompany.get(String(c.id)) || emptyIncome()
      const catMap = expenseByCompany.get(String(c.id)) || new Map<string, number>()
      const expenseCats = Array.from(catMap.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
      const expenseTotal = expenseCats.reduce((s, e) => s + e.amount, 0)

      // в общий итог
      grandIncome.cash += inc.cash
      grandIncome.kaspi += inc.kaspi
      grandIncome.online += inc.online
      grandIncome.card += inc.card
      grandIncome.total += inc.total
      for (const e of expenseCats) {
        grandExpenseByCat.set(e.category, (grandExpenseByCat.get(e.category) || 0) + e.amount)
      }

      return {
        id: c.id,
        name: c.name,
        code: c.code || null,
        income: inc,
        expenses: expenseCats,
        expense_total: expenseTotal,
        net: inc.total - expenseTotal,
      }
    })

    const grandExpenseCats = Array.from(grandExpenseByCat.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
    const grandExpenseTotal = grandExpenseCats.reduce((s, e) => s + e.amount, 0)

    return json({
      ok: true,
      data: {
        from,
        to,
        companies: companyBlocks,
        totals: {
          income: grandIncome,
          expenses: grandExpenseCats,
          expense_total: grandExpenseTotal,
          net: grandIncome.total - grandExpenseTotal,
        },
      },
    })
  } catch (error: any) {
    return json({ error: 'weekly-act-failed', detail: error?.message || String(error) }, 500)
  }
}
