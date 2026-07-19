/**
 * AI tool: разбивка выручки/расходов/прибыли по точкам.
 * Capability: profitability.view
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyRows, resolveDateRange, dateRangeParams, fetchAllPages } from '../../query-helpers'

export const queryByCompanyTool: CopilotTool = {
  name: 'query_by_company',
  category: 'analytics',
  description: 'Разбивка финансов по точкам (доходы / расходы / прибыль / маржа)',
  requiredCapability: 'profitability.view',
  severity: 'low',
  params: [...dateRangeParams()],
  handler: async (input, ctx) => {
    const { from, to, label } = resolveDateRange(input, { defaultPeriod: 'month' })

    const companies = await scopedCompanyRows(ctx)
    if (!companies || companies.length === 0) return { ok: true, message: 'Точек нет.' }

    const buildQ = (table: 'incomes' | 'expenses', select: string) => (rFrom: number, rTo: number) => {
      let q = ctx.supabase.from(table).select(select)
        .order('date', { ascending: true }).order('id', { ascending: true }).range(rFrom, rTo)
      if (from) q = q.gte('date', from)
      if (to) q = q.lte('date', to)
      return q
    }
    const [incRows, expRows] = await Promise.all([
      fetchAllPages(buildQ('incomes', 'company_id, cash_amount, kaspi_amount, card_amount, online_amount')).catch(() => [] as any[]),
      fetchAllPages(buildQ('expenses', 'company_id, cash_amount, kaspi_amount')).catch(() => [] as any[]),
    ])

    const stats = new Map<string, { name: string; income: number; expense: number }>()
    for (const c of companies as any[]) stats.set(String(c.id), { name: c.name, income: 0, expense: 0 })

    for (const r of incRows as any[]) {
      const s = stats.get(String(r.company_id))
      if (s) s.income += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    }
    for (const r of expRows as any[]) {
      const s = stats.get(String(r.company_id))
      if (s) s.expense += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
    }

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const lines = [`📊 По точкам (${label}):\n`]
    const ranking = Array.from(stats.values()).filter((s) => s.income > 0 || s.expense > 0).sort((a, b) => b.income - a.income)
    let totalInc = 0
    let totalExp = 0
    for (const s of ranking) {
      const profit = s.income - s.expense
      const margin = s.income > 0 ? (profit / s.income) * 100 : 0
      const marginEmoji = margin >= 30 ? '🟢' : margin >= 10 ? '🟡' : '🔴'
      lines.push(`📍 ${s.name}: ${fmt(s.income)} − ${fmt(s.expense)} = ${fmt(profit)} ${marginEmoji} ${margin.toFixed(1)}%`)
      totalInc += s.income
      totalExp += s.expense
    }
    if (ranking.length > 1) {
      const totalProfit = totalInc - totalExp
      const totalMargin = totalInc > 0 ? (totalProfit / totalInc) * 100 : 0
      lines.push(`\n📈 Итого: ${fmt(totalInc)} − ${fmt(totalExp)} = ${fmt(totalProfit)} (${totalMargin.toFixed(1)}%)`)
    }

    return { ok: true, message: lines.join('\n'), data: { count: ranking.length } }
  },
}
