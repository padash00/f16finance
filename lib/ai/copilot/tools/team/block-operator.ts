/**
 * AI tools: заблокировать / разблокировать оператора (is_active toggle).
 * Capability: operators.edit
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const blockOperatorTool: CopilotTool = {
  name: 'block_operator',
  category: 'team',
  description: 'Заблокировать (деактивировать) оператора',
  requiredCapability: 'operators.edit',
  severity: 'high',
  params: [
    {
      name: 'operator_id',
      label: 'Кого блокируем',
      type: 'select',
      required: true,
      description: 'ID активного оператора',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('operators').select('id, name, short_name').eq('is_active', true).order('name')
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    {
      name: 'reason',
      label: 'Причина',
      type: 'string',
      required: true,
      description: 'Почему блокируем (увольнение, нарушение и т.д.)',
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const reason = String(input.reason || '').trim()
    if (!operatorId || !reason) return { ok: false, message: 'Нужны оператор и причина.' }

    const { data: op, error: getErr } = await ctx.supabase.from('operators').select('id, name').eq('id', operatorId).single()
    if (getErr || !op) return { ok: false, message: 'Оператор не найден.' }

    const { error } = await ctx.supabase.from('operators').update({ is_active: false }).eq('id', operatorId)
    if (error) return { ok: false, message: `Не удалось заблокировать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator',
        entityId: operatorId,
        action: 'block',
        payload: { name: op.name, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🚫 Оператор ${op.name} заблокирован. Причина: ${reason}` }
  },
}

export const unblockOperatorTool: CopilotTool = {
  name: 'unblock_operator',
  category: 'team',
  description: 'Разблокировать (активировать) оператора',
  requiredCapability: 'operators.edit',
  severity: 'medium',
  params: [
    {
      name: 'operator_id',
      label: 'Кого активируем',
      type: 'select',
      required: true,
      description: 'ID заблокированного оператора',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('operators').select('id, name, short_name').eq('is_active', false).order('name')
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    if (!operatorId) return { ok: false, message: 'Не выбран оператор.' }
    const { data: op, error: getErr } = await ctx.supabase.from('operators').select('id, name').eq('id', operatorId).single()
    if (getErr || !op) return { ok: false, message: 'Оператор не найден.' }

    const { error } = await ctx.supabase.from('operators').update({ is_active: true }).eq('id', operatorId)
    if (error) return { ok: false, message: `Не удалось активировать: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator',
        entityId: operatorId,
        action: 'unblock',
        payload: { name: op.name, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Оператор ${op.name} разблокирован.` }
  },
}
