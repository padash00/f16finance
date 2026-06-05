/**
 * AI tool: посмотреть расходы за период с разбивкой по категориям.
 * Capability: expenses.view
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

export const queryExpensesTool: CopilotTool = {
  name: 'query_expenses',
  category: 'analytics',
  description: 'Посчитать расходы за период с разбивкой по категориям',
  requiredCapability: 'expenses.view',
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
        { value: 'yesterday', label: 'Вчера' },
        { value: 'week', label: 'Неделя' },
        { value: 'month', label: 'Месяц' },
      ],
    },
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
    const period = String(input.period || 'today')
    const companyId = String(input.company_id || '')
    const today = todayISO()

    let from = today
    let to = today
    if (period === 'yesterday') from = to = addDaysISO(today, -1)
    else if (period === 'week') from = addDaysISO(today, -6)
    else if (period === 'month') from = addDaysISO(today, -29)

    let query = ctx.supabase
      .from('expenses')
      .select('cash_amount, kaspi_amount, category')
      .gte('date', from)
      .lte('date', to)
      .range(0, 9999)
    if (companyId) {
      query = query.eq('company_id', companyId)
    } else {
      const ids = await scopedCompanyIds(ctx)
      if (ids) query = query.in('company_id', ids)
    }

    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    let total = 0
    const byCategory = new Map<string, number>()
    for (const r of rows) {
      const sum = Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
      total += sum
      const cat = String(r.category || 'Без категории')
      byCategory.set(cat, (byCategory.get(cat) || 0) + sum)
    }

    const sorted = Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])
    const top = sorted.slice(0, 8)
    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

    const periodLabel: Record<string, string> = { today: 'сегодня', yesterday: 'вчера', week: 'неделя', month: 'месяц' }
    const lines = [`💸 Расходы за ${periodLabel[period] || period}:`, `Итого: ${fmt(total)}`, '', 'Топ категорий:']
    for (const [cat, sum] of top) {
      const pct = total > 0 ? ((sum / total) * 100).toFixed(1) : '0'
      lines.push(`  • ${cat}: ${fmt(sum)} (${pct}%)`)
    }
    if (sorted.length > top.length) lines.push(`  ... и ещё ${sorted.length - top.length}`)

    return { ok: true, message: lines.join('\n'), data: { total, count: rows.length, byCategory: Object.fromEntries(sorted) } }
  },
}
