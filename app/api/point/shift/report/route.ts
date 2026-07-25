import { NextResponse } from 'next/server'

import { requirePointDevice } from '@/lib/server/point-devices'
import { computeShiftReport } from '@/lib/server/shift-report'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Данные сменного отчёта для операторской десктоп-программы (чек при закрытии).
// Авторизация — токен устройства; смена обязана принадлежать точке устройства.
export async function GET(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  const url = new URL(request.url)
  const shiftId = String(url.searchParams.get('shift_id') || '').trim()
  if (!shiftId) return json({ error: 'shift-id-required' }, 400)

  const { data: shift } = await supabase.from('point_shifts').select('id, company_id').eq('id', shiftId).maybeSingle()
  if (!shift || !device.company_id || String(shift.company_id) !== String(device.company_id)) {
    return json({ error: 'forbidden' }, 403)
  }

  const db = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : supabase
  const report = await computeShiftReport(db, shiftId)
  if (!report) return json({ error: 'not-found' }, 404)
  return json({ ok: true, report })
}
