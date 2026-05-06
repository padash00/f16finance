/**
 * AI tool: удалить задачу.
 * Capability: tasks.delete
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const deleteTaskTool: CopilotTool = {
  name: 'delete_task',
  category: 'tasks',
  description: 'Удалить задачу',
  requiredCapability: 'tasks.delete',
  severity: 'high',
  params: [
    {
      name: 'task_id',
      label: 'Какую задачу',
      type: 'select',
      required: true,
      description: 'ID задачи',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('tasks')
          .select('id, title, status, due_date')
          .order('created_at', { ascending: false })
          .limit(20)
        return (data || []).map((t: any) => ({
          value: t.id,
          label: `${t.title} · ${t.status}${t.due_date ? ` · ${t.due_date}` : ''}`,
        }))
      },
    },
  ],
  handler: async (input, ctx) => {
    const taskId = String(input.task_id || '')
    if (!taskId) return { ok: false, message: 'Не выбрана задача.' }

    const { data: task } = await ctx.supabase.from('tasks').select('id, title').eq('id', taskId).single()

    const { error } = await ctx.supabase.from('tasks').delete().eq('id', taskId)
    if (error) return { ok: false, message: `Не удалось удалить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'task',
        entityId: taskId,
        action: 'delete',
        payload: { title: task?.title, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `🗑 Задача "${task?.title || ''}" удалена.` }
  },
}
