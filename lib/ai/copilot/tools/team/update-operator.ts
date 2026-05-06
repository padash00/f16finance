/**
 * AI tool: обновить профиль оператора (имя, телефон).
 * Capability: operators.edit
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const updateOperatorTool: CopilotTool = {
  name: 'update_operator',
  category: 'team',
  description: 'Обновить имя/короткое имя/телефон оператора',
  requiredCapability: 'operators.edit',
  severity: 'medium',
  params: [
    {
      name: 'operator_id',
      label: 'Какой оператор',
      type: 'select',
      required: true,
      description: 'ID оператора',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('operators').select('id, name, short_name').eq('is_active', true).order('name')
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    {
      name: 'new_name',
      label: 'Новое полное имя',
      type: 'string',
      required: false,
      description: 'Если меняем ФИО',
    },
    {
      name: 'new_short_name',
      label: 'Новое короткое имя',
      type: 'string',
      required: false,
      description: 'Если меняем краткое имя',
    },
    {
      name: 'new_phone',
      label: 'Новый телефон',
      type: 'string',
      required: false,
      description: 'Опционально',
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const newName = String(input.new_name || '').trim() || null
    const newShortName = String(input.new_short_name || '').trim() || null
    const newPhone = String(input.new_phone || '').trim() || null
    if (!operatorId) return { ok: false, message: 'Не выбран оператор.' }
    if (!newName && !newShortName && !newPhone) {
      return { ok: false, message: 'Нечего менять.' }
    }

    const opUpdates: Record<string, string> = {}
    if (newName) opUpdates.name = newName
    if (newShortName) opUpdates.short_name = newShortName

    if (Object.keys(opUpdates).length > 0) {
      const { error } = await ctx.supabase.from('operators').update(opUpdates).eq('id', operatorId)
      if (error) return { ok: false, message: `Не удалось обновить оператора: ${error.message}` }
    }

    if (newPhone) {
      const { data: profile } = await ctx.supabase.from('operator_profiles').select('id').eq('operator_id', operatorId).maybeSingle()
      if (profile) {
        await ctx.supabase.from('operator_profiles').update({ phone: newPhone }).eq('id', profile.id)
      } else {
        await ctx.supabase.from('operator_profiles').insert([{ operator_id: operatorId, phone: newPhone }])
      }
    }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator',
        entityId: operatorId,
        action: 'update',
        payload: { changes: { ...opUpdates, ...(newPhone ? { phone: newPhone } : {}) }, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: '✅ Профиль оператора обновлён.' }
  },
}
