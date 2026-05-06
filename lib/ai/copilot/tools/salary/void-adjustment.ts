/**
 * AI tool: отменить корректировку (штраф/бонус/аванс).
 * Capability: salary.adjustment_void
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const voidAdjustmentTool: CopilotTool = {
  name: 'void_adjustment',
  category: 'salary',
  description: 'Отменить штраф / бонус / аванс (корректировку зарплаты)',
  requiredCapability: 'salary.adjustment_void',
  severity: 'high',
  params: [
    {
      name: 'adjustment_id',
      label: 'Какую корректировку',
      type: 'select',
      required: true,
      description: 'ID активной корректировки',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('operator_salary_adjustments')
          .select('id, date, kind, amount, comment, operator:operator_id(name, short_name)')
          .eq('status', 'active')
          .order('date', { ascending: false })
          .limit(100)
        return (data || []).map((a: any) => {
          const op = Array.isArray(a.operator) ? a.operator[0] : a.operator
          const kindLabel: Record<string, string> = { fine: '⚠ Штраф', bonus: '🎁 Бонус', advance: '💵 Аванс', debt: '📉 Долг' }
          return {
            value: a.id,
            label: `${a.date} · ${kindLabel[a.kind] || a.kind} · ${Number(a.amount).toLocaleString('ru-RU')} ₸ · ${op?.short_name || op?.name || ''}`,
          }
        })
      },
    },
    {
      name: 'reason',
      label: 'Причина отмены',
      type: 'string',
      required: true,
      description: 'Почему отменяем',
    },
  ],
  handler: async (input, ctx) => {
    const id = String(input.adjustment_id || '')
    const reason = String(input.reason || '').trim()
    if (!id || !reason) return { ok: false, message: 'Нужны корректировка и причина.' }

    const { error } = await ctx.supabase
      .from('operator_salary_adjustments')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: ctx.userId,
        void_reason: reason,
      })
      .eq('id', id)
    if (error) return { ok: false, message: `Не удалось отменить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator-salary-adjustment',
        entityId: id,
        action: 'void',
        payload: { reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `❌ Корректировка отменена. Причина: ${reason}` }
  },
}
