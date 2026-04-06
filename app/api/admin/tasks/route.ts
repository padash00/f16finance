import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { resolveStaffByUser } from '@/lib/server/admin'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'
import { sendTelegramMessage as sendOrdaTelegram } from '@/lib/telegram/send'

import type { TaskStatus, TaskPriority, TaskResponse } from '@/lib/core/types'

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

async function ensureTaskCompanyAccess(
  params: {
    activeOrganizationId?: string | null
    isSuperAdmin: boolean
  },
  companyId: string | null | undefined,
) {
  if (!companyId) {
    if (params.isSuperAdmin) {
      return
    }

    throw new Error('task-company-required')
  }

  await resolveCompanyScope({
    activeOrganizationId: params.activeOrganizationId || null,
    requestedCompanyId: companyId,
    isSuperAdmin: params.isSuperAdmin,
  })
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
      ? '📋 Новая задача'
      : '📝 Обновление по задаче'

  const lines = [
    `<b>${header}</b>`,
    '',
    `<b>#${task.task_number}</b> · ${escapeHtml(task.title)}`,
    '',
    `<b>Точка</b> · ${escapeHtml(company?.name || 'не указана')}`,
    `<b>Приоритет</b> · ${escapeHtml(PRIORITY_LABELS[task.priority])}`,
    `<b>Дедлайн</b> · ${escapeHtml(formatTaskDate(task.due_date))}`,
    `<b>Статус</b> · ${escapeHtml(params.statusLabel || STATUS_LABELS[task.status])}`,
  ]

  if (task.description?.trim()) {
    lines.push('', `<b>Описание</b>`, escapeHtml(task.description.trim()))
  }

  if (params.note?.trim()) {
    lines.push('', `<b>Комментарий</b>`, escapeHtml(params.note.trim()))
  }

  if (type === 'assigned') {
    lines.push(
      '',
      `<b>Ответ в Telegram</b>`,
      '▸ Кнопки под сообщением',
      `▸ Или текстом: <code>#${task.task_number} принял</code>`,
      '',
      `<i>Или откройте задачи в кабинете.</i>`,
    )
  }

  lines.push('', `<i>Раздел «Задачи» в Orda Control</i>`)

  return lines.join('\n')
}

