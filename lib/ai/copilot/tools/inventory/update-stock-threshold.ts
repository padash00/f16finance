/**
 * AI tool: установить минимальный порог остатка для товара.
 * Capability: store-catalog.edit
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const updateStockThresholdTool: CopilotTool = {
  name: 'update_stock_threshold',
  category: 'inventory',
  description: 'Установить минимальный остаток товара для алертов',
  requiredCapability: 'store-catalog.edit',
  severity: 'medium',
  params: [
    {
      name: 'item_id',
      label: 'Товар',
      type: 'select',
      required: true,
      description: 'Какой товар',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('inventory_items')
          .select('id, name, low_stock_threshold')
          .order('name')
          .limit(40)
        return (data || []).map((i: any) => ({
          value: i.id,
          label: `${i.name}${i.low_stock_threshold ? ` (текущий мин: ${i.low_stock_threshold})` : ''}`,
        }))
      },
    },
    {
      name: 'threshold',
      label: 'Минимальный порог (шт)',
      type: 'number',
      required: true,
      description: 'Сколько штук считать "низкий остаток". 0 — отключить алерт',
    },
  ],
  handler: async (input, ctx) => {
    const itemId = String(input.item_id || '')
    const threshold = Number(input.threshold || 0)
    if (!itemId) return { ok: false, message: 'Не выбран товар.' }

    const { data: item } = await ctx.supabase.from('inventory_items').select('id, name').eq('id', itemId).single()
    if (!item) return { ok: false, message: 'Товар не найден.' }

    const { error } = await ctx.supabase
      .from('inventory_items')
      .update({ low_stock_threshold: threshold })
      .eq('id', itemId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-item',
        entityId: itemId,
        action: 'update-threshold',
        payload: { name: item.name, threshold, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: threshold > 0
        ? `✅ Алерт для "${item.name}" установлен: при остатке ≤ ${threshold} шт.`
        : `🔕 Алерт для "${item.name}" отключён.`,
    }
  },
}
