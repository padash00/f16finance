import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { requirePointDevice } from '@/lib/server/point-devices'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function requirePointOperator(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point

  const operatorId = String(request.headers.get('x-point-operator-id') || '').trim()
  const operatorAuthId = String(request.headers.get('x-point-operator-auth-id') || '').trim()

  if (!operatorId || !operatorAuthId) {
    return { response: NextResponse.json({ error: 'missing-point-operator-auth' }, { status: 401 }) }
  }

  const { supabase } = point

  const { data: operatorAuth, error: authError } = await supabase
    .from('operator_auth')
    .select('id, operator_id, is_active')
    .eq('id', operatorAuthId)
    .eq('operator_id', operatorId)
    .eq('is_active', true)
    .maybeSingle()

  if (authError || !operatorAuth) {
    return { response: NextResponse.json({ error: 'invalid-point-operator-auth' }, { status: 403 }) }
  }

  const { data: operator, error: operatorError } = await supabase
    .from('operators')
    .select('id, name, short_name, telegram_chat_id, is_active, operator_profiles(*)')
    .eq('id', operatorId)
    .maybeSingle()

  if (operatorError || !operator) {
    return { response: NextResponse.json({ error: 'operator-not-found' }, { status: 404 }) }
  }

  if ((operator as { is_active?: boolean }).is_active === false) {
    return { response: NextResponse.json({ error: 'operator-inactive' }, { status: 403 }) }
  }

  return {
    ...point,
    operator,
    operatorAuth,
  }
}

export async function GET(request: Request) {
  try {
    const context = await requirePointOperator(request)
    if ('response' in context) return context.response

    const { supabase, operator } = context
    const operatorId = String(operator.id)

    const { data: tasks, error: tasksError } = await supabase
      .from('tasks')
      .select('*')
      .eq('operator_id', operatorId)
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
    for (const operatorRow of operatorsRes.data || []) {
      operatorMap.set(String((operatorRow as any).id), operatorRow)
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
        const commentOperator = operatorMap.get(String(comment.operator_id))
        return {
          ...comment,
          author_name: commentOperator ? getOperatorDisplayName(commentOperator, 'Оператор') : getOperatorDisplayName(operator, 'Оператор'),
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
      operator_name: getOperatorDisplayName(operator, 'Оператор'),
      operator_short_name: operator.short_name,
      company_name: task.company_id ? companyMap.get(task.company_id)?.name || null : null,
      company_code: task.company_id ? companyMap.get(task.company_id)?.code || null : null,
    }))

    return json({
      ok: true,
      operator: {
        id: operator.id,
        name: getOperatorDisplayName(operator, 'Оператор'),
        short_name: operator.short_name,
      },
      tasks: enrichedTasks,
      comments,
    })
  } catch (error: any) {
    console.error('Point operator tasks GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/point/operator-tasks:get',
      message: error?.message || 'Point operator tasks GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
