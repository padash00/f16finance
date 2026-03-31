import { NextResponse } from 'next/server'

import { getOperatorDisplayName } from '@/lib/core/operator-name'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestOperatorContext } from '@/lib/server/request-auth'
import {
  confirmShiftPublicationWeekByOperator,
  createShiftIssueByOperator,
  shiftIsoDate,
} from '@/lib/server/shift-workflow'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type ShiftType = 'day' | 'night'

type Body =
  | {
      action: 'confirmWeek'
      responseId: string
    }
  | {
      action: 'reportIssue'
      responseId: string
      shiftDate: string
      shiftType: ShiftType
      reason: string
    }

function getWeekStart(date = new Date()) {
  const copy = new Date(date)
  const day = copy.getDay()
  const diff = day === 0 ? -6 : 1 - day
  copy.setDate(copy.getDate() + diff)
  return copy.toISOString().slice(0, 10)
}

function normalizeName(value: string | null | undefined) {
  return (value || '').trim().toLowerCase()
}

export async function GET(req: Request) {
  try {
    const context = await getRequestOperatorContext(req)
    if ('response' in context) return context.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : context.supabase
    const url = new URL(req.url)
    const weekStart = url.searchParams.get('weekStart')?.trim() || getWeekStart()
    const weekEnd = shiftIsoDate(weekStart, 6)
    const { data: operatorAssignments, error: operatorAssignmentsError } = await supabase
      .from('operator_company_assignments')
      .select('company_id')
      .eq('operator_id', context.operator.id)
      .eq('is_active', true)

    if (operatorAssignmentsError) throw operatorAssignmentsError

    const operatorCompanyIds = [...new Set((operatorAssignments || []).map((item: any) => String(item.company_id || '')).filter(Boolean))]

    const displayLabels = [
      getOperatorDisplayName(context.operator, 'Оператор'),
      context.operator.name,
      context.operator.short_name || '',
    ]
      .map((item) => normalizeName(item))
      .filter(Boolean)

    const [{ data: shifts, error: shiftsError }, { data: publications, error: publicationsError }] = await Promise.all([
      supabase
        .from('shifts')
        .select('id, company_id, date, shift_type, operator_name, comment')
        .in('company_id', operatorCompanyIds.length > 0 ? operatorCompanyIds : ['00000000-0000-0000-0000-000000000000'])
        .gte('date', weekStart)
        .lte('date', weekEnd)
        .order('date'),
      supabase
        .from('shift_week_publications')
        .select('*')
        .eq('week_start', weekStart)
        .order('published_at', { ascending: false }),
    ])

    if (shiftsError) throw shiftsError
    if (publicationsError) throw publicationsError

    const ownShifts = (shifts || []).filter((shift: any) => displayLabels.includes(normalizeName(shift.operator_name)))
    const companyIds = [...new Set(ownShifts.map((shift: any) => shift.company_id))]

    const latestPublicationByCompany = new Map<string, any>()
    for (const publication of publications || []) {
      if (!latestPublicationByCompany.has(publication.company_id)) {
        latestPublicationByCompany.set(publication.company_id, publication)
      }
    }

    const relevantPublicationIds = [...latestPublicationByCompany.values()]
      .filter((publication) => companyIds.includes(publication.company_id))
      .map((publication) => publication.id)

    const [companiesRes, responsesRes, requestsRes] = await Promise.all([
      companyIds.length > 0
        ? supabase.from('companies').select('id, name, code').in('id', companyIds)
        : Promise.resolve({ data: [], error: null }),
      relevantPublicationIds.length > 0
        ? supabase
            .from('shift_operator_week_responses')
            .select('*')
            .in('publication_id', relevantPublicationIds)
            .eq('operator_id', context.operator.id)
        : Promise.resolve({ data: [], error: null }),
      relevantPublicationIds.length > 0
        ? supabase
            .from('shift_change_requests')
            .select('*')
            .in('publication_id', relevantPublicationIds)
            .eq('operator_id', context.operator.id)
            .order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    ])

    if (companiesRes.error) throw companiesRes.error
    if (responsesRes.error) throw responsesRes.error
    if (requestsRes.error) throw requestsRes.error

    const companiesMap = new Map<string, any>()
    for (const company of companiesRes.data || []) {
      companiesMap.set(String(company.id), company)
    }

    const publicationById = new Map<string, any>()
    for (const publication of publications || []) {
      publicationById.set(String(publication.id), publication)
    }

    const responses = (responsesRes.data || []).map((response: any) => ({
      ...response,
      publication: publicationById.get(String(response.publication_id)) || null,
    }))

    const groupedSchedule = companyIds.map((companyId) => {
      const company = companiesMap.get(companyId)
      const publication = latestPublicationByCompany.get(companyId) || null
      const response = responses.find((item: any) => item.company_id === companyId) || null
      const requests = (requestsRes.data || []).filter((item: any) => item.company_id === companyId)
      const teamRoster = (shifts || [])
        .filter((shift: any) => shift.company_id === companyId)
        .sort((a: any, b: any) => a.date.localeCompare(b.date) || a.shift_type.localeCompare(b.shift_type))
      const items = ownShifts
        .filter((shift: any) => shift.company_id === companyId)
        .sort((a: any, b: any) => a.date.localeCompare(b.date))

      return {
        company: company || { id: companyId, name: 'Точка', code: null },
        publication,
        response,
        requests,
        shifts: items,
        teamRoster,
      }
    })

    return NextResponse.json({
      ok: true,
      operator: {
        id: context.operator.id,
        name: getOperatorDisplayName(context.operator, 'Оператор'),
        short_name: context.operator.short_name,
      },
      weekStart,
      weekEnd,
      schedule: groupedSchedule,
    })
  } catch (error: any) {
    console.error('Operator shifts GET error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/shifts:get',
      message: error?.message || 'Operator shifts GET error',
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

    if (body.action === 'confirmWeek') {
      if (!body.responseId) {
        return NextResponse.json({ error: 'responseId обязателен' }, { status: 400 })
      }

      const result = await confirmShiftPublicationWeekByOperator({
        supabase,
        responseId: body.responseId,
        operatorId: context.operator.id,
        source: 'cabinet',
      })

      await writeAuditLog(supabase, {
        actorUserId: context.user?.id || null,
        entityType: 'shift-week-response',
        entityId: String(body.responseId),
        action: 'operator-confirm-week',
        payload: {
          operator_id: context.operator.id,
          publication_id: result.publicationId,
        },
      })

      return NextResponse.json({ ok: true, data: result })
    }

    if (body.action === 'reportIssue') {
      if (!body.responseId || !body.shiftDate || !body.shiftType || !body.reason?.trim()) {
        return NextResponse.json({ error: 'responseId, shiftDate, shiftType и reason обязательны' }, { status: 400 })
      }

      const result = await createShiftIssueByOperator({
        supabase,
        responseId: body.responseId,
        operatorId: context.operator.id,
        shiftDate: body.shiftDate,
        shiftType: body.shiftType,
        reason: body.reason.trim(),
        source: 'cabinet',
      })

      await writeAuditLog(supabase, {
        actorUserId: context.user?.id || null,
        entityType: 'shift-change-request',
        entityId: `${body.responseId}:${body.shiftDate}:${body.shiftType}`,
        action: 'operator-report-issue',
        payload: {
          operator_id: context.operator.id,
          publication_id: result.publicationId,
          company_id: result.companyId,
          reason: body.reason.trim(),
        },
      })

      return NextResponse.json({ ok: true, data: result })
    }

    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 })
  } catch (error: any) {
    console.error('Operator shifts POST error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/shifts:post',
      message: error?.message || 'Operator shifts POST error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
