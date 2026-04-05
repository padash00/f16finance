import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestOperatorLeadContext } from '@/lib/server/request-auth'
import { submitShiftLeadReview } from '@/lib/server/shift-workflow'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body =
  | {
      action: 'submitLeadProposal'
      requestId: string
      proposalAction: 'keep' | 'remove' | 'replace'
      proposalNote?: string | null
      replacementOperatorId?: string | null
    }
  | {
      action: 'updatePointTask'
      taskId: string
      status: 'todo' | 'in_progress' | 'review' | 'done'
      note?: string | null
    }

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function addTaskComment(
  supabase: any,
  payload: { taskId: string; operatorId?: string | null; content: string },
) {
  const primaryInsert = await supabase
    .from('task_comments')
    .insert([
      {
        task_id: payload.taskId,
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
        content: payload.content,
      },
    ])
    .select('*')
    .single()

  if (fallbackInsert.error) throw fallbackInsert.error
  return fallbackInsert.data
}

function getWeeklyStatusSummary(params: {
  publicationId: string | null
  teamAssignments: any[]
  requests: any[]
  responses: any[]
}) {
  if (!params.publicationId) {
    return {
      state: 'draft',
      total: params.teamAssignments.length,
      confirmed: 0,
      pending: params.teamAssignments.length,
      issues: 0,
      proposals: 0,
      resolved: 0,
    }
  }

  const responses = params.responses.filter((item) => item.publication_id === params.publicationId)
  const requests = params.requests.filter((item) => item.publication_id === params.publicationId)
  const confirmed = responses.filter((item) => item.status === 'confirmed').length
  const issues = requests.filter((item) => ['open', 'awaiting_reason'].includes(item.status)).length
  const proposals = requests.filter((item) => item.lead_status === 'proposed' && item.status === 'open').length
  const resolved = requests.filter((item) => ['resolved', 'dismissed'].includes(item.status)).length
  const total = responses.length || params.teamAssignments.length
  const pending = Math.max(0, total - confirmed)

  const state =
    issues > 0
      ? 'issues'
      : total > 0 && confirmed === total
        ? 'confirmed'
        : confirmed > 0
          ? 'partial'
          : 'published'

  return { state, total, confirmed, pending, issues, proposals, resolved }
}

