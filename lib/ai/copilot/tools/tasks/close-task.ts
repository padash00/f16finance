/**
 * AI tool: закрыть задачу.
 * Capability: tasks.edit
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const closeTaskTool: CopilotTool = {
  name: 'close_task',
  category: 'tasks',
  description: 'Закрыть задачу как выполненную',
  requiredCapability: 'tasks.edit',
  severity: 'low',
  params: [
    {
      name: 'task_id',
      label: 'Какую задачу',
      type: 'select',
      required: true,
      description: 'ID задачи из открытых',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('tasks')
          .select('id, title, due_date, operator:operator_id(name, short_name)')
          .eq('status', 'open')
          .order('created_at', { ascending: false })
          .limit(20)
        return (data || []).map((t: any) => {
          const op = Array.isArray(t.operator) ? t.operator[0] : t.operator
          const opName = op?.short_name || op?.name || ''
          return {
            value: t.id,
            label: `${t.title}${opName ? ` · ${opName}` : ''}${t.due_date ? ` · ${t.due_date}` : ''}`,
          }
        })
      },
    },
  ],
  handler: async (input, ctx) => {
    const taskId = String(input.task_id || '')
    if (!taskId) return { ok: false, message: 'Не выбрана задача.' }

    const { data: task, error: getErr } = await ctx.supabase
      .from('tasks')
      .select('id, title, status')
      .eq('id', taskId)
      .single()
    if (getErr || !task) return { ok: false, message: 'Задача не найдена.' }
    if (task.status === 'done') return { ok: false, message: 'Задача уже закрыта.' }

    const { error } = await ctx.supabase
      .from('tasks')
      .update({ status: 'done', closed_at: new Date().toISOString() })
      .eq('id', taskId)
    if (error) return { ok: false, message: `Не удалось закрыть: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'task',
        entityId: taskId,
        action: 'close',
        payload: { title: task.title, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `✅ Задача "${task.title}" закрыта.` }
  },
}
