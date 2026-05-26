import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

// Константа налога с оборота. Если в будущем понадобится разные ставки —
// перенести в companies.turnover_tax_rate или в profitability_settings.
const TURNOVER_TAX_RATE = 0.02

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function normalizeMonth(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}$/.test(trimmed)) return trimmed
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed.slice(0, 7)
  return null
}

function monthStartISO(month: string) {
  return `${month}-01`
}

function monthEndISO(month: string) {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthNum = Number(monthStr)
  if (!Number.isFinite(year) || !Number.isFinite(monthNum)) return `${month}-31`
  const lastDay = new Date(Date.UTC(year, monthNum, 0)).getUTCDate()
  return `${month}-${String(lastDay).padStart(2, '0')}`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

type ExpenseLine = {
  category: string
  accountingGroup: string
  amount: number
  cashAmount: number
  kaspiAmount: number
  count: number
  topComments: string[]
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireCapability(access, 'profitability.view')
    if (denied) return denied as any

    const url = new URL(req.url)
    const companyId = (url.searchParams.get('company_id') || '').trim()
    const monthFrom = normalizeMonth(url.searchParams.get('from'))
    const monthTo = normalizeMonth(url.searchParams.get('to'))

    if (!companyId) return json({ error: 'company_id обязателен' }, 400)
    if (!monthFrom || !monthTo) return json({ error: 'from и to обязательны (формат YYYY-MM)' }, 400)
    if (monthFrom > monthTo) return json({ error: 'from должен быть ≤ to' }, 400)

    const fromDate = monthStartISO(monthFrom)
    const toDate = monthEndISO(monthTo)

    const supabase = createAdminSupabaseClient()

    const [companyRes, incomesRes, expensesRes, categoriesRes] = await Promise.all([
      supabase.from('companies').select('id, name, code').eq('id', companyId).maybeSingle(),
      supabase
        .from('incomes')
        .select('cash_amount, kaspi_amount, online_amount, card_amount, date')
        .eq('company_id', companyId)
        .gte('date', fromDate)
        .lte('date', toDate),
      supabase
        .from('expenses')
        .select('category, cash_amount, kaspi_amount, comment, date')
        .eq('company_id', companyId)
        .gte('date', fromDate)
        .lte('date', toDate),
      supabase.from('expense_categories').select('name, accounting_group'),
    ])

    if (companyRes.error) throw companyRes.error
    if (!companyRes.data) return json({ error: 'Точка не найдена' }, 404)
    if (incomesRes.error) throw incomesRes.error
    if (expensesRes.error) throw expensesRes.error
    if (categoriesRes.error) throw categoriesRes.error

    const company = companyRes.data as { id: string; name: string; code: string | null }

    // Оборот: суммируем все каналы доходов за период.
    let turnover = 0
    for (const row of (incomesRes.data || []) as any[]) {
      turnover += Number(row.cash_amount || 0)
      turnover += Number(row.kaspi_amount || 0)
      turnover += Number(row.online_amount || 0)
      turnover += Number(row.card_amount || 0)
    }
    turnover = round2(turnover)

    // Маппинг category name → accounting_group.
    const accountingGroupByName = new Map<string, string>()
    for (const row of (categoriesRes.data || []) as any[]) {
      const name = String(row?.name || '').trim()
      if (!name) continue
      accountingGroupByName.set(name, String(row?.accounting_group || 'operating'))
    }

    // Агрегация расходов по category.
    const expenseMap = new Map<string, ExpenseLine>()
    for (const row of (expensesRes.data || []) as any[]) {
      const category = String(row?.category || 'Без категории').trim() || 'Без категории'
      const cash = Number(row?.cash_amount || 0)
      const kaspi = Number(row?.kaspi_amount || 0)
      const total = cash + kaspi
      if (total <= 0) continue

      const accountingGroup = accountingGroupByName.get(category) || 'operating'
      const current = expenseMap.get(category) || {
        category,
        accountingGroup,
        amount: 0,
        cashAmount: 0,
        kaspiAmount: 0,
        count: 0,
        topComments: [],
      }
      current.amount = round2(current.amount + total)
      current.cashAmount = round2(current.cashAmount + cash)
      current.kaspiAmount = round2(current.kaspiAmount + kaspi)
      current.count += 1
      const comment = String(row?.comment || '').trim()
      if (comment && current.topComments.length < 3 && !current.topComments.includes(comment)) {
        current.topComments.push(comment)
      }
      expenseMap.set(category, current)
    }

    // Разделяем на P&L расходы и CAPEX (вне P&L, справочно).
    const allLines = Array.from(expenseMap.values()).sort((a, b) => b.amount - a.amount)
    const operatingExpenses = allLines.filter((line) => line.accountingGroup !== 'capex' && line.accountingGroup !== 'profit_distribution')
    const capexLines = allLines.filter((line) => line.accountingGroup === 'capex')

    const expensesTotal = round2(operatingExpenses.reduce((sum, line) => sum + line.amount, 0))
    const capexTotal = round2(capexLines.reduce((sum, line) => sum + line.amount, 0))

    const turnoverTax = round2(turnover * TURNOVER_TAX_RATE)
    const netProfit = round2(turnover - turnoverTax - expensesTotal)

    return json({
      ok: true,
      data: {
        company: {
          id: company.id,
          name: company.name,
          code: company.code,
        },
        period: {
          from: monthFrom,
          to: monthTo,
          fromDate,
          toDate,
        },
        turnover,
        turnoverTax,
        turnoverTaxRate: TURNOVER_TAX_RATE,
        afterTax: round2(turnover - turnoverTax),
        expenses: operatingExpenses.map((line) => ({
          category: line.category,
          amount: line.amount,
          cashAmount: line.cashAmount,
          kaspiAmount: line.kaspiAmount,
          count: line.count,
          comments: line.topComments,
          accountingGroup: line.accountingGroup,
        })),
        expensesTotal,
        netProfit,
        capex: capexLines.map((line) => ({
          category: line.category,
          amount: line.amount,
          comments: line.topComments,
          count: line.count,
        })),
        capexTotal,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/profitability/branch-report',
      message: error?.message || 'branch-report failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
