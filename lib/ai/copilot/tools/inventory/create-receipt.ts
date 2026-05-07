/**
 * AI tool: оформить приход товара от поставщика.
 * Capability: receipts.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const createReceiptTool: CopilotTool = {
  name: 'create_receipt',
  category: 'inventory',
  description: 'Оформить приход товара от поставщика',
  requiredCapability: 'receipts.create',
  severity: 'medium',
  params: [
    {
      name: 'item_id',
      label: 'Товар',
      type: 'select',
      required: true,
      description: 'Что приходим',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('inventory_items').select('id, name').order('name')
        return (data || []).map((i: any) => ({ value: i.id, label: i.name }))
      },
    },
    {
      name: 'quantity',
      label: 'Количество',
      type: 'number',
      required: true,
      description: 'Сколько шт',
    },
    {
      name: 'cost_per_unit',
      label: 'Цена закупки за единицу (₸)',
      type: 'number',
      required: true,
      description: 'Цена закупки',
    },
    {
      name: 'supplier_id',
      label: 'Поставщик',
      type: 'select',
      required: false,
      description: 'От кого пришло',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('inventory_suppliers').select('id, name').order('name')
        return (data || []).map((s: any) => ({ value: s.id, label: s.name }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const itemId = String(input.item_id || '')
    const qty = Number(input.quantity || 0)
    const cost = Number(input.cost_per_unit || 0)
    const supplierId = input.supplier_id ? String(input.supplier_id) : null
    if (!itemId || qty <= 0 || cost < 0) return { ok: false, message: 'Не хватает данных.' }

    const total = qty * cost
    const { data, error } = await ctx.supabase
      .from('inventory_receipts')
      .insert([{ item_id: itemId, quantity: qty, cost_per_unit: cost, total_cost: total, supplier_id: supplierId, received_at: new Date().toISOString() }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось оприходовать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-receipt',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { item_id: itemId, qty, cost, total, supplier_id: supplierId, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📦 Приход: ${qty} шт × ${cost.toLocaleString('ru-RU')} ₸ = ${total.toLocaleString('ru-RU')} ₸ оприходовано.` }
  },
}
