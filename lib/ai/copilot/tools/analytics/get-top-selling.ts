/**
 * AI tool: топ-продаваемые товары за период.
 * Capability: pos.view
 */

import type { CopilotTool } from '../../types'

export const getTopSellingTool: CopilotTool = {
  name: 'get_top_selling',
  category: 'analytics',
  description: 'Топ продаваемых товаров за период',
  requiredCapability: 'pos.view',
  severity: 'low',
  params: [
    { name: 'days', label: 'За сколько дней', type: 'number', required: false, description: 'По умолчанию — 30' },
  ],
  handler: async (input, ctx) => {
    const days = Math.max(1, Math.min(365, Number(input.days || 30)))
    const since = new Date(Date.now() - days * 86400000).toISOString()

    const { data, error } = await ctx.supabase
      .from('point_sale_items')
      .select('quantity, total_amount, item:item_id(name), sale:sale_id!inner(created_at)')
      .gte('sale.created_at', since)
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: '🛍 Продаж за период нет.' }

    const byItem = new Map<string, { name: string; qty: number; sum: number }>()
    for (const r of data as any[]) {
      const item = Array.isArray(r.item) ? r.item[0] : r.item
      const name = item?.name || '?'
      const cur = byItem.get(name) || { name, qty: 0, sum: 0 }
      cur.qty += Number(r.quantity || 0)
      cur.sum += Number(r.total_amount || 0)
      byItem.set(name, cur)
    }
    const ranked = Array.from(byItem.values()).sort((a, b) => b.sum - a.sum).slice(0, 15)
    const lines: string[] = [`🛍 Топ продаж за ${days} дн:\n`]
    for (let i = 0; i < ranked.length; i++) {
      const r = ranked[i]
      lines.push(`${i + 1}. ${r.name}: ${r.qty} шт · ${r.sum.toLocaleString('ru-RU')} ₸`)
    }
    return { ok: true, message: lines.join('\n'), data: { count: ranked.length } }
  },
}
