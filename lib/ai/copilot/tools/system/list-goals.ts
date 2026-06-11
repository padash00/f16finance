/**
 * AI tool: список активных целей.
 * Capability: goals.view
 */

import type { CopilotTool } from '../../types'

export const listGoalsTool: CopilotTool = {
  name: 'list_goals',
  category: 'system',
  description: 'Показать список активных целей команды',
  requiredCapability: 'goals.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    let q = ctx.supabase
      .from('goals')
      .select('id, title, target_value, period_end, status')
      .eq('status', 'active')
      .order('period_end')
    // Мультитенантная изоляция: только цели своей организации (goals.organization_id).
    if (ctx.organizationId) q = q.eq('organization_id', ctx.organizationId)
    const { data, error } = await q
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }
    if (!data?.length) return { ok: true, message: '🎯 Активных целей нет.' }

    const lines: string[] = [`🎯 Активных целей: ${data.length}\n`]
    for (const g of data as any[]) {
      const target = g.target_value ? ` · цель: ${Number(g.target_value).toLocaleString('ru-RU')}` : ''
      lines.push(`• ${g.title} (до ${g.period_end})${target}`)
    }
    return { ok: true, message: lines.join('\n'), data: { count: data.length } }
  },
}
