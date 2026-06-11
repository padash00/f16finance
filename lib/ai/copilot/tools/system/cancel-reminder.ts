/**
 * AI tool: отменить напоминание.
 * Capability: reminders.delete
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const cancelReminderTool: CopilotTool = {
  name: 'cancel_reminder',
  category: 'system',
  description: 'Отменить запланированное напоминание',
  requiredCapability: 'reminders.delete',
  severity: 'low',
  params: [
    {
      name: 'reminder_id',
      label: 'Напоминание',
      type: 'select',
      required: true,
      description: 'Что отменить',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('reminders').select('id, text, remind_at').eq('status', 'pending').order('remind_at').limit(50)
        return (data || []).map((r: any) => {
          const when = r.remind_at ? new Date(r.remind_at).toLocaleString('ru-RU') : ''
          return { value: r.id, label: `${when} — ${String(r.text).slice(0, 40)}` }
        })
      },
    },
  ],
  handler: async (input, ctx) => {
    const reminderId = String(input.reminder_id || '')
    if (!reminderId) return { ok: false, message: 'Не выбрано.' }

    // Мультитенантная изоляция: отменять можно только напоминание своей организации.
    let beforeQ = ctx.supabase.from('reminders').select('text, organization_id').eq('id', reminderId)
    if (ctx.organizationId) beforeQ = beforeQ.eq('organization_id', ctx.organizationId)
    const { data: before } = await beforeQ.maybeSingle()
    if (!before) return { ok: false, message: 'Напоминание не найдено.' }
    const { error } = await ctx.supabase.from('reminders').update({ status: 'cancelled' }).eq('id', reminderId)
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'reminder',
        entityId: reminderId,
        action: 'cancel',
        payload: { text: before?.text, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🗑 Напоминание отменено.` }
  },
}
