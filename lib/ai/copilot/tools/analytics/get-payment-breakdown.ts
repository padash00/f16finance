/**
 * AI tool: разбивка выручки по способам оплаты с долями.
 * Capability: analytics.view
 */

import type { CopilotTool } from '../../types'
import { scopedCompanyIds, resolveDateRange, dateRangeParams } from '../../query-helpers'

export const getPaymentBreakdownTool: CopilotTool = {
  name: 'get_payment_breakdown',
  category: 'analytics',
  description: 'Разбивка выручки по способам оплаты (нал/Безналичный/карта/онлайн) с долями',
  requiredCapability: 'analytics.view',
  severity: 'low',
  params: [...dateRangeParams()],
  handler: async (input, ctx) => {
    const { from, to, label } = resolveDateRange(input, { defaultPeriod: 'month' })

    // Мультитенантная изоляция: только выручка точек своей организации.
    const ids = await scopedCompanyIds(ctx)
    let query = ctx.supabase
      .from('incomes')
      .select('cash_amount, kaspi_amount, card_amount, online_amount')
      .range(0, 19999)
    if (from) query = query.gte('date', from)
    if (to) query = query.lte('date', to)
    if (ids) query = query.in('company_id', ids)
    const { data } = await query

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
      message: `💳 Разбивка платежей за ${label}:
  💵 Наличные: ${fmt(cash)} (${pct(cash)})
  💳 Безналичный: ${fmt(kaspi)} (${pct(kaspi)})
  💸 Карта: ${fmt(card)} (${pct(card)})
  🌐 Онлайн: ${fmt(online)} (${pct(online)})

📊 Доля безнала: ${cashlessShare.toFixed(1)}%
💰 Итого: ${fmt(total)}`,
      data: { cash, kaspi, card, online, total, cashlessShare },
    }
  },
}
