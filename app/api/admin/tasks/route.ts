import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { resolveStaffByUser } from '@/lib/server/admin'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'
type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
type TaskResponse = 'accept' | 'need_info' | 'blocked' | 'already_done' | 'complete'

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
      message?: string
    }
  | {
      action: 'respondTask'
      taskId: string
      response: TaskResponse
      note?: string | null
    }

type ClientLike = ReturnType<typeof createAdminSupabaseClient> | ReturnType<typeof createRequestSupabaseClient>
type LoadedTask = {
  id: string
  task_number: number
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  operator_id: string | null
  company_id: string | null
  created_by: string | null
}
type LoadedOperator = {
  id: string
  telegram_chat_id: string | null
  name: string
  short_name: string | null
  operator_profiles?: { full_name?: string | null }[] | null
}
type LoadedCompany = {
  id: string
  name: string
  code: string | null
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Бэклог',
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Готово',
  archived: 'Архив',
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  critical: 'Критический',
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
}

const RESPONSE_CONFIG: Record<
  TaskResponse,
  { label: string; status: TaskStatus; emoji: string; comment: string }
> = {
  accept: {
    label: 'Принял в работу',
    status: 'in_progress',
    emoji: '✅',
    comment: 'Сотрудник принял задачу в работу.',
  },
  need_info: {
    label: 'Нужны уточнения',
    status: 'backlog',
    emoji: '❓',
    comment: 'Сотрудник запросил уточнения по задаче.',
  },
  blocked: {
    label: 'Не могу выполнить',
    status: 'backlog',
    emoji: '⛔',
    comment: 'Сотрудник сообщил, что не может выполнить задачу.',
  },
  already_done: {
    label: 'Уже сделано',
    status: 'review',
    emoji: '📨',
    comment: 'Сотрудник сообщил, что задача уже выполнена и передана на проверку.',
  },
  complete: {
    label: 'Готово',
    status: 'done',
    emoji: '🏁',
    comment: 'Сотрудник завершил задачу.',
  },
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function escapeHtml(value: string | null | undefined) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatTaskDate(date: string | null) {
  if (!date) return 'не указан'
  return new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

async function sendTelegramMessage(chatId: string, text: string) {
  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: undefined,
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

function buildTaskResponseKeyboard(taskId: string) {
  return {
    inline_keyboard: [
      [
        { text: 'Принял', callback_data: `task:${taskId}:accept` },
        { text: 'Нужны уточнения', callback_data: `task:${taskId}:need_info` },
      ],
      [
        { text: 'Не могу', callback_data: `task:${taskId}:blocked` },
        { text: 'Уже сделано', callback_data: `task:${taskId}:already_done` },
      ],
      [{ text: 'Завершил', callback_data: `task:${taskId}:complete` }],
    ],
  }
}

async function loadTaskContext(supabase: ClientLike, taskId: string) {
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('id, task_number, title, description, status, priority, due_date, operator_id, company_id, created_by')
    .eq('id', taskId)
    .single()

  if (taskError) throw taskError

  const { data: operator, error: operatorError } = task.operator_id
    ? await supabase
        .from('operators')
        .select('id, telegram_chat_id, name, short_name, operator_profiles(*)')
        .eq('id', task.operator_id)
        .maybeSingle()
    : { data: null, error: null }

  if (operatorError) throw operatorError

  const { data: company, error: companyError } = task.company_id
    ? await supabase
        .from('companies')
        .select('id, name, code')
        .eq('id', task.company_id)
        .maybeSingle()
    : { data: null, error: null }

  if (companyError) throw companyError

  return {
    task: task as LoadedTask,
    operator: (operator || null) as LoadedOperator | null,
    company: (company || null) as LoadedCompany | null,
  }
}

function buildTaskTelegramMessage(params: {
  type: 'assigned' | 'status'
  task: LoadedTask
  operator: LoadedOperator | null
  company: LoadedCompany | null
  statusLabel?: string
  note?: string | null
}) {
  const { type, task, company } = params
  const header =
    type === 'assigned'
      ? 'Новая задача в F16 Finance'
      : 'Обновление по задаче в F16 Finance'

  const lines = [
    `<b>${escapeHtml(header)}</b>`,
    '',
    `<b>Задача #${task.task_number}</b>`,
    `<blockquote>${escapeHtml(task.title)}</blockquote>`,
    `<b>Компания:</b> ${escapeHtml(company?.name || 'не указана')}`,
    `<b>Приоритет:</b> ${escapeHtml(PRIORITY_LABELS[task.priority])}`,
    `<b>Дедлайн:</b> ${escapeHtml(formatTaskDate(task.due_date))}`,
    `<b>Статус:</b> ${escapeHtml(params.statusLabel || STATUS_LABELS[task.status])}`,
  ]

  if (task.description?.trim()) {
    lines.push('', `<b>Что нужно сделать:</b>`, escapeHtml(task.description.trim()))
  }

  if (params.note?.trim()) {
    lines.push('', `<b>Комментарий:</b>`, escapeHtml(params.note.trim()))
  }

  if (type === 'assigned') {
    lines.push(
      '',
      '<b>Можно ответить прямо в Telegram:</b>',
      '• Нажмите кнопку под сообщением',
      '• Или напишите, например: <code>#123 принял</code>',
      '',
      '<b>Также можно ответить в кабинете:</b>',
      '• Принял в работу',
      '• Нужны уточнения',
      '• Уже выполнено',
    )
  }

  lines.push('', 'Откройте раздел задач в кабинете, чтобы продолжить работу.')

  return lines.join('\n')
}

async function addTaskComment(
  supabase: ClientLike,
  payload: { taskId: string; content: string; staffId?: string | null; operatorId?: string | null },
) {
  const { data, error } = await supabase
    .from('task_comments')
    .insert([
      {
        task_id: payload.taskId,
        staff_id: payload.staffId || null,
        operator_id: payload.operatorId || null,
        content: payload.content,
      },
    ])
    .select('*')
    .single()

  if (error) throw error
  return data
}

async function notifyTaskAssignee(
  supabase: ClientLike,
  params: {
    task: LoadedTask
    operator: LoadedOperator | null
    company: LoadedCompany | null
    type: 'assigned' | 'status'
    statusLabel?: string
    note?: string | null
  },
) {
  if (!params.operator?.telegram_chat_id) {
    return { sent: false as const, reason: 'telegram-missing' }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { sent: false as const, reason: 'token-missing' }
  }

  const text = buildTaskTelegramMessage({
    type: params.type,
    task: params.task,
    operator: params.operator,
    company: params.company,
    statusLabel: params.statusLabel,
    note: params.note,
  })

  const token = requiredEnv('TELEGRAM_BOT_TOKEN')
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: String(params.operator.telegram_chat_id),
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup:
        params.type === 'assigned' && params.task.status !== 'done' && params.task.status !== 'archived'
          ? buildTaskResponseKeyboard(params.task.id)
          : undefined,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok || !payload?.ok) {
    throw new Error(payload?.description || 'Telegram не принял сообщение')
  }

  await writeNotificationLog(supabase, {
    channel: 'telegram',
    recipient: String(params.operator.telegram_chat_id),
    status: 'sent',
    payload: {
      kind: params.type === 'assigned' ? 'task-assigned' : 'task-status-update',
      task_id: params.task.id,
      task_number: params.task.task_number,
      operator_id: params.operator.id,
      operator_name: getOperatorDisplayName(params.operator, 'Оператор'),
      status: params.task.status,
    },
  })

  return { sent: true as const }
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

      const context = await loadTaskContext(supabase, String(createdTask.id))
      let notification: { sent: boolean; reason?: string } | undefined

      try {
        notification = await notifyTaskAssignee(supabase, {
          task: context.task,
          operator: context.operator,
          company: context.company,
          type: 'assigned',
        })
      } catch (notifyError) {
        notification = { sent: false, reason: 'send-failed' }
        await writeNotificationLog(supabase, {
          channel: 'telegram',
          recipient: context.operator?.telegram_chat_id || context.operator?.id || 'unknown-operator',
          status: 'failed',
          payload: {
            kind: 'task-assigned',
            task_id: context.task.id,
            task_number: context.task.task_number,
            error: notifyError instanceof Error ? notifyError.message : 'send-failed',
          },
        })
      }

      return json({ ok: true, data: createdTask, notification })
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

      try {
        const context = await loadTaskContext(supabase, body.taskId)
        await addTaskComment(supabase, {
          taskId: body.taskId,
          staffId: staffMember?.id || null,
          content: `Статус обновлен: ${STATUS_LABELS[body.status]}.`,
        })

        await notifyTaskAssignee(supabase, {
          task: context.task,
          operator: context.operator,
          company: context.company,
          type: 'status',
          statusLabel: STATUS_LABELS[body.status],
        })
      } catch (notifyError) {
        console.error('Task status notify error', notifyError)
      }

      return json({ ok: true, data })
    }

    if (body.action === 'respondTask') {
      if (!body.taskId || !RESPONSE_CONFIG[body.response]) {
        return json({ error: 'taskId и response обязательны' }, 400)
      }

      const config = RESPONSE_CONFIG[body.response]
      const payload = {
        status: config.status,
        completed_at: config.status === 'done' ? new Date().toISOString() : null,
      }

      const { data, error } = await supabase.from('tasks').update(payload).eq('id', body.taskId).select('*').single()
      if (error) throw error

      const commentText = [config.emoji, config.comment, body.note?.trim() ? `Комментарий: ${body.note.trim()}` : '']
        .filter(Boolean)
        .join(' ')

      const createdComment = await addTaskComment(supabase, {
        taskId: body.taskId,
        staffId: staffMember?.id || null,
        content: commentText,
      })

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'task',
        entityId: String(body.taskId),
        action: `response-${body.response}`,
        payload: {
          response: body.response,
          status: config.status,
          note: body.note?.trim() || null,
          comment_id: createdComment.id,
        },
      })

      try {
        const context = await loadTaskContext(supabase, body.taskId)
        await notifyTaskAssignee(supabase, {
          task: context.task,
          operator: context.operator,
          company: context.company,
          type: 'status',
          statusLabel: STATUS_LABELS[config.status],
          note: body.note?.trim() || config.label,
        })
      } catch (notifyError) {
        console.error('Task response notify error', notifyError)
      }

      return json({
        ok: true,
        data,
        responseMeta: {
          label: config.label,
          status: config.status,
        },
      })
    }

    if (body.action === 'addComment') {
      if (!body.taskId || !body.content?.trim()) return json({ error: 'taskId и content обязательны' }, 400)

      const data = await addTaskComment(supabase, {
        taskId: body.taskId,
        staffId: staffMember?.id || null,
        content: body.content.trim(),
      })

      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'task-comment',
        entityId: String(data.id),
        action: 'create',
        payload: { task_id: body.taskId },
      })

      return json({ ok: true, data })
    }

    if (!body.taskId) return json({ error: 'taskId обязателен' }, 400)

    const context = await loadTaskContext(supabase, body.taskId)
    if (!context.operator?.telegram_chat_id) return json({ error: 'У оператора нет telegram_chat_id' }, 400)

    try {
      if (body.message?.trim()) {
        await sendTelegramMessage(String(context.operator.telegram_chat_id), body.message.trim())
        await writeNotificationLog(supabase, {
          channel: 'telegram',
          recipient: String(context.operator.telegram_chat_id),
          status: 'sent',
          payload: {
            kind: 'task-notify-custom',
            task_id: context.task.id,
            task_number: context.task.task_number,
            operator_id: context.operator.id,
            operator_name: getOperatorDisplayName(context.operator, 'Оператор'),
          },
        })
      } else {
        await notifyTaskAssignee(supabase, {
          task: context.task,
          operator: context.operator,
          company: context.company,
          type: 'assigned',
        })
      }
    } catch (notifyError) {
      await writeNotificationLog(supabase, {
        channel: 'telegram',
        recipient: String(context.operator.telegram_chat_id),
        status: 'failed',
        payload: {
          kind: 'task-notify',
          task_id: context.task.id,
          task_number: context.task.task_number,
          operator_id: context.operator.id,
          error: notifyError instanceof Error ? notifyError.message : 'send-failed',
        },
      })
      throw notifyError
    }

    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'task',
      entityId: String(body.taskId),
      action: 'notify',
      payload: { operator_id: context.operator.id, operator_name: getOperatorDisplayName(context.operator, 'Оператор') },
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
