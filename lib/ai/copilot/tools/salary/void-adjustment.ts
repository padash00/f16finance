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
        // Без JOIN — просто базовые поля. Имя оператора получим отдельным запросом.
        // Если query ломается — логируем И возвращаем хотя бы что-то для дебага.
        const { data, error } = await ctx.supabase
          .from('operator_salary_adjustments')
          .select('id, date, kind, amount, comment, status, voided_at, operator_id')
          .order('date', { ascending: false })
          .limit(100)

        if (error) {
          console.error('[copilot] void-adjustment getOptions ERROR:', JSON.stringify(error))
          return []
        }
        console.log('[copilot] void-adjustment got', data?.length || 0, 'rows total')

        const active = (data || []).filter((a: any) => {
          if (a.voided_at) return false
          if (a.status === 'voided') return false
          return true
        })
        console.log('[copilot] void-adjustment active:', active.length)

        if (active.length === 0) return []

        // Подгрузим имена операторов одним запросом
        const opIds = Array.from(new Set(active.map((a: any) => a.operator_id).filter(Boolean)))
        const opMap = new Map<string, string>()
        if (opIds.length > 0) {
          const { data: ops } = await ctx.supabase
            .from('operators')
            .select('id, name, short_name')
            .in('id', opIds)
          for (const op of (ops || []) as any[]) {
            opMap.set(String(op.id), op.short_name || op.name || '')
          }
        }

        const kindLabel: Record<string, string> = { fine: '⚠ Штраф', bonus: '🎁 Бонус', advance: '💵 Аванс', debt: '📉 Долг' }
        return active.map((a: any) => ({
          value: String(a.id),
          label: `${a.date} · ${kindLabel[a.kind] || a.kind} · ${Number(a.amount).toLocaleString('ru-RU')} ₸ · ${opMap.get(String(a.operator_id)) || ''}`,
        }))
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

    // Сначала пробуем со status (новая схема)
    let { error } = await ctx.supabase
      .from('operator_salary_adjustments')
      .update({
        status: 'voided',
        voided_at: new Date().toISOString(),
        voided_by: ctx.userId,
        void_reason: reason,
      })
      .eq('id', id)

    // Если упало (например constraint check на status) — fallback без status
    if (error && (error.message?.includes('status') || error.code === '23514')) {
      const fallback = await ctx.supabase
        .from('operator_salary_adjustments')
        .update({
          voided_at: new Date().toISOString(),
          voided_by: ctx.userId,
          void_reason: reason,
        })
        .eq('id', id)
      error = fallback.error
    }

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
