/**
 * AI tool: изменить телефон оператора.
 * Capability: operators.update
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'
import { scopedOperatorIds } from '../../query-helpers'

export const updateOperatorPhoneTool: CopilotTool = {
  name: 'update_operator_phone',
  category: 'team',
  description: 'Изменить телефон оператора',
  requiredCapability: 'operators.update',
  severity: 'medium',
  params: [
    {
      name: 'operator_id',
      label: 'Оператор',
      type: 'select',
      required: true,
      description: 'Кому меняем',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('operators').select('id, name, short_name, phone').eq('is_active', true).order('name')
        return (data || []).map((op: any) => ({ value: op.id, label: `${op.short_name || op.name}${op.phone ? ` · ${op.phone}` : ''}` }))
      },
    },
    { name: 'new_phone', label: 'Новый телефон', type: 'string', required: true, description: 'В формате +7...' },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const phone = String(input.new_phone || '').trim()
    if (!operatorId || !phone) return { ok: false, message: 'Не хватает данных.' }

    // Мультитенантная изоляция: менять можно только оператора своей организации.
    const allowed = await scopedOperatorIds(ctx)
    if (allowed && !allowed.includes(operatorId)) return { ok: false, message: 'Оператор не найден.' }

    const { data: before } = await ctx.supabase.from('operators').select('name, phone').eq('id', operatorId).single()
    const { error } = await ctx.supabase.from('operators').update({ phone }).eq('id', operatorId)
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator',
        entityId: operatorId,
        action: 'update-phone',
        payload: { name: before?.name, old: before?.phone, new: phone, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📞 ${before?.name || ''}: ${before?.phone || '—'} → ${phone}` }
  },
}
