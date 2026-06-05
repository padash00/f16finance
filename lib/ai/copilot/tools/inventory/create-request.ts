/**
 * AI tool: создать заявку на пополнение витрины со склада.
 * Capability: inventory-requests.create  (или store/requests.create — проверим)
 */

import type { CopilotTool } from '../../types'
import { companyOptions } from '../../query-helpers'
import { writeAuditLog } from '@/lib/server/audit'

export const createInventoryRequestTool: CopilotTool = {
  name: 'create_inventory_request',
  category: 'inventory',
  description: 'Создать заявку на пополнение витрины со склада',
  requiredCapability: 'store-requests.create',
  severity: 'medium',
  params: [
    {
      name: 'company_id',
      label: 'Точка',
      type: 'select',
      required: true,
      description: 'Точка для которой делаем заявку',
      getOptions: async (ctx) => companyOptions(ctx),
    },
    {
      name: 'item_id',
      label: 'Товар',
      type: 'select',
      required: true,
      description: 'Какой товар',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('inventory_items')
          .select('id, name')
          .order('name')
        return (data || []).map((i: any) => ({ value: i.id, label: i.name }))
      },
    },
    {
      name: 'quantity',
      label: 'Количество',
      type: 'number',
      required: true,
      description: 'Сколько штук перенести со склада на витрину',
    },
    {
      name: 'comment',
      label: 'Комментарий',
      type: 'string',
      required: false,
      description: 'Опционально',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const itemId = String(input.item_id || '')
    const quantity = Number(input.quantity || 0)
    const comment = String(input.comment || '').trim() || null

    if (!companyId || !itemId || quantity <= 0) {
      return { ok: false, message: 'Не хватает данных.' }
    }

    // Создаём заявку (status='new')
    const { data: req, error: reqErr } = await ctx.supabase
      .from('inventory_requests')
      .insert([
        {
          requesting_company_id: companyId,
          status: 'new',
          comment,
          created_by_kind: 'copilot',
        },
      ])
      .select('id')
      .single()
    if (reqErr) return { ok: false, message: `Не удалось создать заявку: ${reqErr.message}` }

    // Добавляем строку с товаром
    const { error: itemErr } = await ctx.supabase
      .from('inventory_request_items')
      .insert([
        {
          request_id: req?.id,
          item_id: itemId,
          quantity,
        },
      ])
    if (itemErr) {
      await ctx.supabase.from('inventory_requests').delete().eq('id', req?.id)
      return { ok: false, message: `Не удалось добавить товар: ${itemErr.message}` }
    }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-request',
        entityId: req?.id || 'unknown',
        action: 'create',
        payload: { company_id: companyId, item_id: itemId, quantity, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `Заявка создана: ${quantity} шт. Ожидает одобрения на странице /store/requests.`,
      data: { requestId: req?.id },
    }
  },
}
