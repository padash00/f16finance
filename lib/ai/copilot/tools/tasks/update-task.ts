/**
 * AI tool: обновить задачу (заголовок, описание, дедлайн).
 * Capability: tasks.edit
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const updateTaskTool: CopilotTool = {
  name: 'update_task',
  category: 'tasks',
  description: 'Обновить заголовок / описание / дедлайн задачи',
  requiredCapability: 'tasks.edit',
  severity: 'medium',
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
          .neq('status', 'done')
          .order('created_at', { ascending: false })
          .limit(100)
        return (data || []).map((t: any) => ({
          value: t.id,
          label: `${t.title}${t.due_date ? ` · ${t.due_date}` : ''}`,
        }))
      },
    },
    {
      name: 'new_title',
      label: 'Новый заголовок',
      type: 'string',
      required: false,
      description: 'Если меняем',
    },
    {
      name: 'new_description',
      label: 'Новое описание',
      type: 'string',
      required: false,
      description: 'Если хочешь обновить детали',
    },
    {
      name: 'new_due_date',
      label: 'Новый дедлайн (YYYY-MM-DD)',
      type: 'date',
      required: false,
      description: 'Если переносим срок',
    },
  ],
  handler: async (input, ctx) => {
    const taskId = String(input.task_id || '')
    const newTitle = String(input.new_title || '').trim() || null
    const newDescription = String(input.new_description || '').trim() || null
    const newDueDate = String(input.new_due_date || '').trim() || null
    if (!taskId) return { ok: false, message: 'Не выбрана задача.' }
    if (!newTitle && !newDescription && !newDueDate) {
      return { ok: false, message: 'Нечего менять.' }
    }

    const updates: Record<string, unknown> = {}
    if (newTitle) updates.title = newTitle
    if (newDescription) updates.description = newDescription
    if (newDueDate) updates.due_date = newDueDate

    const { error } = await ctx.supabase.from('tasks').update(updates).eq('id', taskId)
    if (error) return { ok: false, message: `Не удалось обновить: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'task',
        entityId: taskId,
        action: 'update',
        payload: { changes: updates, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: '✅ Задача обновлена.' }
  },
}
