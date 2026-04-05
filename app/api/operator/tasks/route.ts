import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'
type TaskPriority = 'critical' | 'high' | 'medium' | 'low'
type TaskResponse = 'accept' | 'need_info' | 'blocked' | 'already_done' | 'complete'

type Body =
  | {
      action: 'respondTask'
      taskId: string
      response: TaskResponse
      note?: string | null
    }
  | {
      action: 'addComment'
      taskId: string
      content: string
    }

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
  created_at: string
  updated_at: string
  completed_at: string | null
}

const RESPONSE_CONFIG: Record<
  TaskResponse,
  { label: string; status: TaskStatus; emoji: string; comment: string }
> = {
  accept: {
    label: 'Принял в работу',
    status: 'in_progress',
    emoji: '✅',
    comment: 'Оператор подтвердил, что взял задачу в работу.',
  },
  need_info: {
    label: 'Нужны уточнения',
    status: 'backlog',
    emoji: '❓',
    comment: 'Оператор запросил уточнения по задаче.',
  },
  blocked: {
    label: 'Не могу выполнить',
    status: 'backlog',
    emoji: '⛔',
    comment: 'Оператор сообщил, что не может выполнить задачу.',
  },
  already_done: {
    label: 'Уже сделано',
    status: 'review',
    emoji: '📨',
    comment: 'Оператор сообщил, что задача уже выполнена и передана на проверку.',
  },
  complete: {
    label: 'Завершил задачу',
    status: 'done',
    emoji: '🏁',
    comment: 'Оператор завершил задачу в личном кабинете.',
  },
}

async function addTaskComment(
  supabase: any,
  payload: { taskId: string; content: string; operatorId: string },
) {
  const primaryInsert = await supabase
    .from('task_comments')
    .insert([
      {
        task_id: payload.taskId,
        operator_id: payload.operatorId,
        content: payload.content,
      },
    ])
    .select('*')
    .single()

  if (!primaryInsert.error) return primaryInsert.data

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
        content: payload.content,
      },
    ])
    .select('*')
    .single()

  if (fallbackInsert.error) throw fallbackInsert.error
  return fallbackInsert.data
}

async function loadOwnedTask(supabase: any, taskId: string, operatorId: string) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('id', taskId)
    .eq('operator_id', operatorId)
    .maybeSingle()

  if (error) throw error
  return (data || null) as LoadedTask | null
}

