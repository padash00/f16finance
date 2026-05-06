/**
 * AI tool: разбивка выручки/расходов/прибыли по точкам.
 * Capability: profitability.view
 */

import type { CopilotTool } from '../../types'

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

export const queryByCompanyTool: CopilotTool = {
  name: 'query_by_company',
  category: 'analytics',
  description: 'Разбивка финансов по точкам (доходы / расходы / прибыль / маржа)',
  requiredCapability: 'profitability.view',
  severity: 'low',
  params: [
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'За какой период',
      getOptions: async () => [
        { value: 'week', label: 'Неделя' },
        { value: 'month', label: 'Месяц' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || 'month')
    const today = todayISO()
    const from = period === 'week' ? addDaysISO(today, -6) : addDaysISO(today, -29)

    const { data: companies } = await ctx.supabase.from('companies').select('id, name, code').order('name')
    if (!companies || companies.length === 0) return { ok: true, message: 'Точек нет.' }

    const [incRes, expRes] = await Promise.all([
      ctx.supabase.from('incomes').select('company_id, cash_amount, kaspi_amount, card_amount, online_amount').gte('date', from).lte('date', today).range(0, 19999),
      ctx.supabase.from('expenses').select('company_id, cash_amount, kaspi_amount').gte('date', from).lte('date', today).range(0, 19999),
    ])

    const stats = new Map<string, { name: string; income: number; expense: number }>()
    for (const c of companies as any[]) stats.set(String(c.id), { name: c.name, income: 0, expense: 0 })

    for (const r of (incRes.data || []) as any[]) {
      const s = stats.get(String(r.company_id))
      if (s) s.income += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    }
    for (const r of (expRes.data || []) as any[]) {
      const s = stats.get(String(r.company_id))
      if (s) s.expense += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
    }

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const lines = [`📊 По точкам (${period === 'week' ? 'неделя' : 'месяц'}):\n`]
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
