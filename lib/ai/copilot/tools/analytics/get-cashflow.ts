/**
 * AI tool: cashflow за период (доходы / расходы / прибыль / маржа).
 * Capability: cashflow.view
 */

import type { CopilotTool } from '../../types'
import { companyOptions, scopedCompanyIds, resolveDateRange, dateRangeParams } from '../../query-helpers'

export const getCashflowTool: CopilotTool = {
  name: 'get_cashflow',
  category: 'analytics',
  description: 'Cashflow за период: доходы, расходы, прибыль, маржа',
  requiredCapability: 'cashflow.view',
  severity: 'low',
  params: [
    ...dateRangeParams(),
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
    const companyId = String(input.company_id || '')
    const { from, to, label } = resolveDateRange(input, { defaultPeriod: 'today' })

    let incQ = ctx.supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, card_amount, online_amount')
      .range(0, 9999)
    let expQ = ctx.supabase
      .from('expenses')
      .select('cash_amount, kaspi_amount')
      .range(0, 9999)
    if (from) { incQ = incQ.gte('date', from); expQ = expQ.gte('date', from) }
    if (to) { incQ = incQ.lte('date', to); expQ = expQ.lte('date', to) }
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

    return {
      ok: true,
      message: `💰 Cashflow за ${label}:
  Доходы: ${fmt(income)}
  Расходы: ${fmt(expense)}
  Прибыль: ${fmt(profit)}
  Маржа: ${margin.toFixed(1)}%`,
      data: { income, expense, profit, margin },
    }
  },
}
