import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { resolveStaffByUser } from '@/lib/server/admin'
import { writeAuditLog, writeNotificationLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
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
  staff_id?: string | null
  company_id?: string | null
  due_date?: string | null
  tags?: string[] | null
  checklist?: Array<{ id: string; text: string; done: boolean }> | null
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
  | {
      action: 'deleteTask'
      taskId: string
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
  staff_id?: string | null
  company_id: string | null
  created_by: string | null
  checklist?: Array<{ done?: boolean }> | null
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
// Единый исполнитель задачи: оператор или админ-сотрудник.
type TaskAssignee = {
  kind: 'operator' | 'staff'
  id: string
  name: string
  telegram_chat_id: string | null
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
  // select('*') — чтобы не падать на базах, где миграция staff_id ещё не применена.
  const { data: task, error: taskError } = await supabase
    .from('tasks')
    .select('*')
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

  const { data: assigneeStaff, error: staffError } = !task.operator_id && task.staff_id
    ? await supabase
        .from('staff')
        .select('id, full_name, short_name, telegram_chat_id')
        .eq('id', task.staff_id)
        .maybeSingle()
    : { data: null, error: null }

  if (staffError) throw staffError

  const { data: company, error: companyError } = task.company_id
    ? await supabase
        .from('companies')
        .select('id, name, code')
        .eq('id', task.company_id)
        .maybeSingle()
    : { data: null, error: null }

  if (companyError) throw companyError

  const assignee: TaskAssignee | null = operator
    ? {
        kind: 'operator',
        id: String(operator.id),
        name: getOperatorDisplayName(operator as LoadedOperator, 'Оператор'),
        telegram_chat_id: operator.telegram_chat_id ? String(operator.telegram_chat_id) : null,
      }
    : assigneeStaff
      ? {
          kind: 'staff',
          id: String(assigneeStaff.id),
          name: String(assigneeStaff.full_name || assigneeStaff.short_name || 'Сотрудник'),
          telegram_chat_id: assigneeStaff.telegram_chat_id ? String(assigneeStaff.telegram_chat_id) : null,
        }
      : null

  return {
    task: task as LoadedTask,
    operator: (operator || null) as LoadedOperator | null,
    company: (company || null) as LoadedCompany | null,
    assignee,
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

const PRIORITY_EMOJI: Record<TaskPriority, string> = {
  critical: '🔥',
  high: '⚡',
  medium: '📌',
  low: '💧',
}

// Компактное сообщение без общего «системного» шаблона (skipFrame):
// заголовок с номером, название, описание, одна строка меты, подсказка про ответ.
function buildTaskTelegramMessage(params: {
  type: 'assigned' | 'status'
  task: LoadedTask
  company: LoadedCompany | null
  statusLabel?: string
  note?: string | null
}) {
  const { type, task, company } = params

  const lines: string[] = []

  if (type === 'assigned') {
    lines.push(`📋 <b>Новая задача #${task.task_number}</b>`)
  } else {
    lines.push(`🔄 <b>Задача #${task.task_number} → ${escapeHtml(params.statusLabel || STATUS_LABELS[task.status])}</b>`)
  }
  lines.push(`<b>${escapeHtml(task.title)}</b>`)

  if (type === 'assigned' && task.description?.trim()) {
    const description = task.description.trim()
    lines.push('', escapeHtml(description.length > 500 ? `${description.slice(0, 500)}…` : description))
  }

  if (params.note?.trim()) {
    lines.push('', `💬 ${escapeHtml(params.note.trim())}`)
  }

  const meta: string[] = []
  if (company?.name) meta.push(`🏢 ${escapeHtml(company.name)}`)
  meta.push(`${PRIORITY_EMOJI[task.priority]} ${escapeHtml(PRIORITY_LABELS[task.priority])}`)
  lines.push('', meta.join(' · '))

  if (task.due_date) {
    lines.push(`⏰ Срок: ${escapeHtml(formatTaskDate(task.due_date))}`)
  }

  const checklistTotal = Array.isArray(task.checklist) ? task.checklist.length : 0
  if (type === 'assigned' && checklistTotal > 0) {
    lines.push(`☑️ Чек-лист: ${checklistTotal} пункт${checklistTotal === 1 ? '' : checklistTotal < 5 ? 'а' : 'ов'}`)
  }

  if (type === 'assigned') {
    lines.push('', `<i>Ответьте кнопками ниже или текстом:</i> <code>#${task.task_number} принял</code>`)
  }

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

  // Колонки operator_id может не быть (старые базы) — ретраим без неё независимо
  // от того, передан operatorId или null: insert включает поле всегда.
  const errorMessage = String(primaryInsert.error?.message || '')
  const canRetryWithoutOperatorId =
    errorMessage.includes("Could not find the 'operator_id' column") || errorMessage.includes('schema cache')

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
    assignee: TaskAssignee | null
    company: LoadedCompany | null
    type: 'assigned' | 'status'
    statusLabel?: string
    note?: string | null
  },
) {
  if (!params.assignee?.telegram_chat_id) {
    return { sent: false as const, reason: 'telegram-missing' }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return { sent: false as const, reason: 'token-missing' }
  }

  const text = buildTaskTelegramMessage({
    type: params.type,
    task: params.task,
    company: params.company,
    statusLabel: params.statusLabel,
    note: params.note,
  })

  const replyMarkup =
    params.type === 'assigned' && params.task.status !== 'done' && params.task.status !== 'archived'
      ? buildTaskResponseKeyboard(params.task.id)
      : undefined

  const result = await sendOrdaTelegram(params.assignee.telegram_chat_id, text, {
    replyMarkup,
    skipFrame: true,
  })
  if (!result.ok) {
    throw new Error(result.error || 'Telegram не принял сообщение')
  }

  await writeNotificationLog(supabase, {
    channel: 'telegram',
    recipient: params.assignee.telegram_chat_id,
    status: 'sent',
    payload: {
      kind: params.type === 'assigned' ? 'task-assigned' : 'task-status-update',
      task_id: params.task.id,
      task_number: params.task.task_number,
      operator_id: params.assignee.kind === 'operator' ? params.assignee.id : null,
      staff_id: params.assignee.kind === 'staff' ? params.assignee.id : null,
      assignee_name: params.assignee.name,
      status: params.task.status,
    },
  })

  return { sent: true as const }
}

async function logTaskNotificationFailure(
  supabase: ClientLike,
  params: {
    context: { task: LoadedTask; assignee: TaskAssignee | null }
    kind: string
    error: unknown
  },
) {
  await writeNotificationLog(supabase, {
    channel: 'telegram',
    recipient:
      params.context.assignee?.telegram_chat_id ||
      params.context.assignee?.id ||
      'unknown-assignee',
    status: 'failed',
    payload: {
      kind: params.kind,
      task_id: params.context.task.id,
      task_number: params.context.task.task_number,
      operator_id: params.context.assignee?.kind === 'operator' ? params.context.assignee.id : null,
      staff_id: params.context.assignee?.kind === 'staff' ? params.context.assignee.id : null,
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
    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    // Comments sub-route: ?comments=1&taskId=<uuid>
    if (url.searchParams.get('comments') === '1') {
      const taskId = url.searchParams.get('taskId')
      if (!taskId) return json({ error: 'taskId обязателен' }, 400)
      const { data: comments, error } = await supabase
        .from('task_comments')
        .select('id, task_id, operator_id, staff_id, content, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return json({ comments: comments ?? [] })
    }

    const includeLookups = url.searchParams.get('includeLookups') === '1'
    const status = url.searchParams.get('status') as TaskStatus | null
    const operatorId = url.searchParams.get('operator_id')
    const companyId = url.searchParams.get('company_id')
    const page = Math.max(0, Number(url.searchParams.get('page') || '0'))
    const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('page_size') || '100')))

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: companyId,
      isSuperAdmin: access.isSuperAdmin,
    })

    const buildListQuery = (withStaffId: boolean) => {
      let query = supabase
        .from('tasks')
        .select(
          `id, task_number, title, description, status, priority, due_date, tags, checklist, operator_id, ${withStaffId ? 'staff_id, ' : ''}company_id, created_by, created_at, updated_at, completed_at, task_comments(count)`,
        )
        .order('created_at', { ascending: false })
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (status) query = query.eq('status', status)
      if (operatorId) query = query.eq('operator_id', operatorId)
      if (companyScope.allowedCompanyIds !== null) {
        query = query.in('company_id', companyScope.allowedCompanyIds)
      }
      return query
    }

    if (companyScope.allowedCompanyIds !== null && companyScope.allowedCompanyIds.length === 0) {
      return json({ data: [], page, pageSize, hasMore: false })
    }

    let { data, error } = await buildListQuery(true)
    if (error && String(error.message || '').includes('staff_id')) {
      // Миграция tasks.staff_id ещё не применена — страница должна жить и без неё.
      ;({ data, error } = await buildListQuery(false))
    }
    if (error) throw error

    const taskRows = (data ?? []).map((row: any) => {
      const countArr = Array.isArray(row.task_comments) ? row.task_comments : []
      const commentsCount = countArr.length > 0 ? Number(countArr[0]?.count ?? 0) : 0
      const { task_comments, ...rest } = row
      return { ...rest, comments_count: isNaN(commentsCount) ? 0 : commentsCount }
    })

    if (!includeLookups) {
      return json({ data: taskRows, page, pageSize, hasMore: taskRows.length === pageSize })
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
        ? supabase.from('staff').select('id, full_name, short_name, telegram_chat_id').order('full_name')
        : access.activeOrganization?.id
          ? supabase
              .from('staff')
              .select('id, full_name, short_name, telegram_chat_id')
              .eq('organization_id', access.activeOrganization.id)
              .order('full_name')
          : (() => {
              const staffIds = Array.from(
                new Set(
                  (data || [])
                    .flatMap((row: any) => [row.created_by, row.staff_id])
                    .filter(Boolean),
                ),
              )
              if (!staffIds.length) return Promise.resolve({ data: [], error: null } as any)

              return supabase.from('staff').select('id, full_name, short_name, telegram_chat_id').in('id', staffIds)
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
      data: taskRows,
      operators: operatorsResult.data || [],
      staff: staffResult.data || [],
      companies: companiesResult.data || [],
      page,
      pageSize,
      hasMore: taskRows.length === pageSize,
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
      const denied = await requireCapability(access, 'tasks.create')
      if (denied) return denied as any
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
      // Исполнитель — либо оператор, либо сотрудник: одно из полей всегда null.
      const assigneeOperatorId = body.payload.operator_id || null
      const assigneeStaffId = assigneeOperatorId ? null : body.payload.staff_id || null

      const payloadBase = {
        title: body.payload.title.trim(),
        description: body.payload.description?.trim() || null,
        priority: body.payload.priority,
        status: body.payload.status,
        operator_id: assigneeOperatorId,
        staff_id: assigneeStaffId,
        company_id: body.payload.company_id || null,
        due_date: body.payload.due_date || null,
        tags: body.payload.tags || [],
        checklist: Array.isArray(body.payload.checklist) ? body.payload.checklist : [],
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
        if (String(error?.message || '').includes("'staff_id' column")) {
          if (assigneeStaffId) {
            return json({ error: 'Назначение на сотрудника недоступно: примените миграцию 20260715_tasks_staff_assignee.sql' }, 400)
          }
          const { staff_id, ...withoutStaff } = insertPayload
          const retry = await supabase
            .from('tasks')
            .insert([withoutStaff])
            .select('*')
            .single()

          insertError = retry.error
          createdTask = retry.data
          break
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
          assignee: context.assignee,
          company: context.company,
          type: 'assigned',
        })
      } catch (notifyError) {
        notification = { sent: false, reason: 'send-failed' }
        await logTaskNotificationFailure(supabase, {
          context,
          kind: 'task-assigned',
          error: notifyError,
        })
      }

      return json({ ok: true, data: createdTask, notification })
    }

    if (body.action === 'updateTask') {
      const denied = await requireCapability(access, 'tasks.edit')
      if (denied) return denied as any
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

      // Частичный апдейт: непереданные поля (undefined) не трогаем — иначе
      // обновление одного чек-листа стирало бы дедлайн/оператора/точку.
      const updatePayload = {
        title: body.payload.title?.trim(),
        description: body.payload.description !== undefined ? (body.payload.description?.trim() || null) : undefined,
        priority: body.payload.priority,
        status: body.payload.status,
        operator_id: body.payload.operator_id !== undefined ? (body.payload.operator_id || null) : undefined,
        staff_id: body.payload.staff_id !== undefined ? (body.payload.staff_id || null) : undefined,
        company_id: body.payload.company_id !== undefined ? (body.payload.company_id || null) : undefined,
        due_date: body.payload.due_date !== undefined ? (body.payload.due_date || null) : undefined,
        tags: body.payload.tags,
        checklist: Array.isArray(body.payload.checklist) ? body.payload.checklist : undefined,
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
      // Исполнитель один: назначение оператора снимает сотрудника и наоборот.
      if (sanitized.operator_id) sanitized.staff_id = null
      else if (sanitized.staff_id) sanitized.operator_id = null

      let { data, error } = await supabase.from('tasks').update(sanitized).eq('id', body.taskId).select('*').single()
      if (error && String(error.message || '').includes("'staff_id' column")) {
        if (sanitized.staff_id) {
          return json({ error: 'Назначение на сотрудника недоступно: примените миграцию 20260715_tasks_staff_assignee.sql' }, 400)
        }
        const { staff_id, ...withoutStaff } = sanitized
        ;({ data, error } = await supabase.from('tasks').update(withoutStaff).eq('id', body.taskId).select('*').single())
      }
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
          assignee: context.assignee,
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
          assignee: context.assignee,
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
      const denied = await requireCapability(access, 'tasks.add_comment')
      if (denied) return denied as any
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
          assignee: context.assignee,
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

    if (body.action === 'deleteTask') {
      const denied = await requireCapability(access, 'tasks.delete')
      if (denied) return denied as any
      if (!body.taskId) return json({ error: 'taskId обязателен' }, 400)
      const existingContext = await loadTaskContext(supabase, body.taskId)
      await ensureTaskCompanyAccess(
        { activeOrganizationId: access.activeOrganization?.id || null, isSuperAdmin: access.isSuperAdmin },
        existingContext.task.company_id,
      )
      const { error } = await supabase.from('tasks').delete().eq('id', body.taskId)
      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'task',
        entityId: body.taskId,
        action: 'delete',
        payload: { task_number: existingContext.task.task_number, title: existingContext.task.title },
      })
      return json({ ok: true })
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
    if (!context.assignee?.telegram_chat_id) return json({ error: 'У исполнителя нет Telegram' }, 400)

    try {
      if (body.message?.trim()) {
        const customCore = [
          `💬 <b>Сообщение по задаче #${context.task.task_number}</b>`,
          `<b>${escapeTelegramHtml(context.task.title)}</b>`,
          '',
          escapeTelegramHtml(body.message.trim()),
        ].join('\n')
        const tgResult = await sendOrdaTelegram(context.assignee.telegram_chat_id, customCore, { skipFrame: true })
        if (!tgResult.ok) throw new Error(tgResult.error || 'Telegram не принял сообщение')
        await writeNotificationLog(supabase, {
          channel: 'telegram',
          recipient: context.assignee.telegram_chat_id,
          status: 'sent',
          payload: {
            kind: 'task-notify-custom',
            task_id: context.task.id,
            task_number: context.task.task_number,
            operator_id: context.assignee.kind === 'operator' ? context.assignee.id : null,
            staff_id: context.assignee.kind === 'staff' ? context.assignee.id : null,
            assignee_name: context.assignee.name,
          },
        })
      } else {
        await notifyTaskAssignee(supabase, {
          task: context.task,
          assignee: context.assignee,
          company: context.company,
          type: 'assigned',
        })
      }
    } catch (notifyError) {
      await logTaskNotificationFailure(supabase, {
        context,
        kind: 'task-notify',
        error: notifyError,
      })
      throw notifyError
    }

    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'task',
      entityId: String(body.taskId),
      action: 'notify',
      payload: {
        operator_id: context.assignee.kind === 'operator' ? context.assignee.id : null,
        staff_id: context.assignee.kind === 'staff' ? context.assignee.id : null,
        assignee_name: context.assignee.name,
      },
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
