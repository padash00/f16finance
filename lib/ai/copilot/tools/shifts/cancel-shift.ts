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
          .select('id, date, shift_type, operator:operator_id(name, short_name), company:company_id(name)')
          .eq('status', 'scheduled')
          .gte('date', today)
          .order('date')
          .limit(20)
        return (data || []).map((s: any) => {
          const op = Array.isArray(s.operator) ? s.operator[0] : s.operator
          const co = Array.isArray(s.company) ? s.company[0] : s.company
          return {
            value: s.id,
            label: `${s.date} ${s.shift_type === 'night' ? '🌙' : '☀️'} ${co?.name || ''} · ${op?.short_name || op?.name || ''}`,
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
      .select('id, date, shift_type, operator_id, company_id, status')
      .eq('id', shiftId)
      .single()
    if (getErr || !shift) return { ok: false, message: 'Смена не найдена.' }
    if (shift.status === 'closed') return { ok: false, message: 'Смена уже закрыта, отменить нельзя.' }

    const { error } = await ctx.supabase
      .from('shifts')
      .update({ status: 'cancelled', cancel_reason: reason, cancelled_at: new Date().toISOString() })
      .eq('id', shiftId)
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
