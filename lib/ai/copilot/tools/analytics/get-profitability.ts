/**
 * AI tool: P&L (отчёт о прибыли) за период.
 * Capability: profitability.view
 *
 * Считает живой P&L из incomes + expenses. Расходы классифицируются по
 * финансовой группе через inferFinancialGroup(category):
 *   Выручка − COGS = Валовая прибыль
 *   − Операционные − Комиссия POS − ФОТ − Аванс − Налоги на ЗП = EBITDA
 *   − Амортизация = EBIT
 *   − Финансовые расходы = EBT
 *   − Налог на прибыль = Чистая прибыль
 * (CAPEX и распределение прибыли — вне P&L-цепочки, не вычитаются.)
 */

import type { CopilotTool } from '../../types'
import { companyOptions, scopedCompanyIds, resolveDateRange, dateRangeParams, fetchAllPages } from '../../query-helpers'
import { inferFinancialGroup, type FinancialGroup } from '@/lib/core/financial-groups'

export const getProfitabilityTool: CopilotTool = {
  name: 'get_profitability',
  category: 'analytics',
  description: 'P&L за период: выручка, COGS, валовая прибыль, EBITDA, опер. прибыль, чистая прибыль, маржа',
  requiredCapability: 'profitability.view',
  severity: 'low',
  params: [
    ...dateRangeParams(),
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: false,
      description: 'Фильтр по точке',
      getOptions: async (ctx) => companyOptions(ctx, { allLabel: '📍 Все точки' }),
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const { from, to, label } = resolveDateRange(input, { defaultPeriod: 'month' })

    const ids = companyId ? null : await scopedCompanyIds(ctx)
    const buildQ = (table: 'incomes' | 'expenses', select: string) => (rFrom: number, rTo: number) => {
      let q = ctx.supabase.from(table).select(select)
        .order('date', { ascending: true }).order('id', { ascending: true }).range(rFrom, rTo)
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
        fetchAllPages(buildQ('expenses', 'cash_amount, kaspi_amount, category')),
      ])
    } catch (e: any) {
      return { ok: false, message: `Ошибка: ${e?.message || 'unknown'}` }
    }

    let revenue = 0
    for (const r of incRows as any[]) {
      revenue += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    }

    const byGroup = new Map<FinancialGroup, number>()
    for (const r of expRows as any[]) {
      const sum = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      const g = inferFinancialGroup(r.category)
      byGroup.set(g, (byGroup.get(g) || 0) + sum)
    }
    const g = (key: FinancialGroup) => byGroup.get(key) || 0

    const cogs = g('cogs')
    const grossProfit = revenue - cogs
    const operating = g('operating') + g('pos_commission')
    const payroll = g('payroll') + g('payroll_advance') + g('payroll_tax')
    const ebitda = grossProfit - operating - payroll
    const depreciation = g('depreciation')
    const ebit = ebitda - depreciation
    const financialExpenses = g('financial_expenses')
    const ebt = ebit - financialExpenses
    const incomeTax = g('income_tax')
    const net = ebt - incomeTax - g('non_operating')

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const pct = (n: number) => (revenue > 0 ? ((n / revenue) * 100).toFixed(1) + '%' : '—')

    const lines = [
      `📊 P&L за ${label}:`,
      `Выручка: ${fmt(revenue)}`,
      `− COGS: ${fmt(cogs)}`,
      `= Валовая прибыль: ${fmt(grossProfit)} (${pct(grossProfit)})`,
      `− Операционные (вкл. POS-комиссию): ${fmt(operating)}`,
      `− ФОТ (ЗП + аванс + налоги): ${fmt(payroll)}`,
      `= EBITDA: ${fmt(ebitda)} (${pct(ebitda)})`,
      `− Амортизация: ${fmt(depreciation)}`,
      `= EBIT (опер. прибыль): ${fmt(ebit)}`,
      `− Финансовые расходы: ${fmt(financialExpenses)}`,
      `− Налог на прибыль: ${fmt(incomeTax)}`,
      `= Чистая прибыль: ${fmt(net)} (${pct(net)})`,
    ]

    return {
      ok: true,
      message: lines.join('\n'),
      data: {
        revenue, cogs, grossProfit, operating, payroll, ebitda,
        depreciation, ebit, financialExpenses, ebt, incomeTax, net,
        netMargin: revenue > 0 ? (net / revenue) * 100 : 0,
      },
    }
  },
}
