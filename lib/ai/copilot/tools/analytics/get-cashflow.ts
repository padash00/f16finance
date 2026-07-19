/**
 * AI tool: cashflow за период (доходы / расходы / прибыль / маржа).
 * Capability: cashflow.view
 */

import type { CopilotTool } from '../../types'
import { companyOptions, scopedCompanyIds, resolveDateRange, dateRangeParams, fetchAllPages } from '../../query-helpers'

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

    // «Все точки» = только точки своей организации.
    const ids = companyId ? null : await scopedCompanyIds(ctx)
    const buildQ = (table: 'incomes' | 'expenses', select: string) => (rFrom: number, rTo: number) => {
      let q = ctx.supabase
        .from(table)
        .select(select)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
        .range(rFrom, rTo)
      if (from) q = q.gte('date', from)
      if (to) q = q.lte('date', to)
      if (companyId) q = q.eq('company_id', companyId)
      else if (ids) q = q.in('company_id', ids)
      return q
    }

    let incRows: any[]
    let expRows: any[]
    try {
      ;[incRows, expRows] = await Promise.all([
        fetchAllPages(buildQ('incomes', 'cash_amount, kaspi_amount, card_amount, online_amount')),
        fetchAllPages(buildQ('expenses', 'cash_amount, kaspi_amount')),
      ])
    } catch (e: any) {
      return { ok: false, message: `Ошибка: ${e?.message || 'unknown'}` }
    }

    let income = 0
    for (const r of incRows as any[]) {
      income += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    }
    let expense = 0
    for (const r of expRows as any[]) {
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
