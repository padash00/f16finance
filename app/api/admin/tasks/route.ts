import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { resolveStaffByUser } from '@/lib/server/admin'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'
type TaskPriority = 'critical' | 'high' | 'medium' | 'low'

type TaskPayload = {
  title: string
  description?: string | null
  priority: TaskPriority
  status: TaskStatus
  operator_id?: string | null
  company_id?: string | null
  due_date?: string | null
  tags?: string[] | null
}

type Body =
  | {
      action: 'createTask'
      payload: TaskPayload
    }
  | {
      action: 'updateTask'
      taskId: string
      payload: Partial<TaskPayload> & { completed_at?: string | null }
    }
  | {
      action: 'changeStatus'
      taskId: string
      status: TaskStatus
    }
  | {
      action: 'addComment'
      taskId: string
      content: string
    }
  | {
      action: 'notifyTask'
      taskId: string
      message: string
    }

type ClientLike = ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      chat_id: chatId,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: 'true',
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || 'Telegram не принял сообщение')
  }
}

async function getNextTaskNumber(supabase: ClientLike) {
  const { data, error } = await supabase
    .from('tasks')
    .select('task_number')
    .order('task_number', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return Number(data?.task_number || 0) + 1
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'tasks')
    if (guard) return guard

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()
    const staffMember = await resolveStaffByUser(requestClient, user)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : requestClient

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    if (body.action === 'createTask') {
      if (!body.payload.title?.trim()) return json({ error: 'Название задачи обязательно' }, 400)

      let nextTaskNumber = await getNextTaskNumber(supabase)
      let insertError: any = null
      let createdTask: any = null
      const payloadBase = {
        title: body.payload.title.trim(),
        description: body.payload.description?.trim() || null,
        priority: body.payload.priority,
        status: body.payload.status,
        operator_id: body.payload.operator_id || null,
        company_id: body.payload.company_id || null,
        due_date: body.payload.due_date || null,
        tags: body.payload.tags || [],
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        const insertPayload: Record<string, unknown> = {
          ...payloadBase,
          task_number: nextTaskNumber,
        }
        if (staffMember?.id) {
          insertPayload.created_by = staffMember.id
        }

        const { data, error } = await supabase
          .from('tasks')
          .insert([insertPayload])
          .select('*')
          .single()

        insertError = error
        createdTask = data

        if (!error) break
        if (error?.code === '23505' || String(error?.message || '').toLowerCase().includes('duplicate')) {
          nextTaskNumber = await getNextTaskNumber(supabase)
          continue
        }
        if (String(error?.message || '').includes('tasks_created_by_fkey')) {
          const { created_by, ...withoutCreator } = insertPayload
          const retry = await supabase
            .from('tasks')
            .insert([withoutCreator])
            .select('*')
            .single()

          insertError = retry.error
          createdTask = retry.data
          break
        }
        break
      }

      if (insertError) throw insertError

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'task',
        entityId: String(createdTask.id),
        action: 'create',
        payload: { task_number: createdTask.task_number, title: createdTask.title, operator_id: createdTask.operator_id || null },
      })

      return json({ ok: true, data: createdTask })
    }

    if (body.action === 'updateTask') {
      if (!body.taskId) return json({ error: 'taskId обязателен' }, 400)

      const updatePayload = {
        title: body.payload.title?.trim(),
        description: body.payload.description?.trim() || null,
        priority: body.payload.priority,
        status: body.payload.status,
        operator_id: body.payload.operator_id || null,
        company_id: body.payload.company_id || null,
        due_date: body.payload.due_date || null,
        tags: body.payload.tags,
        completed_at:
          body.payload.completed_at !== undefined
            ? body.payload.completed_at
            : body.payload.status === 'done'
              ? new Date().toISOString()
              : body.payload.status
                ? null
                : undefined,
      }

      const sanitized = Object.fromEntries(
        Object.entries(updatePayload).filter(([, value]) => value !== undefined),
      )

      const { data, error } = await supabase.from('tasks').update(sanitized).eq('id', body.taskId).select('*').single()
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'task',
        entityId: String(body.taskId),
        action: 'update',
        payload: sanitized,
      })

      return json({ ok: true, data })
    }

    if (body.action === 'changeStatus') {
      if (!body.taskId) return json({ error: 'taskId обязателен' }, 400)

      const payload = {
        status: body.status,
        completed_at: body.status === 'done' ? new Date().toISOString() : null,
      }

      const { data, error } = await supabase.from('tasks').update(payload).eq('id', body.taskId).select('*').single()
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'task',
        entityId: String(body.taskId),
        action: 'change-status',
        payload,
      })

      return json({ ok: true, data })
    }

    if (body.action === 'addComment') {
      if (!body.taskId || !body.content?.trim()) return json({ error: 'taskId и content обязательны' }, 400)

      const payload = {
        task_id: body.taskId,
        staff_id: staffMember?.id || null,
        content: body.content.trim(),
      }

      const { data, error } = await supabase.from('task_comments').insert([payload]).select('*').single()
      if (error) throw error

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'task-comment',
        entityId: String(data.id),
        action: 'create',
        payload: { task_id: body.taskId },
      })

      return json({ ok: true, data })
    }

    if (!body.taskId || !body.message?.trim()) return json({ error: 'taskId и message обязательны' }, 400)

    const { data: task, error: taskError } = await supabase
      .from('tasks')
      .select('id, task_number, title, operator_id')
      .eq('id', body.taskId)
      .single()

    if (taskError) throw taskError

    const { data: operator, error: operatorError } = await supabase
      .from('operators')
      .select('id, telegram_chat_id, name, short_name, operator_profiles(*)')
      .eq('id', task.operator_id)
      .single()

    if (operatorError) throw operatorError
    if (!operator?.telegram_chat_id) return json({ error: 'У оператора нет telegram_chat_id' }, 400)

    await sendTelegramMessage(String(operator.telegram_chat_id), body.message.trim())
    await writeNotificationLog(supabase, {
      channel: 'telegram',
      recipient: String(operator.telegram_chat_id),
      status: 'sent',
      payload: {
        kind: 'task-notify',
        task_id: task.id,
        task_number: task.task_number,
        operator_id: operator.id,
        operator_name: getOperatorDisplayName(operator, 'Оператор'),
      },
    })

    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'task',
      entityId: String(body.taskId),
      action: 'notify',
      payload: { operator_id: operator.id, operator_name: getOperatorDisplayName(operator, 'Оператор') },
    })

    return json({ ok: true })
  } catch (error: any) {
    console.error('Admin tasks route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/tasks',
      message: error?.message || 'Admin tasks route error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
