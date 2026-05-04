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
  // iOS Phase 1 шлёт to_operator_id + notes (упрощённая модель)
  to_operator_id?: string | null
  notes?: string | null
  // iOS Phase 2 добавит эти поля
  next_operator_id?: string | null
  next_shift_type?: 'day' | 'night' | 'custom' | null
  next_opening_cash?: number | null
  next_opening_notes?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
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
  const prevId = (open as any).id as string

  // iOS Phase 1 шлёт to_operator_id — маппим на next_operator_id
  const nextOperatorId = body.next_operator_id || body.to_operator_id || null
  // iOS Phase 1 шлёт notes — используем как closing_notes
  const closingNotes = body.closing_notes || body.notes || null

  const { data: handoverResult, error: handoverErr } = await supabase.rpc('point_shift_handover', {
    p_prev_shift_id: prevId,
    p_closed_by: staffId,
    p_closing_cash: Number(body.closing_cash || 0),
    p_closing_kaspi: Number(body.closing_kaspi || 0),
    p_kaspi_before_midnight: Number(body.kaspi_before_midnight || 0),
    p_kaspi_after_midnight: Number(body.kaspi_after_midnight || 0),
    p_z_report_url: body.z_report_url || null,
    p_x_report_url: body.x_report_url || null,
    p_closing_notes: closingNotes,
    p_company_id: companyId,
    p_operator_id: nextOperatorId,
    p_point_device_id: null,  // iOS не device
    p_shift_type: body.next_shift_type || 'day',
    p_opening_cash: Number(body.next_opening_cash || 0),
    p_opening_notes: body.next_opening_notes || null,
  })

  if (handoverErr) {
    return json({ error: 'point-shift-handover-failed', detail: handoverErr.message }, 400)
  }

  const result = handoverResult as any
  const newShiftId = result?.new_shift_id || null
  const totals = result?.totals || null

  await writeAuditLog(supabase as any, {
    action: 'point_shift.handover',
    entityType: 'point_shift',
    entityId: String(newShiftId || ''),
    payload: {
      company_id: companyId,
      previous_shift_id: prevId,
      next_operator_id: nextOperatorId,
      totals,
      source: 'ios',
    },
  })

  return json({
    previous_shift_id: prevId,
    new_shift_id: newShiftId,
    totals,
  })
}