export async function GET(req: Request) {
  try {
    const context = await getRequestOperatorContext(req)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : context.supabase

    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('operator_id', context.operator.id)
      .order('created_at', { ascending: false })

    if (tasksError) throw tasksError

    const taskIds = (tasks || []).map((task: any) => task.id)
    const companyIds = [...new Set((tasks || []).map((task: any) => task.company_id).filter(Boolean))]

    const [commentsRes, companiesRes] = await Promise.all([
      taskIds.length > 0
        ? supabase
            .from('task_comments')
            .select('*')
            .in('task_id', taskIds)
            .order('created_at', { ascending: true })
        : Promise.resolve({ data: [], error: null }),
      companyIds.length > 0
        ? supabase.from('companies').select('id, name, code').in('id', companyIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (commentsRes.error) throw commentsRes.error
    if (companiesRes.error) throw companiesRes.error

    const commentsRaw = commentsRes.data || []
    const staffIds = [...new Set(commentsRaw.map((comment: any) => comment.staff_id).filter(Boolean))]
    const operatorIds = [...new Set(commentsRaw.map((comment: any) => comment.operator_id).filter(Boolean))]

    const [staffRes, operatorsRes] = await Promise.all([
      staffIds.length > 0
        ? supabase.from('staff').select('id, full_name, short_name').in('id', staffIds)
        : Promise.resolve({ data: [], error: null }),
      operatorIds.length > 0
        ? supabase.from('operators').select('id, name, short_name, operator_profiles(*)').in('id', operatorIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    if (staffRes.error) throw staffRes.error
    if (operatorsRes.error) throw operatorsRes.error

    const companyMap = new Map<string, { name: string; code: string | null }>()
    for (const company of companiesRes.data || []) {
      companyMap.set(String(company.id), {
        name: String(company.name),
        code: (company as any).code || null,
      })
    }

    const staffMap = new Map<string, { full_name: string | null; short_name: string | null }>()
    for (const staffMember of staffRes.data || []) {
      staffMap.set(String(staffMember.id), {
        full_name: (staffMember as any).full_name || null,
        short_name: (staffMember as any).short_name || null,
      })
    }

    const operatorMap = new Map<string, any>()
    for (const operator of operatorsRes.data || []) {
      operatorMap.set(String((operator as any).id), operator)
    }

    const comments = commentsRaw.map((comment: any) => {
      if (comment.staff_id) {
        const staffMember = staffMap.get(String(comment.staff_id))
        return {
          ...comment,
          author_name: staffMember?.full_name || staffMember?.short_name || 'Сотрудник',
          author_type: 'staff' as const,
        }
      }

      if (comment.operator_id) {
        const operator = operatorMap.get(String(comment.operator_id))
        return {
          ...comment,
          author_name: operator ? getOperatorDisplayName(operator, 'Оператор') : getOperatorDisplayName(context.operator, 'Оператор'),
          author_type: 'operator' as const,
        }
      }

      return {
        ...comment,
        author_name: 'Комментарий',
        author_type: 'operator' as const,
      }
    })

    const enrichedTasks = (tasks || []).map((task: any) => ({
      ...task,
      operator_name: getOperatorDisplayName(context.operator, 'Оператор'),
      operator_short_name: context.operator.short_name,
      company_name: task.company_id ? companyMap.get(task.company_id)?.name || null : null,
      company_code: task.company_id ? companyMap.get(task.company_id)?.code || null : null,
    }))

    return NextResponse.json({
      ok: true,
      operator: {
        id: context.operator.id,
        name: getOperatorDisplayName(context.operator, 'Оператор'),
        short_name: context.operator.short_name,
      },
      tasks: enrichedTasks,
      comments,
    })
  } catch (error: any) {
    console.error('Operator tasks GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/tasks:get',
      message: error?.message || 'Operator tasks GET error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const context = await getRequestOperatorContext(req)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : context.supabase
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) {
      return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
    }

    if (body.action === 'addComment') {
      if (!body.taskId || !body.content?.trim()) {
        return NextResponse.json({ error: 'taskId и content обязательны' }, { status: 400 })
      }

      const task = await loadOwnedTask(supabase, body.taskId, context.operator.id)
      if (!task) {
        return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
      }

      const comment = await addTaskComment(supabase, {
        taskId: body.taskId,
        operatorId: context.operator.id,
        content: body.content.trim(),
      })

      await writeAuditLog(supabase, {
        actorUserId: context.user?.id || null,
        entityType: 'task',
        entityId: String(body.taskId),
        action: 'operator-add-comment',
        payload: {
          operator_id: context.operator.id,
          comment_id: comment?.id || null,
        },
      })

      return NextResponse.json({ ok: true, comment })
    }

    if (body.action === 'respondTask') {
      if (!body.taskId || !RESPONSE_CONFIG[body.response]) {
        return NextResponse.json({ error: 'taskId и response обязательны' }, { status: 400 })
      }

      const task = await loadOwnedTask(supabase, body.taskId, context.operator.id)
      if (!task) {
        return NextResponse.json({ error: 'Задача не найдена' }, { status: 404 })
      }

      const config = RESPONSE_CONFIG[body.response]
      const { error: updateError } = await supabase
        .from('tasks')
        .update({
          status: config.status,
          completed_at: config.status === 'done' ? new Date().toISOString() : null,
        })
        .eq('id', body.taskId)

      if (updateError) throw updateError

      const note = body.note?.trim() || null
      const commentText = [config.emoji, config.comment, note ? `Комментарий: ${note}` : '']
        .filter(Boolean)
        .join(' ')

      const comment = await addTaskComment(supabase, {
        taskId: body.taskId,
        operatorId: context.operator.id,
        content: commentText,
      })

      await writeAuditLog(supabase, {
        actorUserId: context.user?.id || null,
        entityType: 'task',
        entityId: String(body.taskId),
        action: `operator-response-${body.response}`,
        payload: {
          operator_id: context.operator.id,
          status: config.status,
          comment_id: comment?.id || null,
          note,
        },
      })

      return NextResponse.json({
        ok: true,
        status: config.status,
        responseLabel: config.label,
      })
    }

    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  } catch (error: any) {
    console.error('Operator tasks POST error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/tasks:post',
      message: error?.message || 'Operator tasks POST error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
