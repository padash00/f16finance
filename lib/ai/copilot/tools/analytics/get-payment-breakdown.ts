/**
 * AI tool: разбивка выручки по способам оплаты с долями.
 * Capability: analytics.view
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

export const getPaymentBreakdownTool: CopilotTool = {
  name: 'get_payment_breakdown',
  category: 'analytics',
  description: 'Разбивка выручки по способам оплаты (нал/Kaspi/карта/онлайн) с долями',
  requiredCapability: 'analytics.view',
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
        { value: 'quarter', label: 'Квартал' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || 'month')
    const today = todayISO()
    const days = period === 'week' ? 6 : period === 'month' ? 29 : 89
    const from = addDaysISO(today, -days)

    const { data } = await ctx.supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, card_amount, online_amount')
      .gte('date', from)
      .lte('date', today)
      .range(0, 19999)

    let cash = 0
    let kaspi = 0
    let card = 0
    let online = 0
    for (const r of (data || []) as any[]) {
      cash += Number(r.cash_amount || 0)
      kaspi += Number(r.kaspi_amount || 0)
      card += Number(r.card_amount || 0)
      online += Number(r.online_amount || 0)
    }
    const total = cash + kaspi + card + online
    if (total === 0) return { ok: true, message: 'Нет данных за период.' }

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const pct = (n: number) => ((n / total) * 100).toFixed(1) + '%'
    const cashlessShare = ((kaspi + card + online) / total) * 100

    return {
      ok: true,
      message: `💳 Разбивка платежей за ${period === 'week' ? 'неделю' : period === 'month' ? 'месяц' : 'квартал'}:
  💵 Наличные: ${fmt(cash)} (${pct(cash)})
  💳 Kaspi: ${fmt(kaspi)} (${pct(kaspi)})
  💸 Карта: ${fmt(card)} (${pct(card)})
  🌐 Онлайн: ${fmt(online)} (${pct(online)})

📊 Доля безнала: ${cashlessShare.toFixed(1)}%
💰 Итого: ${fmt(total)}`,
      data: { cash, kaspi, card, online, total, cashlessShare },
    }
  },
}
