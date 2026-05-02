import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'

type Body = {
  operator_id?: string | null
  shift_type?: 'day' | 'night' | 'custom' | null
  opening_cash?: number | null
  opening_notes?: string | null
  handover_from_shift_id?: string | null
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

export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response

  const { supabase, device } = point
  if (!device.company_id) {
    return json({ error: 'point-company-required' }, 400)
  }

  const body = (await request.json().catch(() => ({}))) as Body
  const openingCashRaw = (body as any).opening_cash
  const openingCash =
    openingCashRaw === undefined || openingCashRaw === null || String(openingCashRaw).trim() === ''
      ? Number.NaN
      : Number(openingCashRaw)

  if (!Number.isFinite(openingCash) || openingCash < 0) {
    return json(
      {
        error: 'opening-cash-required',
        message: 'Перед открытием смены укажите старт кассы.',
      },
      400,
    )
  }

  const staffId = await resolveStaffIdForOperator(supabase, body.operator_id)

  const { data, error } = await supabase.rpc('point_shift_open', {
    p_company_id: device.company_id,
    p_operator_id: staffId,
    p_point_device_id: null,
    p_shift_type: body.shift_type || 'day',
    p_opening_cash: openingCash,
    p_opening_notes: body.opening_notes || null,
    p_handover_from: body.handover_from_shift_id || null,
  })

  if (error) {
    const code = String((error as any).message || '').toLowerCase()
    if (code.includes('point-shift-already-open')) {
      const { data: existing } = await supabase
        .from('point_shifts')
        .select('id, opened_at, operator_id, shift_type, opening_cash')
        .eq('company_id', device.company_id)
        .eq('status', 'open')
        .maybeSingle()
      return json({ error: 'point-shift-already-open', shift: existing || null }, 409)
    }
    if (code.includes('point-shift-operator-not-onboarded')) {
      return json(
        { error: 'point-shift-operator-not-onboarded', detail: (error as any).message },
        409,
      )
    }
    return json({ error: 'point-shift-open-failed', message: (error as any).message, detail: (error as any).message }, 400)
  }

  const shiftId = (data as unknown as string) || ''

  await writeAuditLog(supabase as any, {
    action: 'point_shift.open',
    entityType: 'point_shift',
    entityId: shiftId,
    payload: {
      company_id: device.company_id,
      operator_id: body.operator_id || null,
      staff_id: staffId,
      opening_cash: openingCash,
      shift_type: body.shift_type || 'day',
    },
  })

  return json({ shift_id: shiftId, opening_cash: openingCash })
}
