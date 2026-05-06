/**
 * AI tool: взять задачу в работу (status open → in_progress).
 * Capability: tasks.edit
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const takeTaskTool: CopilotTool = {
  name: 'take_task',
  category: 'tasks',
  description: 'Взять задачу в работу (status: open → in_progress)',
  requiredCapability: 'tasks.edit',
  severity: 'low',
  params: [
    {
      name: 'task_id',
      label: 'Какую задачу',
      type: 'select',
      required: true,
      description: 'ID открытой задачи',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('tasks')
          .select('id, title, due_date')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
        return (data || []).map((t: any) => ({
          value: t.id,
          label: `${t.title}${t.due_date ? ` · до ${t.due_date}` : ''}`,
        }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const taskId = String(input.task_id || '')
    if (!taskId) return { ok: false, message: 'Не выбрана задача.' }

    const { data: task, error: getErr } = await ctx.supabase.from('tasks').select('id, title, status').eq('id', taskId).single()
    if (getErr || !task) return { ok: false, message: 'Задача не найдена.' }

    const { error } = await ctx.supabase
      .from('tasks')
      .update({ status: 'in_progress', started_at: new Date().toISOString() })
      .eq('id', taskId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'task',
        entityId: taskId,
        action: 'take',
        payload: { title: task.title, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `▶️ Задача "${task.title}" в работе.` }
  },
}
