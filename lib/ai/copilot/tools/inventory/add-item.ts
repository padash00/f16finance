/**
 * AI tool: добавить товар в каталог.
 * Capability: catalog.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const addItemTool: CopilotTool = {
  name: 'add_item',
  category: 'inventory',
  description: 'Добавить новый товар в каталог',
  requiredCapability: 'catalog.create',
  severity: 'medium',
  params: [
    { name: 'name', label: 'Название товара', type: 'string', required: true, description: 'Как называется' },
    { name: 'sale_price', label: 'Цена продажи (₸)', type: 'number', required: true, description: 'По какой продаём' },
    { name: 'unit', label: 'Единица', type: 'string', required: false, description: 'шт / кг / л', extractHint: 'шт' },
    { name: 'barcode', label: 'Штрихкод', type: 'string', required: false, description: 'Опционально' },
  ],
  handler: async (input, ctx) => {
    const name = String(input.name || '').trim()
    const price = Number(input.sale_price || 0)
    const unit = String(input.unit || 'шт').trim() || 'шт'
    const barcode = String(input.barcode || '').trim() || null
    if (!name || price < 0) return { ok: false, message: 'Не хватает данных.' }

    const { data, error } = await ctx.supabase
      .from('inventory_items')
      .insert([{ name, sale_price: price, unit, barcode }])
      .select('id, name')
      .single()
    if (error) return { ok: false, message: `Не удалось добавить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-item',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { name, price, unit, barcode, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📦 Товар "${name}" добавлен (${price.toLocaleString('ru-RU')} ₸ / ${unit}).` }
  },
}
