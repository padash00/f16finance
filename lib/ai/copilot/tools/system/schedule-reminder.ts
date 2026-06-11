/**
 * AI tool: создать напоминание себе.
 * Capability: reminders.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const scheduleReminderTool: CopilotTool = {
  name: 'schedule_reminder',
  category: 'system',
  description: 'Создать напоминание (себе или команде)',
  requiredCapability: 'reminders.create',
  severity: 'low',
  params: [
    { name: 'text', label: 'Текст напоминания', type: 'string', required: true, description: 'Что напомнить' },
    { name: 'remind_at', label: 'Когда (YYYY-MM-DD HH:MM)', type: 'string', required: true, description: 'Дата + время', extractHint: '2026-05-08 09:00' },
    {
      name: 'audience',
      label: 'Кому',
      type: 'select',
      required: false,
      description: 'По умолчанию — себе',
      getOptions: async () => [
        { value: 'self', label: '👤 Только мне' },
        { value: 'team', label: '👥 Всей команде' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const text = String(input.text || '').trim()
    const remindAt = String(input.remind_at || '').trim()
    const audience = String(input.audience || 'self')
    if (!text || !remindAt) return { ok: false, message: 'Не хватает данных.' }

    let isoTime: string
    try {
      isoTime = new Date(remindAt.replace(' ', 'T')).toISOString()
    } catch {
      return { ok: false, message: 'Неправильный формат времени.' }
    }

    const { data, error } = await ctx.supabase
      .from('reminders')
      // Мультитенантная изоляция: привязываем напоминание к своей организации.
      .insert([{ text, remind_at: isoTime, audience, created_by: ctx.userId, status: 'pending', organization_id: ctx.organizationId || null }])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'reminder',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { text, remind_at: isoTime, audience, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `⏰ Напоминание на ${remindAt}: "${text}" ${audience === 'team' ? '(всей команде)' : '(себе)'}` }
  },
}
