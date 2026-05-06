/**
 * AI tool: списать товар (брак, недостача).
 * Capability: store-writeoffs.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const writeoffItemTool: CopilotTool = {
  name: 'writeoff_item',
  category: 'inventory',
  description: 'Списать товар (брак, недостача, служебное использование)',
  requiredCapability: 'store-writeoffs.create',
  severity: 'high',
  params: [
    {
      name: 'company_id',
      label: 'С какой точки',
      type: 'select',
      required: true,
      description: 'Точка списания',
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
      description: 'Какой товар',
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
      description: 'Сколько списать',
    },
    {
      name: 'reason',
      label: 'Причина',
      type: 'select',
      required: true,
      description: 'Причина списания',
      getOptions: async () => [
        { value: 'damage', label: 'Брак / порча' },
        { value: 'expired', label: 'Просрочка' },
        { value: 'shortage', label: 'Недостача' },
        { value: 'personal_use', label: 'Служебное использование' },
        { value: 'other', label: 'Другое' },
      ],
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
    const reason = String(input.reason || '')
    const comment = String(input.comment || '').trim() || null
    if (!companyId || !itemId || quantity <= 0 || !reason) return { ok: false, message: 'Не хватает данных.' }

    const { data, error } = await ctx.supabase
      .from('inventory_writeoffs')
      .insert([{ company_id: companyId, item_id: itemId, quantity, reason, comment, status: 'created' }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось списать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-writeoff',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { company_id: companyId, item_id: itemId, quantity, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `Списано ${quantity} шт. Причина: ${reason}.` }
  },
}
