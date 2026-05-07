/**
 * AI tool: показать просроченные задачи.
 * Capability: tasks.view
 */

import type { CopilotTool } from '../../types'
import { resolveOperatorNames } from '../../query-helpers'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export const getOverdueTasksTool: CopilotTool = {
  name: 'get_overdue_tasks',
  category: 'analytics',
  description: 'Показать просроченные задачи (с прошедшим дедлайном и статусом open)',
  requiredCapability: 'tasks.view',
  severity: 'low',
  params: [],
  handler: async (_input, ctx) => {
    const today = todayISO()
    const { data, error } = await ctx.supabase
      .from('tasks')
      .select('id, title, due_date, operator_id')
      .eq('status', 'open')
      .lt('due_date', today)
      .order('due_date')
      .limit(30)
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    if (rows.length === 0) return { ok: true, message: '✅ Нет просроченных задач.' }

    const operatorMap = await resolveOperatorNames(ctx.supabase, rows as any)
    const lines: string[] = [`⚠️ Просрочено: ${rows.length} задач\n`]
    for (const t of rows.slice(0, 15) as any[]) {
      const opName = operatorMap.get(String(t.operator_id)) || '?'
      lines.push(`  • ${t.title} (${opName}, дедлайн ${t.due_date})`)
    }
    if (rows.length > 15) lines.push(`  ... и ещё ${rows.length - 15}`)

    return {
      ok: true,
      message: lines.join('\n'),
      data: { count: rows.length },
      followUps: [{ label: '👁 Открыть задачи', action: 'open:/tasks' }],
    }
  },
}
