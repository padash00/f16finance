/**
 * AI tool: создать задачу для оператора.
 * Capability: tasks.create
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

export const createTaskTool: CopilotTool = {
  name: 'create_task',
  category: 'tasks',
  description: 'Создать задачу для оператора',
  requiredCapability: 'tasks.create',
  severity: 'medium',
  params: [
    {
      name: 'operator_id',
      label: 'Кому ставим задачу',
      type: 'select',
      required: true,
      description: 'ID оператора',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase.from('operators').select('id, name, short_name').eq('is_active', true).order('name')
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    {
      name: 'title',
      label: 'Что нужно сделать',
      type: 'string',
      required: true,
      description: 'Короткое описание задачи',
      extractHint: 'Проверить кассу',
    },
    {
      name: 'description',
      label: 'Подробности',
      type: 'string',
      required: false,
      description: 'Детальное описание (опционально)',
    },
    {
      name: 'due_date',
      label: 'Срок (YYYY-MM-DD)',
      type: 'date',
      required: false,
      description: 'Дедлайн, если есть',
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const title = String(input.title || '').trim()
    const description = String(input.description || '').trim() || null
    const dueDate = String(input.due_date || '').trim() || null

    if (!operatorId || !title) return { ok: false, message: 'Не хватает данных (оператор, заголовок).' }

    const { data, error } = await ctx.supabase
      .from('tasks')
      .insert([
        {
          operator_id: operatorId,
          title,
          description,
          due_date: dueDate,
          status: 'open',
          created_by: ctx.userId,
          source: 'copilot',
        },
      ])
      .select('id')
      .single()
    if (error) return { ok: false, message: `Не удалось создать задачу: ${error.message}` }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'task',
        entityId: data?.id || 'unknown',
        action: 'create',
        payload: { operator_id: operatorId, title, due_date: dueDate, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return {
      ok: true,
      message: `Задача "${title}" создана${dueDate ? ` (срок ${dueDate})` : ''}.`,
      data: { taskId: data?.id },
    }
  },
}
