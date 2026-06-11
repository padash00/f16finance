/**
 * AI tool: закрыть цель (отметить выполненной/неудачной).
 * Capability: goals.update
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const closeGoalTool: CopilotTool = {
  name: 'close_goal',
  category: 'system',
  description: 'Закрыть цель (выполнена / провалена)',
  requiredCapability: 'goals.update',
  severity: 'medium',
  params: [
    {
      name: 'goal_id',
      label: 'Цель',
      type: 'select',
      required: true,
      description: 'Какую закрываем',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('goals').select('id, title, period_end').eq('status', 'active').order('period_end')
        return (data || []).map((g: any) => ({ value: g.id, label: `${g.title} (до ${g.period_end})` }))
      },
    },
    {
      name: 'outcome',
      label: 'Результат',
      type: 'select',
      required: true,
      description: 'Как закрываем',
      getOptions: async () => [
        { value: 'achieved', label: '✅ Выполнена' },
        { value: 'failed', label: '❌ Провалена' },
        { value: 'cancelled', label: '🚫 Отменена' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const goalId = String(input.goal_id || '')
    const outcome = String(input.outcome || '')
    if (!goalId || !outcome) return { ok: false, message: 'Не хватает данных.' }

    // Мультитенантная изоляция: закрывать можно только цель своей организации.
    let goalQ = ctx.supabase.from('goals').select('title, organization_id').eq('id', goalId)
    if (ctx.organizationId) goalQ = goalQ.eq('organization_id', ctx.organizationId)
    const { data: goal } = await goalQ.maybeSingle()
    if (!goal) return { ok: false, message: 'Цель не найдена.' }
    const { error } = await ctx.supabase
      .from('goals')
      .update({ status: outcome, closed_at: new Date().toISOString() })
      .eq('id', goalId)
    if (error) return { ok: false, message: `Не удалось: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'goal',
        entityId: goalId,
        action: 'close',
        payload: { title: goal?.title, outcome, via: 'copilot', source: ctx.source },
      })
    } catch {}

    const labels: Record<string, string> = { achieved: '✅', failed: '❌', cancelled: '🚫' }
    return { ok: true, message: `${labels[outcome]} Цель "${goal?.title}" закрыта (${outcome}).` }
  },
}
