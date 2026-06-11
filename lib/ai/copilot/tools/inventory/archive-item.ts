/**
 * AI tool: архивировать товар (мягкое удаление из каталога).
 * Capability: catalog.archive
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const archiveItemTool: CopilotTool = {
  name: 'archive_item',
  category: 'inventory',
  description: 'Архивировать товар из каталога',
  requiredCapability: 'catalog.archive',
  severity: 'medium',
  params: [
    {
      name: 'item_id',
      label: 'Товар',
      type: 'select',
      required: true,
      description: 'Какой архивировать',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('inventory_items').select('id, name').is('archived_at', null).order('name')
        return (data || []).map((i: any) => ({ value: i.id, label: i.name }))
      },
    },
    { name: 'reason', label: 'Причина', type: 'string', required: true, description: 'Почему' },
  ],
  handler: async (input, ctx) => {
    const itemId = String(input.item_id || '')
    const reason = String(input.reason || '').trim()
    if (!itemId || !reason) return { ok: false, message: 'Не хватает данных.' }

    // TODO isolation: inventory_items — глобальный каталог без company_id/organization_id,
    // ownership-проверку по тенанту тут сделать нельзя (товары общие для всех точек).
    const { data: before } = await ctx.supabase.from('inventory_items').select('name').eq('id', itemId).single()
    const { error } = await ctx.supabase
      .from('inventory_items')
      .update({ archived_at: new Date().toISOString(), archive_reason: reason })
      .eq('id', itemId)
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'inventory-item',
        entityId: itemId,
        action: 'archive',
        payload: { name: before?.name, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📦 "${before?.name}" архивирован. Причина: ${reason}` }
  },
}
