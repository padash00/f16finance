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

  const { data, error } = await supabase.rpc('point_shift_close', {
    p_shift_id: shiftId,
    p_closed_by: body.closed_by || null,
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
      totals: data,
    },
  })

  return json({ shift_id: shiftId, totals: data })
}
