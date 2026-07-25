import { NextResponse } from 'next/server'

import { requireOperator } from '@/lib/server/operator-context'
import { computeShiftReport } from '@/lib/server/shift-report'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Данные сменного отчёта для веб-кассы (чековый 80мм при закрытии / повторно).
// Авторизация — оператор; смена обязана принадлежать его точке.
export async function GET(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response
  const { supabase, companyId } = ctx

  const url = new URL(request.url)
  const shiftId = String(url.searchParams.get('shift_id') || '').trim()
  if (!shiftId) return json({ error: 'shift-id-required' }, 400)

  // Проверяем принадлежность смены точке оператора (иначе чужую не покажем).
  const { data: shift } = await supabase.from('point_shifts').select('id, company_id').eq('id', shiftId).maybeSingle()
  if (!shift || String(shift.company_id) !== String(companyId)) {
    return json({ error: 'forbidden' }, 403)
  }

  const db = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : supabase
  const report = await computeShiftReport(db, shiftId)
  if (!report) return json({ error: 'not-found' }, 404)
  return json({ ok: true, report })
}
