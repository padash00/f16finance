import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

type Body = {
  closing_cash?: number | null
  closing_kaspi?: number | null
  kaspi_before_midnight?: number | null
  kaspi_after_midnight?: number | null
  z_report_url?: string | null
  x_report_url?: string | null
  closing_notes?: string | null
  closed_by?: string | null

  // Новая смена
  next_operator_id?: string | null
  next_shift_type?: 'day' | 'night' | 'custom' | null
  next_opening_cash?: number | null
  next_opening_notes?: string | null
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response

  const { supabase, device } = point
  const body = (await request.json().catch(() => ({}))) as Body

  const { data: open } = await supabase
    .from('point_shifts')
    .select('id, company_id, status')
    .eq('company_id', device.company_id)
    .eq('status', 'open')
    .maybeSingle()

  if (!open) return json({ error: 'point-shift-no-open' }, 409)
  const prevId = (open as any).id as string

  // 1) Close previous (transactional via RPC)
  const { data: totals, error: closeErr } = await supabase.rpc('point_shift_close', {
    p_shift_id: prevId,
    p_closed_by: body.closed_by || null,
    p_closing_cash: Number(body.closing_cash || 0),
    p_closing_kaspi: Number(body.closing_kaspi || 0),
    p_kaspi_before_midnight: Number(body.kaspi_before_midnight || 0),
    p_kaspi_after_midnight: Number(body.kaspi_after_midnight || 0),
    p_z_report_url: body.z_report_url || null,
    p_x_report_url: body.x_report_url || null,
    p_closing_notes: body.closing_notes || null,
  })

  if (closeErr) {
    return json({ error: 'point-shift-handover-close-failed', detail: closeErr.message }, 400)
  }

  // 2) Open new with handover_from_shift_id
  const { data: newShiftId, error: openErr } = await supabase.rpc('point_shift_open', {
    p_company_id: device.company_id,
    p_operator_id: body.next_operator_id || null,
    p_point_device_id: device.id,
    p_shift_type: body.next_shift_type || 'day',
    p_opening_cash: Number(body.next_opening_cash || 0),
    p_opening_notes: body.next_opening_notes || null,
    p_handover_from: prevId,
  })

  if (openErr) {
    return json({ error: 'point-shift-handover-open-failed', detail: openErr.message }, 400)
  }

  await writeAuditLog(supabase as any, {
    action: 'point_shift.handover',
    entityType: 'point_shift',
    entityId: String(newShiftId || ''),
    payload: {
      company_id: device.company_id,
      previous_shift_id: prevId,
      next_operator_id: body.next_operator_id || null,
      totals,
    },
  })

  return json({
    previous_shift_id: prevId,
    new_shift_id: newShiftId,
    totals,
  })
}
