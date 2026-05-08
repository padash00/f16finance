/**
 * AI tool: запросить выручку за период.
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

export const queryRevenueTool: CopilotTool = {
  name: 'query_revenue',
  category: 'analytics',
  description: 'Посчитать выручку за период',
  requiredCapability: 'income.view',
  severity: 'low',
  params: [
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'Период за который считаем выручку',
      getOptions: async () => [
        { value: 'today', label: 'Сегодня' },
        { value: 'yesterday', label: 'Вчера' },
        { value: 'week', label: 'Эта неделя (7 дней)' },
        { value: 'month', label: 'Этот месяц (30 дней)' },
      ],
    },
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: false,
      description: 'Фильтр по точке. Если не указан — все.',
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
    const period = String(input.period || 'today')
    const companyId = String(input.company_id || '')
    const today = todayISO()

    let from = today
    let to = today
    if (period === 'yesterday') {
      from = addDaysISO(today, -1)
      to = from
    } else if (period === 'week') {
      from = addDaysISO(today, -6)
    } else if (period === 'month') {
      from = addDaysISO(today, -29)
    }

    let query = ctx.supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, card_amount, online_amount, company_id, shift, date')
      .gte('date', from)
      .lte('date', to)
      .range(0, 9999)
    if (companyId) query = query.eq('company_id', companyId)

    const { data, error } = await query
    if (error) return { ok: false, message: `Ошибка запроса: ${error.message}` }

    const rows = data || []
    let total = 0
    let cash = 0
    let kaspi = 0
    let card = 0
    let online = 0
    for (const r of rows) {
      cash += Number(r.cash_amount || 0)
      kaspi += Number(r.kaspi_amount || 0)
      card += Number(r.card_amount || 0)
      online += Number(r.online_amount || 0)
    }
    total = cash + kaspi + card + online

    const fmtMoney = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'

    let companyLabel = ''
    if (companyId) {
      const { data: c } = await ctx.supabase.from('companies').select('name').eq('id', companyId).single()
      companyLabel = c?.name ? ` (${c.name})` : ''
    }

    const periodLabel: Record<string, string> = {
      today: 'сегодня',
      yesterday: 'вчера',
      week: 'неделя',
      month: 'месяц',
    }

    return {
      ok: true,
      message: `📊 Выручка за ${periodLabel[period] || period}${companyLabel}:
Итого: ${fmtMoney(total)}
  💵 Наличные: ${fmtMoney(cash)}
  💳 Безналичный: ${fmtMoney(kaspi)}
  💸 Карта: ${fmtMoney(card)}
  🌐 Онлайн: ${fmtMoney(online)}
Записей в incomes: ${rows.length}`,
      data: { total, cash, kaspi, card, online, count: rows.length },
    }
  },
}
