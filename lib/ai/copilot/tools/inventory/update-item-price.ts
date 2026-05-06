/**
 * AI tool: изменить цену продажи товара.
 * Capability: catalog.update
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const updateItemPriceTool: CopilotTool = {
  name: 'update_item_price',
  category: 'inventory',
  description: 'Изменить цену продажи товара',
  requiredCapability: 'catalog.update',
  severity: 'medium',
  params: [
    {
      name: 'item_id',
      label: 'Товар',
      type: 'select',
      required: true,
      description: 'Какой товар',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('inventory_items').select('id, name, sale_price').order('name')
        return (data || []).map((i: any) => ({ value: i.id, label: `${i.name} — ${Number(i.sale_price || 0).toLocaleString('ru-RU')} ₸` }))
      },
    },
    { name: 'new_price', label: 'Новая цена (₸)', type: 'number', required: true, description: 'Новая цена продажи' },
  ],
  handler: async (input, ctx) => {
    const itemId = String(input.item_id || '')
    const newPrice = Number(input.new_price || 0)
    if (!itemId || newPrice < 0) return { ok: false, message: 'Не хватает данных.' }

    const { data: item } = await ctx.supabase.from('inventory_items').select('name, sale_price').eq('id', itemId).single()
    if (!item) return { ok: false, message: 'Товар не найден.' }

    const { error } = await ctx.supabase.from('inventory_items').update({ sale_price: newPrice }).eq('id', itemId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-item',
        entityId: itemId,
        action: 'update-price',
        payload: { name: item.name, old: item.sale_price, new: newPrice, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `💰 ${item.name}: ${Number(item.sale_price || 0).toLocaleString('ru-RU')} → ${newPrice.toLocaleString('ru-RU')} ₸` }
  },
}