async function addTaskComment(
  supabase: ClientLike,
  payload: { taskId: string; content: string; staffId?: string | null; operatorId?: string | null },
) {
  const primaryInsert = await supabase
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

  if (!primaryInsert.error) return primaryInsert.data

  const errorMessage = String(primaryInsert.error?.message || '')
  const canRetryWithoutOperatorId =
    payload.operatorId &&
    (errorMessage.includes("Could not find the 'operator_id' column") || errorMessage.includes('schema cache'))

  if (!canRetryWithoutOperatorId) {
    throw primaryInsert.error
  }

  const fallbackInsert = await supabase
    .from('task_comments')
    .insert([
      {
        task_id: payload.taskId,
        staff_id: payload.staffId || null,
        content: payload.content,
      },
    ])
    .select('*')
    .single()

  if (fallbackInsert.error) throw fallbackInsert.error
  return fallbackInsert.data
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

  const replyMarkup =
    params.type === 'assigned' && params.task.status !== 'done' && params.task.status !== 'archived'
      ? buildTaskResponseKeyboard(params.task.id)
      : undefined

  const result = await sendOrdaTelegram(String(params.operator.telegram_chat_id), text, {
    replyMarkup,
  })
  if (!result.ok) {
    throw new Error(result.error || 'Telegram не принял сообщение')
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

async function logTaskNotificationFailure(
  supabase: ClientLike,
  params: {
    context: { task: LoadedTask; operator: LoadedOperator | null }
    kind: string
    error: unknown
  },
) {
  await writeNotificationLog(supabase, {
    channel: 'telegram',
    recipient:
      params.context.operator?.telegram_chat_id ||
      params.context.operator?.id ||
      'unknown-operator',
    status: 'failed',
    payload: {
      kind: params.kind,
      task_id: params.context.task.id,
      task_number: params.context.task.task_number,
      operator_id: params.context.operator?.id || null,
      error: params.error instanceof Error ? params.error.message : 'send-failed',
    },
  })
}

export async function GET(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'tasks')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const url = new URL(req.url)
    const includeLookups = url.searchParams.get('includeLookups') === '1'
    const status = url.searchParams.get('status') as TaskStatus | null
    const operatorId = url.searchParams.get('operator_id')
    const companyId = url.searchParams.get('company_id')
    const page = Math.max(0, Number(url.searchParams.get('page') || '0'))
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('page_size') || '100')))

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    let query = supabase
      .from('tasks')
      .select('id, task_number, title, description, status, priority, due_date, operator_id, company_id, created_at')
      .order('created_at', { ascending: false })
      .range(page * pageSize, (page + 1) * pageSize - 1)

    if (status) query = query.eq('status', status)
    if (operatorId) query = query.eq('operator_id', operatorId)
    if (companyScope.allowedCompanyIds !== null) {
      if (companyScope.allowedCompanyIds.length === 0) {
        return json({ data: [], page, pageSize, hasMore: false })
      }
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    if (!includeLookups) {
      return json({ data: data ?? [], page, pageSize, hasMore: (data?.length ?? 0) === pageSize })
    }

    const [operatorsResult, staffResult, companiesResult] = await Promise.all([
      access.isSuperAdmin
        ? supabase
            .from('operators')
            .select('id, name, short_name, telegram_chat_id, role, is_active, operator_profiles(*)')
            .eq('is_active', true)
        : (() => {
            const operatorIds = Array.from(new Set((data || []).map((row: any) => row.operator_id).filter(Boolean)))
            if (!operatorIds.length) return Promise.resolve({ data: [], error: null } as any)

            return supabase
              .from('operators')
              .select('id, name, short_name, telegram_chat_id, role, is_active, operator_profiles(*)')
              .in('id', operatorIds)
          })(),
      access.isSuperAdmin
        ? supabase.from('staff').select('id, full_name, short_name').order('full_name')
        : (() => {
            const staffIds = Array.from(new Set((data || []).map((row: any) => row.created_by).filter(Boolean)))
            if (!staffIds.length) return Promise.resolve({ data: [], error: null } as any)

            return supabase.from('staff').select('id, full_name, short_name').in('id', staffIds)
          })(),
      access.isSuperAdmin || companyScope.allowedCompanyIds === null
        ? supabase.from('companies').select('id, name, code').order('name')
        : companyScope.allowedCompanyIds.length > 0
          ? supabase.from('companies').select('id, name, code').in('id', companyScope.allowedCompanyIds).order('name')
          : Promise.resolve({ data: [], error: null } as any),
    ])

    if (operatorsResult.error) throw operatorsResult.error
    if (staffResult.error) throw staffResult.error
    if (companiesResult.error) throw companiesResult.error

    return json({
      data: data ?? [],
      operators: operatorsResult.data || [],
      staff: staffResult.data || [],
      companies: companiesResult.data || [],
      page,
      pageSize,
      hasMore: (data?.length ?? 0) === pageSize,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/tasks GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'tasks')
    if (guard) return guard
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const requestClient = access.supabase
    const user = access.user
    const staffMember = access.staffMember || (await resolveStaffByUser(requestClient, user))

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : requestClient

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'Неверный формат запроса' }, 400)

    if (body.action === 'createTask') {
      if (!body.payload.title?.trim()) return json({ error: 'Название задачи обязательно' }, 400)
      if (!body.payload.company_id?.trim() && !access.isSuperAdmin) {
        return json({ error: 'Для задачи нужно выбрать точку' }, 400)
      }
      await ensureTaskCompanyAccess(
        {
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        },
        body.payload.company_id,
      )

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
      const existingContext = await loadTaskContext(supabase, body.taskId)
      await ensureTaskCompanyAccess(
        {
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        },
        existingContext.task.company_id,
      )
      if (body.payload.company_id !== undefined) {
        await ensureTaskCompanyAccess(
          {
            activeOrganizationId: access.activeOrganization?.id || null,
            isSuperAdmin: access.isSuperAdmin,
          },
          body.payload.company_id,
        )
      }

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
      const existingContext = await loadTaskContext(supabase, body.taskId)
      await ensureTaskCompanyAccess(
        {
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        },
        existingContext.task.company_id,
      )

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
      const existingContext = await loadTaskContext(supabase, body.taskId)
      await ensureTaskCompanyAccess(
        {
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        },
        existingContext.task.company_id,
      )

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
      const existingContext = await loadTaskContext(supabase, body.taskId)
      await ensureTaskCompanyAccess(
        {
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
        },
        existingContext.task.company_id,
      )

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

      try {
        const context = await loadTaskContext(supabase, body.taskId)
        await notifyTaskAssignee(supabase, {
          task: context.task,
          operator: context.operator,
          company: context.company,
          type: 'status',
          statusLabel: STATUS_LABELS[context.task.status],
          note: body.content.trim(),
        })
      } catch (notifyError) {
        console.error('Task comment notify error', notifyError)
        try {
          const context = await loadTaskContext(supabase, body.taskId)
          await logTaskNotificationFailure(supabase, {
            context,
            kind: 'task-comment-update',
            error: notifyError,
          })
        } catch (logError) {
          console.error('Task comment notify failure log error', logError)
        }
      }

      return json({ ok: true, data })
    }

    if (!body.taskId) return json({ error: 'taskId обязателен' }, 400)

    const context = await loadTaskContext(supabase, body.taskId)
    await ensureTaskCompanyAccess(
      {
        activeOrganizationId: access.activeOrganization?.id || null,
        isSuperAdmin: access.isSuperAdmin,
      },
      context.task.company_id,
    )
    if (!context.operator?.telegram_chat_id) return json({ error: 'У оператора нет telegram_chat_id' }, 400)

    try {
      if (body.message?.trim()) {
        const customCore = `<b>📨 Сообщение по задаче #${context.task.task_number}</b>\n\n${escapeTelegramHtml(body.message.trim())}`
        const tgResult = await sendOrdaTelegram(String(context.operator.telegram_chat_id), customCore)
        if (!tgResult.ok) throw new Error(tgResult.error || 'Telegram не принял сообщение')
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
