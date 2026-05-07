/**
 * AI tool: отменить смену.
 * Capability: shifts.delete
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const cancelShiftTool: CopilotTool = {
  name: 'cancel_shift',
  category: 'shifts',
  description: 'Отменить запланированную смену',
  requiredCapability: 'shifts.delete',
  severity: 'high',
  params: [
    {
      name: 'shift_id',
      label: 'Какую смену',
      type: 'select',
      required: true,
      description: 'ID смены из ближайших',
      getOptions: async (ctx) => {
        const today = new Date().toISOString().slice(0, 10)
        const { data } = await ctx.supabase
          .from('shifts')
          .select('id, date, shift_type, operator_name, operator_id, company_id')
          .gte('date', today)
          .order('date')
          .limit(100)
        const rows = data || []
        const { resolveCompanyNames, resolveOperatorNames } = await import('../../query-helpers')
        const [companyMap, operatorMap] = await Promise.all([
          resolveCompanyNames(ctx.supabase, rows as any),
          resolveOperatorNames(ctx.supabase, rows as any),
        ])
        return rows.map((s: any) => {
          const opName = operatorMap.get(String(s.operator_id)) || s.operator_name || ''
          const coName = companyMap.get(String(s.company_id)) || ''
          return {
            value: String(s.id),
            label: `${s.date} ${s.shift_type === 'night' ? '🌙' : '☀️'} ${coName} · ${opName}`,
          }
        })
      },
    },
    {
      name: 'reason',
      label: 'Причина',
      type: 'string',
      required: false,
      description: 'Опционально',
    },
  ],
  handler: async (input, ctx) => {
    const shiftId = String(input.shift_id || '')
    const reason = String(input.reason || '').trim() || null
    if (!shiftId) return { ok: false, message: 'Не выбрана смена.' }

    const { data: shift, error: getErr } = await ctx.supabase
      .from('shifts')
      .select('id, date, shift_type, operator_id, company_id')
      .eq('id', shiftId)
      .single()
    if (getErr || !shift) return { ok: false, message: 'Смена не найдена.' }

    // В таблице shifts нет колонки status — отмена = удаление записи.
    const { error } = await ctx.supabase.from('shifts').delete().eq('id', shiftId)
    if (error) return { ok: false, message: `Не удалось отменить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'shift',
        entityId: shiftId,
        action: 'cancel',
        payload: { date: shift.date, shift_type: shift.shift_type, reason, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `Смена ${shift.date} (${shift.shift_type === 'night' ? 'ночь' : 'день'}) отменена.` }
  },
}
