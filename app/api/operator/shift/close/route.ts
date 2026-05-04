import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requireOperator } from '@/lib/server/operator-context'

type Body = {
  closing_cash?: number | null
  closing_kaspi?: number | null
  kaspi_before_midnight?: number | null
  kaspi_after_midnight?: number | null
  z_report_url?: string | null
  x_report_url?: string | null
  closing_notes?: string | null
  // iOS Phase 1 шлёт эти поля — игнорируем (RPC их не принимает)
  closing_online?: unknown
  closing_card?: unknown
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

async function getMissingBlockingChecklists(supabase: any, companyId: string, shiftId: string) {
  const { data: templates, error: templatesError } = await supabase
    .from('checklist_templates')
    .select('id, title, schedule_type, recurrence_minutes, blocks_shift, is_active')
    .eq('is_active', true)
    .eq('blocks_shift', true)
    .or(`company_id.is.null,company_id.eq.${companyId}`)

  if (templatesError) {
    return { error: templatesError.message, missing: [] as Array<{ id: string; title: string }> }
  }

  const templatesArr = ((templates || []) as any[]).filter(
    (t) => t.schedule_type !== 'onboarding',
  )
  if (templatesArr.length === 0) {
    return { error: null as string | null, missing: [] as Array<{ id: string; title: string }> }
  }

  const { data: runs, error: runsError } = await supabase
    .from('checklist_runs')
    .select('template_id, status, completed_at')
    .eq('shift_id', shiftId)
    .in(
      'template_id',
      templatesArr.map((t) => t.id),
    )
    .eq('status', 'completed')
    .order('completed_at', { ascending: false })

  if (runsError) {
    return { error: runsError.message, missing: [] as Array<{ id: string; title: string }> }
  }

  const runsByTemplate = new Map<string, any[]>()
  for (const run of (runs || []) as any[]) {
    const list = runsByTemplate.get(run.template_id) || []
    list.push(run)
    runsByTemplate.set(run.template_id, list)
  }

  const now = Date.now()
  const missing = templatesArr.filter((t) => {
    const completedRuns = runsByTemplate.get(t.id) || []
    if (completedRuns.length === 0) return true
    if (t.schedule_type !== 'periodic') return false
    const recurrenceMs = Number(t.recurrence_minutes || 0) * 60_000
    if (recurrenceMs <= 0) return false
    const lastAt = new Date(String(completedRuns[0].completed_at || '')).getTime()
    return !Number.isFinite(lastAt) || now - lastAt >= recurrenceMs
  })

  return {
    error: null as string | null,
    missing: missing.map((t) => ({ id: t.id, title: t.title })),
  }
}

export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const { supabase, companyId, staffId } = ctx
  const body = (await request.json().catch(() => ({}))) as Body

  const { data: open } = await supabase
    .from('point_shifts')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'open')
    .maybeSingle()

  if (!open) return json({ error: 'point-shift-no-open' }, 409)
  const shiftId = (open as any).id as string

  const checklistGuard = await getMissingBlockingChecklists(supabase as any, companyId, shiftId)
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

  const { data, error } = await supabase.rpc('point_shift_close', {
    p_shift_id: shiftId,
    p_closed_by: staffId,
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
      company_id: companyId,
      closed_by_staff_id: staffId,
      totals: data,
      source: 'ios',
    },
  })

  return json({ shift_id: shiftId, totals: data })
}
