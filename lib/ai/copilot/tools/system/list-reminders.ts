/**
 * AI tool: список своих напоминаний.
 * Capability: reminders.view
 */

import type { CopilotTool } from '../../types'

export const listRemindersTool: CopilotTool = {
  name: 'list_reminders',
  category: 'system',
  description: 'Показать активные напоминания',
  requiredCapability: 'reminders.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    let q = ctx.supabase
      .from('reminders')
      .select('id, text, remind_at, audience, status')
      .eq('status', 'pending')
      .order('remind_at')
      .limit(50)
    // Мультитенантная изоляция: только напоминания своей организации (reminders.organization_id).
    if (ctx.organizationId) q = q.eq('organization_id', ctx.organizationId)
    const { data, error } = await q
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: '⏰ Активных напоминаний нет.' }

    const lines: string[] = [`⏰ Напоминаний: ${data.length}\n`]
    for (const r of data as any[]) {
      const when = r.remind_at ? new Date(r.remind_at).toLocaleString('ru-RU') : '?'
      const aud = r.audience === 'team' ? ' 👥' : ''
      lines.push(`• ${when} — ${r.text}${aud}`)
    }
    return { ok: true, message: lines.join('\n'), data: { count: data.length } }
  },
}
