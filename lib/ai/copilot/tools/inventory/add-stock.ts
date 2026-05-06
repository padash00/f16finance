/**
 * AI tool: оприходование товара (увеличение остатка без поставщика).
 * Capability: store-postings.create
 *
 * Используется для: излишки при ревизии, корректировка остатков,
 * добавление товара без накладной.
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const addStockTool: CopilotTool = {
  name: 'add_stock',
  category: 'inventory',
  description: 'Оприходовать товар на склад (без поставщика — корректировка)',
  requiredCapability: 'store-postings.create',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'На какую точку',
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
      description: 'Какой товар оприходовать',
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
      description: 'Сколько добавить',
    },
    {
      name: 'reason',
      label: 'Причина',
      type: 'string',
      required: true,
      description: 'Почему оприходование',
      extractHint: 'излишки при ревизии',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const itemId = String(input.item_id || '')
    const quantity = Number(input.quantity || 0)
    const reason = String(input.reason || '').trim()
    if (!companyId || !itemId || quantity <= 0 || !reason) return { ok: false, message: 'Не хватает данных.' }

    const { data, error } = await ctx.supabase
      .from('inventory_postings')
      .insert([{ company_id: companyId, item_id: itemId, quantity, reason, status: 'created' }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-posting',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { company_id: companyId, item_id: itemId, quantity, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Оприходовано ${quantity} шт. Причина: ${reason}` }
  },
}
