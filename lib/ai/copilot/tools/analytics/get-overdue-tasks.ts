/**
 * AI tool: показать просроченные задачи.
 * Capability: tasks.view
 */

import type { CopilotTool } from '../../types'

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
      .select('id, title, due_date, operator:operator_id(name, short_name)')
      .eq('status', 'open')
      .lt('due_date', today)
      .order('due_date')
      .limit(30)
    if (error) return { ok: false, message: `Ошибка: ${error.message}` }

    const rows = data || []
    if (rows.length === 0) return { ok: true, message: '✅ Нет просроченных задач.' }

    const lines: string[] = [`⚠️ Просрочено: ${rows.length} задач\n`]
    for (const t of rows.slice(0, 15) as any[]) {
      const op = Array.isArray(t.operator) ? t.operator[0] : t.operator
      const opName = op?.short_name || op?.name || '?'
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
