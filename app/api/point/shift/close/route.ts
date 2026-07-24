import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

type Body = {
  shift_id?: string | null
  closed_by?: string | null
  closing_cash?: number | null
  closing_kaspi?: number | null
  kaspi_before_midnight?: number | null
  kaspi_after_midnight?: number | null
  z_report_url?: string | null
  x_report_url?: string | null
  closing_notes?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function resolveStaffIdForOperator(supabase: any, operatorId: string | null | undefined) {
  const id = String(operatorId || '').trim()
  if (!id) return null

  const { data: staff } = await supabase
    .from('staff')
    .select('id')
    .eq('id', id)
    .maybeSingle()
  if (staff?.id) return staff.id

  const { data: link } = await supabase
    .from('operator_staff_links')
    .select('staff_id')
    .eq('operator_id', id)
    .maybeSingle()
  return link?.staff_id || null
}

async function getMissingBlockingChecklists(supabase: any, companyId: string, orgId: string, shiftId: string) {
  const { data: templates, error: templatesError } = await supabase
    .from('checklist_templates')
    .select('id, title, schedule_type, recurrence_minutes, blocks_shift, is_active')
    .eq('is_active', true)
    .eq('blocks_shift', true)
    // Изоляция: только чек-листы своей орг. Иначе блокирующий чек-лист F16
    // (organization_id/company_id = null) не давал закрыть смену другим клиентам
    // → и отчёт не уходил, т.к. смена не закрывалась.
    .eq('organization_id', orgId)
    .or(`company_id.is.null,company_id.eq.${companyId}`)

  if (templatesError) {
    return {
      error: templatesError.message,
      missing: [] as Array<{ id: string; title: string }>,
    }
  }

  const templatesArr = ((templates || []) as any[]).filter((template) => template.schedule_type !== 'onboarding')
  if (templatesArr.length === 0) return { error: null as string | null, missing: [] as Array<{ id: string; title: string }> }

  const { data: runs, error: runsError } = await supabase
    .from('checklist_runs')
    .select('template_id, status, completed_at')
    .eq('shift_id', shiftId)
    .in(
      'template_id',
      templatesArr.map((template) => template.id),
    )
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })

  if (runsError) {
    return {
      error: runsError.message,
      missing: [] as Array<{ id: string; title: string }>,
    }
  }

  const runsByTemplate = new Map<string, any[]>()
  for (const run of (runs || []) as any[]) {
    const list = runsByTemplate.get(run.template_id) || []
    list.push(run)
    runsByTemplate.set(run.template_id, list)
  }

  const now = Date.now()
  const missing = templatesArr.filter((template) => {
    const completedRuns = runsByTemplate.get(template.id) || []
    if (completedRuns.length === 0) return true
    if (template.schedule_type !== 'periodic') return false
    const recurrenceMs = Number(template.recurrence_minutes || 0) * 60_000
    if (recurrenceMs <= 0) return false
    const lastCompletedAt = new Date(String(completedRuns[0].completed_at || '')).getTime()
    return !Number.isFinite(lastCompletedAt) || now - lastCompletedAt >= recurrenceMs
  })

  return {
    error: null as string | null,
    missing: missing.map((template) => ({ id: template.id, title: template.title })),
  }
}

export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response

  const { supabase, device } = point
  const body = (await request.json().catch(() => ({}))) as Body

  let shiftId = (body.shift_id || '').trim()

  if (!shiftId) {
    const { data: open } = await supabase
      .from('point_shifts')
      .select('id, company_id')
      .eq('company_id', device.company_id)
      .eq('status', 'open')
      .maybeSingle()
    shiftId = (open as any)?.id || ''
  } else {
    const { data: row } = await supabase
      .from('point_shifts')
      .select('id, company_id')
      .eq('id', shiftId)
      .maybeSingle()
    if (!row || (row as any).company_id !== device.company_id) {
      return json({ error: 'point-shift-not-allowed' }, 403)
    }
  }

  if (!shiftId) {
    return json({ error: 'point-shift-no-open' }, 409)
  }

  const orgId = device.company?.organization_id || '00000000-0000-0000-0000-000000000000'
  const checklistGuard = await getMissingBlockingChecklists(supabase as any, device.company_id, orgId, shiftId)
  if (checklistGuard.error) {
    return json({ error: 'point-shift-checklist-guard-failed', detail: checklistGuard.error }, 400)
  }
  if (checklistGuard.missing.length > 0) {
    return json(
      {
        error: 'point-shift-required-checklists-missing',
        message: 'Перед закрытием смены завершите обязательные чек-листы.',
        missing_checklists: checklistGuard.missing,
      },
      409,
    )
  }

  const closedByStaffId = await resolveStaffIdForOperator(supabase, body.closed_by)

  const { data, error } = await supabase.rpc('point_shift_close', {
    p_shift_id: shiftId,
    p_closed_by: closedByStaffId,
    p_closing_cash: Number(body.closing_cash || 0),
    p_closing_kaspi: Number(body.closing_kaspi || 0),
    p_kaspi_before_midnight: Number(body.kaspi_before_midnight || 0),
    p_kaspi_after_midnight: Number(body.kaspi_after_midnight || 0),
    p_z_report_url: body.z_report_url || null,
    p_x_report_url: body.x_report_url || null,
    p_closing_notes: body.closing_notes || null,
  })

  if (error) {
    return json({ error: 'point-shift-close-failed', detail: (error as any).message }, 400)
  }

  await writeAuditLog(supabase as any, {
    action: 'point_shift.close',
    entityType: 'point_shift',
    entityId: shiftId,
    payload: {
      company_id: device.company_id,
      closed_by: body.closed_by || null,
      closed_by_staff_id: closedByStaffId,
      totals: data,
    },
  })

  return json({ shift_id: shiftId, totals: data })
}
