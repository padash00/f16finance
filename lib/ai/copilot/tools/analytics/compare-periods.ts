/**
 * AI tool: сравнить выручку текущего периода с прошлым.
 * Capability: income.view
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

async function sumRevenue(supabase: any, from: string, to: string, companyId?: string): Promise<number> {
  let q = supabase
    .from('incomes')
    .select('cash_amount, kaspi_amount, card_amount, online_amount')
    .gte('date', from)
    .lte('date', to)
    .range(0, 9999)
  if (companyId) q = q.eq('company_id', companyId)
  const { data } = await q
  let total = 0
  for (const r of (data || []) as any[]) {
    total += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
  }
  return total
}

export const comparePeriodsTool: CopilotTool = {
  name: 'compare_periods',
  category: 'analytics',
  description: 'Сравнить выручку текущего периода с прошлым (неделя, месяц)',
  requiredCapability: 'income.view',
  severity: 'low',
  params: [
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'Какой период сравнивать',
      getOptions: async () => [
        { value: 'week', label: 'Неделя vs прошлая' },
        { value: 'month', label: 'Месяц vs прошлый' },
      ],
    },
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: false,
      description: 'Фильтр',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return [
          { value: '', label: '📍 Все точки' },
          ...(data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') })),
        ]
      },
    },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || 'week')
    const companyId = String(input.company_id || '') || undefined
    const today = todayISO()
    const days = period === 'month' ? 29 : 6

    const currentFrom = addDaysISO(today, -days)
    const currentTo = today
    const prevTo = addDaysISO(currentFrom, -1)
    const prevFrom = addDaysISO(prevTo, -days)

    const [current, previous] = await Promise.all([
      sumRevenue(ctx.supabase, currentFrom, currentTo, companyId),
      sumRevenue(ctx.supabase, prevFrom, prevTo, companyId),
    ])

    const diff = current - previous
    const pct = previous > 0 ? (diff / previous) * 100 : 0
    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const arrow = diff > 0 ? '📈' : diff < 0 ? '📉' : '➡️'
    const sign = diff > 0 ? '+' : ''

    return {
      ok: true,
      message: `${arrow} ${period === 'month' ? 'Месяц' : 'Неделя'} vs прошлый${companyId ? ' (точка)' : ''}:
  Сейчас: ${fmt(current)} (${currentFrom} — ${currentTo})
  Раньше: ${fmt(previous)} (${prevFrom} — ${prevTo})
  Разница: ${sign}${fmt(diff)} (${sign}${pct.toFixed(1)}%)`,
      data: { current, previous, diff, pct },
    }
  },
}
