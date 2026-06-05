/**
 * AI tool: cashflow за период (доходы / расходы / прибыль / маржа).
 * Capability: cashflow.view
 */

import type { CopilotTool } from '../../types'
import { companyOptions, scopedCompanyIds } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysISO(iso: string, diff: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export const getCashflowTool: CopilotTool = {
  name: 'get_cashflow',
  category: 'analytics',
  description: 'Cashflow за период: доходы, расходы, прибыль, маржа',
  requiredCapability: 'cashflow.view',
  severity: 'low',
  params: [
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'За какой период',
      getOptions: async () => [
        { value: 'today', label: 'Сегодня' },
        { value: 'week', label: 'Неделя' },
        { value: 'month', label: 'Месяц' },
      ],
    },
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: false,
      description: 'Фильтр',
      getOptions: async (ctx) => companyOptions(ctx, { allLabel: '📍 Все точки' }),
    },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || 'today')
    const companyId = String(input.company_id || '')
    const today = todayISO()

    let from = today
    let to = today
    if (period === 'week') from = addDaysISO(today, -6)
    else if (period === 'month') from = addDaysISO(today, -29)

    let incQ = ctx.supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, card_amount, online_amount')
      .gte('date', from)
      .lte('date', to)
      .range(0, 9999)
    let expQ = ctx.supabase
      .from('expenses')
      .select('cash_amount, kaspi_amount')
      .gte('date', from)
      .lte('date', to)
      .range(0, 9999)
    if (companyId) {
      incQ = incQ.eq('company_id', companyId)
      expQ = expQ.eq('company_id', companyId)
    } else {
      // «Все точки» = только точки своей организации.
      const ids = await scopedCompanyIds(ctx)
      if (ids) {
        incQ = incQ.in('company_id', ids)
        expQ = expQ.in('company_id', ids)
      }
    }

    const [incRes, expRes] = await Promise.all([incQ, expQ])
    if (incRes.error) return { ok: false, message: `Ошибка: ${incRes.error.message}` }
    if (expRes.error) return { ok: false, message: `Ошибка: ${expRes.error.message}` }

    let income = 0
    for (const r of (incRes.data || []) as any[]) {
      income += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    }
    let expense = 0
    for (const r of (expRes.data || []) as any[]) {
      expense += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
    }
    const profit = income - expense
    const margin = income > 0 ? (profit / income) * 100 : 0

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const periodLabel: Record<string, string> = { today: 'сегодня', week: 'неделя', month: 'месяц' }

    return {
      ok: true,
      message: `💰 Cashflow за ${periodLabel[period] || period}:
  Доходы: ${fmt(income)}
  Расходы: ${fmt(expense)}
  Прибыль: ${fmt(profit)}
  Маржа: ${margin.toFixed(1)}%`,
      data: { income, expense, profit, margin },
    }
  },
}
