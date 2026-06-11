/**
 * AI tool: отложить напоминание.
 * Capability: reminders.update
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const snoozeReminderTool: CopilotTool = {
  name: 'snooze_reminder',
  category: 'system',
  description: 'Отложить напоминание на N минут / часов / дней',
  requiredCapability: 'reminders.update',
  severity: 'low',
  params: [
    {
      name: 'reminder_id',
      label: 'Напоминание',
      type: 'select',
      required: true,
      description: 'Что отложить',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('reminders').select('id, text, remind_at').eq('status', 'pending').order('remind_at').limit(50)
        return (data || []).map((r: any) => {
          const when = r.remind_at ? new Date(r.remind_at).toLocaleString('ru-RU') : ''
          return { value: r.id, label: `${when} — ${String(r.text).slice(0, 40)}` }
        })
      },
    },
    {
      name: 'snooze_for',
      label: 'На сколько',
      type: 'select',
      required: true,
      description: 'Период переноса',
      getOptions: async () => [
        { value: '15m', label: '15 минут' },
        { value: '1h', label: '1 час' },
        { value: '3h', label: '3 часа' },
        { value: '1d', label: '1 день' },
        { value: '3d', label: '3 дня' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const reminderId = String(input.reminder_id || '')
    const snooze = String(input.snooze_for || '15m')
    if (!reminderId) return { ok: false, message: 'Не выбрано напоминание.' }

    const map: Record<string, number> = { '15m': 15 * 60_000, '1h': 60 * 60_000, '3h': 3 * 60 * 60_000, '1d': 86_400_000, '3d': 3 * 86_400_000 }
    const ms = map[snooze] || 15 * 60_000

    // Мультитенантная изоляция: откладывать можно только напоминание своей организации.
    let beforeQ = ctx.supabase.from('reminders').select('text, remind_at, organization_id').eq('id', reminderId)
    if (ctx.organizationId) beforeQ = beforeQ.eq('organization_id', ctx.organizationId)
    const { data: before } = await beforeQ.maybeSingle()
    if (!before) return { ok: false, message: 'Напоминание не найдено.' }
    const newTime = new Date(Date.now() + ms).toISOString()
    const { error } = await ctx.supabase.from('reminders').update({ remind_at: newTime }).eq('id', reminderId)
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'reminder',
        entityId: reminderId,
        action: 'snooze',
        payload: { text: before?.text, old: before?.remind_at, new: newTime, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `⏰ Отложено на ${snooze}: "${String(before?.text || '').slice(0, 40)}"` }
  },
}
