import { NextResponse } from 'next/server'

import { requireCapability } from '@/lib/server/capabilities'
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

function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  while (d <= end && out.length < 60) {
    out.push(
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    )
    d.setDate(d.getDate() + 1)
  }
  return out
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
    const denied = await requireCapability(access, 'weekly-report.view')
    if (denied) return denied

    const url = new URL(request.url)
    const from = url.searchParams.get('from')
    const to = url.searchParams.get('to')
    if (!isDate(from) || !isDate(to)) return json({ error: 'from-to-required' }, 400)

    const days = dateRange(from, to)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ ok: true, data: { from, to, days, companies: [], totals: null } })
    }

    let companiesQ = supabase.from('companies').select('id, name, code').order('name')
    if (companyScope.allowedCompanyIds) companiesQ = companiesQ.in('id', companyScope.allowedCompanyIds)
    const { data: companies, error: compErr } = await companiesQ
    if (compErr) throw compErr

    const incomes = await fetchAll((f, t) => {
      let q = supabase
        .from('incomes')
        .select('company_id, date, cash_amount, kaspi_amount, online_amount, card_amount')
        .gte('date', from)
        .lte('date', to)
        .range(f, t)
      if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    })

    const expenses = await fetchAll((f, t) => {
      let q = supabase
        .from('expenses')
        .select('company_id, date, category, cash_amount, kaspi_amount, comment, one_off_payee, status')
        .gte('date', from)
        .lte('date', to)
        .neq('status', 'declined')
        .order('date', { ascending: true })
        .range(f, t)
      if (companyScope.allowedCompanyIds) q = q.in('company_id', companyScope.allowedCompanyIds)
      return q
    })

    // ── Доход: итог по компании + по дням ──
    const incomeByCompany = new Map<string, IncomeAgg>()
    const incomeByCompanyDay = new Map<string, Map<string, number>>() // cid -> date -> total
    for (const r of incomes) {
      const cid = String(r.company_id)
      const cash = Number(r.cash_amount || 0)
      const kaspi = Number(r.kaspi_amount || 0)
      const online = Number(r.online_amount || 0)
      const card = Number(r.card_amount || 0)
      const total = cash + kaspi + online + card

      const agg = incomeByCompany.get(cid) || emptyIncome()
      agg.cash += cash
      agg.kaspi += kaspi
      agg.online += online
      agg.card += card
      agg.total += total
      incomeByCompany.set(cid, agg)

      const dm = incomeByCompanyDay.get(cid) || new Map<string, number>()
      dm.set(r.date, (dm.get(r.date) || 0) + total)
      incomeByCompanyDay.set(cid, dm)
    }

    // ── Расход: по категориям, по дням, построчно, раздельно нал/безнал ──
    const expenseByCompanyCat = new Map<string, Map<string, number>>()
    const expenseByCompanyDay = new Map<string, Map<string, number>>()
    const expenseRowsByCompany = new Map<string, Array<{ date: string; category: string; payee: string; amount: number }>>()
    const expenseCashByCompany = new Map<string, number>()
    const expenseKaspiByCompany = new Map<string, number>()
    for (const r of expenses) {
      const cid = String(r.company_id)
      const cat = (r.category || 'Без категории').trim() || 'Без категории'
      const cashE = Number(r.cash_amount || 0)
      const kaspiE = Number(r.kaspi_amount || 0)
      const amount = cashE + kaspiE
      const payee = (r.one_off_payee || r.comment || '').toString().trim() || '—'

      expenseCashByCompany.set(cid, (expenseCashByCompany.get(cid) || 0) + cashE)
      expenseKaspiByCompany.set(cid, (expenseKaspiByCompany.get(cid) || 0) + kaspiE)

      const cm = expenseByCompanyCat.get(cid) || new Map<string, number>()
      cm.set(cat, (cm.get(cat) || 0) + amount)
      expenseByCompanyCat.set(cid, cm)

      const dm = expenseByCompanyDay.get(cid) || new Map<string, number>()
      dm.set(r.date, (dm.get(r.date) || 0) + amount)
      expenseByCompanyDay.set(cid, dm)

      const list = expenseRowsByCompany.get(cid) || []
      list.push({ date: r.date, category: cat, payee, amount })
      expenseRowsByCompany.set(cid, list)
    }

    const grandIncome = emptyIncome()
    const grandExpenseByCat = new Map<string, number>()
    let grandExpCash = 0
    let grandExpKaspi = 0

    const companyBlocks = (companies || []).map((c: any) => {
      const cid = String(c.id)
      const inc = incomeByCompany.get(cid) || emptyIncome()
      const catMap = expenseByCompanyCat.get(cid) || new Map<string, number>()
      const incDay = incomeByCompanyDay.get(cid) || new Map<string, number>()
      const expDay = expenseByCompanyDay.get(cid) || new Map<string, number>()

      const expenseCats = Array.from(catMap.entries())
        .map(([category, amount]) => ({ category, amount }))
        .sort((a, b) => b.amount - a.amount)
      const expenseTotal = expenseCats.reduce((s, e) => s + e.amount, 0)
      const expCash = expenseCashByCompany.get(cid) || 0
      const expKaspi = expenseKaspiByCompany.get(cid) || 0

      // Остаток по типам оплаты: доход − расход
      const incomeCashless = inc.kaspi + inc.online + inc.card
      const remainCash = inc.cash - expCash
      const remainKaspi = incomeCashless - expKaspi

      const daily = days.map((d) => {
        const di = incDay.get(d) || 0
        const de = expDay.get(d) || 0
        return { date: d, income: di, expense: de, net: di - de }
      })

      const expenseRows = (expenseRowsByCompany.get(cid) || []).sort((a, b) =>
        a.date < b.date ? -1 : a.date > b.date ? 1 : b.amount - a.amount,
      )

      grandIncome.cash += inc.cash
      grandIncome.kaspi += inc.kaspi
      grandIncome.online += inc.online
      grandIncome.card += inc.card
      grandIncome.total += inc.total
      grandExpCash += expCash
      grandExpKaspi += expKaspi
      for (const e of expenseCats) grandExpenseByCat.set(e.category, (grandExpenseByCat.get(e.category) || 0) + e.amount)

      return {
        id: c.id,
        name: c.name,
        code: c.code || null,
        income: inc,
        expenses: expenseCats,
        expense_total: expenseTotal,
        expense_cash: expCash,
        expense_kaspi: expKaspi,
        net: inc.total - expenseTotal,
        remain_cash: remainCash,
        remain_kaspi: remainKaspi,
        daily,
        expense_rows: expenseRows,
      }
    })

    const grandExpenseCats = Array.from(grandExpenseByCat.entries())
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
    const grandExpenseTotal = grandExpenseCats.reduce((s, e) => s + e.amount, 0)
    const grandIncomeCashless = grandIncome.kaspi + grandIncome.online + grandIncome.card

    return json({
      ok: true,
      data: {
        from,
        to,
        days,
        companies: companyBlocks,
        totals: {
          income: grandIncome,
          expenses: grandExpenseCats,
          expense_total: grandExpenseTotal,
          expense_cash: grandExpCash,
          expense_kaspi: grandExpKaspi,
          net: grandIncome.total - grandExpenseTotal,
          remain_cash: grandIncome.cash - grandExpCash,
          remain_kaspi: grandIncomeCashless - grandExpKaspi,
        },
      },
    })
  } catch (error: any) {
    return json({ error: 'weekly-act-failed', detail: error?.message || String(error) }, 500)
  }
}
