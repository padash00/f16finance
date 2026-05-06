/**
 * AI tool: прямой перенос товара со склада на витрину
 * (без создания заявки — для админа).
 * Capability: store-showcase.move
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const transferToShowcaseTool: CopilotTool = {
  name: 'transfer_to_showcase',
  category: 'inventory',
  description: 'Перенести товар со склада на витрину',
  requiredCapability: 'store-showcase.move',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: true,
      description: 'Точка',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('companies').select('id, name, code').order('name')
        return (data || []).map((c: any) => ({ value: c.id, label: c.name + (c.code ? ` (${c.code})` : '') }))
      },
    },
    {
      name: 'item_id',
      label: 'Товар',
      type: 'select',
      required: true,
      description: 'Какой товар перенести',
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
      description: 'Сколько перенести',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const itemId = String(input.item_id || '')
    const quantity = Number(input.quantity || 0)
    if (!companyId || !itemId || quantity <= 0) return { ok: false, message: 'Не хватает данных.' }

    // Используем RPC если есть, иначе через INSERT в movements
    const { error } = await ctx.supabase.rpc('inventory_transfer_warehouse_to_showcase', {
      p_company_id: companyId,
      p_item_id: itemId,
      p_quantity: quantity,
      p_actor_user_id: ctx.userId,
    })
    if (error) return { ok: false, message: `Не удалось перенести: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-transfer',
        entityId: `${companyId}:${itemId}`,
        action: 'warehouse-to-showcase',
        payload: { company_id: companyId, item_id: itemId, quantity, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Перенесено ${quantity} шт. со склада на витрину.` }
  },
}
