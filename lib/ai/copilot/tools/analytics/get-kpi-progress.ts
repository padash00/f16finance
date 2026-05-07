/**
 * AI tool: % выполнения KPI (план vs факт по выручке).
 * Capability: kpi.view
 */

import type { CopilotTool } from '../../types'

export const getKpiProgressTool: CopilotTool = {
  name: 'get_kpi_progress',
  category: 'analytics',
  description: 'Прогресс по KPI: план vs факт за месяц',
  requiredCapability: 'kpi.view',
  severity: 'low',
  params: [
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: true,
      description: 'Какая точка',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    if (!companyId) return { ok: false, message: 'Не выбрана точка.' }

    const today = new Date()
    const periodStart = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0)
    const periodEnd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`

    const { data: plan } = await ctx.supabase
      .from('kpi_plans')
      .select('target_amount')
      .eq('company_id', companyId)
      .eq('period_start', periodStart)
      .eq('kind', 'monthly_revenue')
      .maybeSingle()

    const { data: incomes } = await ctx.supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, card_amount, online_amount')
      .eq('company_id', companyId)
      .gte('date', periodStart)
      .lte('date', periodEnd)

    const fact = (incomes || []).reduce((s: number, r: any) =>
      s + Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0), 0)

    if (!plan?.target_amount) {
      return { ok: true, message: `📈 Факт ${periodStart}—${periodEnd}: ${fact.toLocaleString('ru-RU')} ₸\n⚠ План не установлен.` }
    }

    const target = Number(plan.target_amount)
    const pct = target > 0 ? (fact / target) * 100 : 0
    const remaining = Math.max(0, target - fact)
    const daysLeft = Math.max(1, Math.ceil((lastDay.getTime() - today.getTime()) / 86400000))
    const dailyNeeded = remaining / daysLeft

    const indicator = pct >= 100 ? '🟢' : pct >= 70 ? '🟡' : '🔴'
    const lines = [
      `${indicator} KPI ${periodStart}—${periodEnd}:`,
      ``,
      `План: ${target.toLocaleString('ru-RU')} ₸`,
      `Факт: ${fact.toLocaleString('ru-RU')} ₸ (${pct.toFixed(1)}%)`,
    ]
    if (remaining > 0) {
      lines.push(`Осталось: ${remaining.toLocaleString('ru-RU')} ₸`)
      lines.push(`До конца месяца: ${daysLeft} дн → ${Math.ceil(dailyNeeded).toLocaleString('ru-RU')} ₸/день`)
    }

    return { ok: true, message: lines.join('\n'), data: { plan: target, fact, pct } }
  },
}