export async function GET(req: Request) {
  try {
    const context = await getRequestOperatorLeadContext(req)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : context.supabase
    const companyIds = context.leadAssignments.map((assignment) => assignment.company_id)

    const [assignmentsRes, tasksRes, requestsRes, publicationsRes, companiesRes] = await Promise.all([
      supabase
        .from('operator_company_assignments')
        .select('id, operator_id, company_id, role_in_company, is_primary, is_active, notes')
        .in('company_id', companyIds)
        .eq('is_active', true)
        .order('is_primary', { ascending: false })
        .order('created_at', { ascending: true }),
      supabase
        .from('tasks')
        .select('id, task_number, title, description, status, priority, due_date, operator_id, company_id, created_at, updated_at')
        .in('company_id', companyIds)
        .neq('status', 'archived')
        .order('due_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase
        .from('shift_change_requests')
        .select('id, publication_id, company_id, operator_id, shift_date, shift_type, status, source, reason, lead_status, lead_action, lead_note, lead_operator_id, lead_replacement_operator_id, lead_updated_at, resolution_note, responded_at, resolved_at, created_at')
        .in('company_id', companyIds)
        .order('created_at', { ascending: false })
        .limit(80),
      supabase
        .from('shift_week_publications')
        .select('id, company_id, week_start, week_end, version, status, published_at')
        .in('company_id', companyIds)
        .order('published_at', { ascending: false })
        .limit(40),
      supabase.from('companies').select('id, name, code').in('id', companyIds),
    ])

    if (assignmentsRes.error) throw assignmentsRes.error
    if (tasksRes.error) throw tasksRes.error
    if (requestsRes.error) throw requestsRes.error
    if (publicationsRes.error) throw publicationsRes.error
    if (companiesRes.error) throw companiesRes.error

    const operatorIds = [
      ...new Set(
        [
          ...((assignmentsRes.data || []).map((row: any) => row.operator_id) as string[]),
          ...((tasksRes.data || []).map((row: any) => row.operator_id).filter(Boolean) as string[]),
          ...((requestsRes.data || []).map((row: any) => row.operator_id) as string[]),
          ...((requestsRes.data || []).map((row: any) => row.lead_operator_id).filter(Boolean) as string[]),
          ...((requestsRes.data || []).map((row: any) => row.lead_replacement_operator_id).filter(Boolean) as string[]),
        ].filter(Boolean),
      ),
    ]

    const { data: operators, error: operatorsError } =
      operatorIds.length > 0
        ? await supabase.from('operators').select('id, name, short_name, telegram_chat_id, operator_profiles(*)').in('id', operatorIds)
        : { data: [], error: null }

    if (operatorsError) throw operatorsError

    const operatorMap = new Map<string, any>()
    for (const operator of operators || []) {
      operatorMap.set(String((operator as any).id), operator)
    }

    const companyMap = new Map<string, any>()
    for (const company of companiesRes.data || []) {
      companyMap.set(String(company.id), company)
    }

    const latestPublicationByCompany = new Map<string, any>()
    for (const publication of publicationsRes.data || []) {
      if (!latestPublicationByCompany.has(String((publication as any).company_id))) {
        latestPublicationByCompany.set(String((publication as any).company_id), publication)
      }
    }

    const latestPublicationIds = [...latestPublicationByCompany.values()].map((publication) => String(publication.id))
    const { data: responses, error: responsesError } =
      latestPublicationIds.length > 0
        ? await supabase
            .from('shift_operator_week_responses')
            .select('id, publication_id, company_id, operator_id, status, response_source, responded_at')
            .in('publication_id', latestPublicationIds)
        : { data: [], error: null }

    if (responsesError) throw responsesError

    return json({
      ok: true,
      lead: {
        operator: {
          id: context.operator.id,
          name: getOperatorDisplayName(context.operator, 'Оператор'),
          short_name: context.operator.short_name,
        },
        assignments: context.leadAssignments.map((assignment) => ({
          ...assignment,
          company_name: assignment.company?.name || null,
          company_code: assignment.company?.code || null,
        })),
      },
      companies: (companiesRes.data || []).map((company: any) => ({
        ...company,
        leadRole:
          context.leadAssignments.find((assignment) => assignment.company_id === company.id)?.role_in_company || 'senior_operator',
        publication: latestPublicationByCompany.get(String(company.id)) || null,
        weeklyStatus: getWeeklyStatusSummary({
          publicationId: latestPublicationByCompany.get(String(company.id))?.id || null,
          teamAssignments: (assignmentsRes.data || []).filter((assignment: any) => assignment.company_id === company.id),
          requests: (requestsRes.data || []).filter((request: any) => request.company_id === company.id),
          responses: (responses || []).filter((response: any) => response.company_id === company.id),
        }),
      })),
      teamAssignments: (assignmentsRes.data || []).map((assignment: any) => ({
        ...assignment,
        operator_name: operatorMap.get(String(assignment.operator_id))
          ? getOperatorDisplayName(operatorMap.get(String(assignment.operator_id)), 'Оператор')
          : 'Оператор',
      })),
      tasks: (tasksRes.data || []).map((task: any) => ({
        ...task,
        operator_name: task.operator_id && operatorMap.get(String(task.operator_id))
          ? getOperatorDisplayName(operatorMap.get(String(task.operator_id)), 'Оператор')
          : null,
        company_name: task.company_id ? companyMap.get(String(task.company_id))?.name || null : null,
        company_code: task.company_id ? companyMap.get(String(task.company_id))?.code || null : null,
      })),
      requests: (requestsRes.data || []).map((request: any) => ({
        ...request,
        operator_name: operatorMap.get(String(request.operator_id))
          ? getOperatorDisplayName(operatorMap.get(String(request.operator_id)), 'Оператор')
          : 'Оператор',
        lead_operator_name: request.lead_operator_id && operatorMap.get(String(request.lead_operator_id))
          ? getOperatorDisplayName(operatorMap.get(String(request.lead_operator_id)), 'Старший')
          : null,
        lead_replacement_operator_name:
          request.lead_replacement_operator_id && operatorMap.get(String(request.lead_replacement_operator_id))
            ? getOperatorDisplayName(operatorMap.get(String(request.lead_replacement_operator_id)), 'Оператор')
            : null,
        company_name: request.company_id ? companyMap.get(String(request.company_id))?.name || null : null,
        company_code: request.company_id ? companyMap.get(String(request.company_id))?.code || null : null,
      })),
    })
  } catch (error: any) {
    console.error('Operator lead GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/lead:get',
      message: error?.message || 'Operator lead GET error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const context = await getRequestOperatorLeadContext(req)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : context.supabase
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) {
      return json({ error: 'Неверный формат запроса' }, 400)
    }

    if (body.action === 'submitLeadProposal') {
      if (!body.requestId || !body.proposalAction) {
        return json({ error: 'requestId и proposalAction обязательны' }, 400)
      }

      const { data: requestRow, error: requestError } = await supabase
        .from('shift_change_requests')
        .select('id, company_id, operator_id, status')
        .eq('id', body.requestId)
        .maybeSingle()

      if (requestError) throw requestError
      if (!requestRow) {
        return json({ error: 'Запрос по смене не найден' }, 404)
      }

      const allowedCompanyIds = new Set(context.leadAssignments.map((assignment) => assignment.company_id))
      if (!allowedCompanyIds.has(String(requestRow.company_id))) {
        return json({ error: 'У вас нет доступа к этой точке' }, 403)
      }

      if (!['open', 'awaiting_reason'].includes(String(requestRow.status || ''))) {
        return json({ error: 'Этот запрос уже обработан и больше не ждёт предложения' }, 400)
      }

      if (body.proposalAction === 'replace') {
        if (!body.replacementOperatorId) {
          return json({ error: 'Для замены выбери оператора' }, 400)
        }

        if (String(body.replacementOperatorId) === String(requestRow.operator_id)) {
          return json({ error: 'Нельзя предложить того же самого оператора' }, 400)
        }

        const { data: replacementAssignment, error: replacementError } = await supabase
          .from('operator_company_assignments')
          .select('id')
          .eq('company_id', requestRow.company_id)
          .eq('operator_id', body.replacementOperatorId)
          .eq('is_active', true)
          .maybeSingle()

        if (replacementError) throw replacementError
        if (!replacementAssignment) {
          return json({ error: 'Выбранный оператор не привязан к этой точке' }, 400)
        }
      }

      const result = await submitShiftLeadReview({
        supabase,
        requestId: body.requestId,
        leadOperatorId: context.operator.id,
        proposalAction: body.proposalAction,
        proposalNote: body.proposalNote,
        replacementOperatorId: body.replacementOperatorId || null,
      })

      await writeAuditLog(supabase, {
        actorUserId: context.user?.id || null,
        entityType: 'shift-change-request',
        entityId: body.requestId,
        action: 'lead-proposal',
        payload: {
          company_ids: context.leadAssignments.map((assignment) => assignment.company_id),
          lead_operator_id: context.operator.id,
          proposal_action: body.proposalAction,
          proposal_note: body.proposalNote?.trim() || null,
          replacement_operator_id: body.replacementOperatorId || null,
        },
      })

      return json({ ok: true, data: result })
    }

    if (body.action === 'updatePointTask') {
      if (!body.taskId || !body.status) {
        return json({ error: 'taskId и status обязательны' }, 400)
      }

      const allowedCompanyIds = new Set(context.leadAssignments.map((assignment) => assignment.company_id))
      const { data: taskRow, error: taskError } = await supabase
        .from('tasks')
        .select('id, title, status, company_id, task_number')
        .eq('id', body.taskId)
        .maybeSingle()

      if (taskError) throw taskError
      if (!taskRow) return json({ error: 'Задача не найдена' }, 404)
      if (!taskRow.company_id || !allowedCompanyIds.has(String(taskRow.company_id))) {
        return json({ error: 'У вас нет доступа к этой задаче' }, 403)
      }

      const updatePayload = {
        status: body.status,
        completed_at: body.status === 'done' ? new Date().toISOString() : null,
      }

      const { data: updatedTask, error: updateError } = await supabase
        .from('tasks')
        .update(updatePayload)
        .eq('id', body.taskId)
        .select('id, title, status, company_id, task_number')
        .single()

      if (updateError) throw updateError

      const statusLabel =
        body.status === 'todo'
          ? 'К выполнению'
          : body.status === 'in_progress'
            ? 'В работе'
            : body.status === 'review'
              ? 'На проверке'
              : 'Готово'
      const note = body.note?.trim() || null

      await addTaskComment(supabase as any, {
        taskId: body.taskId,
        operatorId: context.operator.id,
        content: note
          ? `Старший по точке перевёл задачу в статус "${statusLabel}". Комментарий: ${note}`
          : `Старший по точке перевёл задачу в статус "${statusLabel}".`,
      })

      await writeAuditLog(supabase, {
        actorUserId: context.user?.id || null,
        entityType: 'task',
        entityId: body.taskId,
        action: 'lead-update-status',
        payload: {
          task_number: updatedTask.task_number,
          company_ids: [...allowedCompanyIds],
          lead_operator_id: context.operator.id,
          status: body.status,
          note,
        },
      })

      return json({ ok: true, data: updatedTask })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    console.error('Operator lead POST error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/lead:post',
      message: error?.message || 'Operator lead POST error',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
