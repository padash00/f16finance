import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { computeShiftReport } from '@/lib/server/shift-report'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

// Данные A4 Z-отчёта для сайта (страница «Смены» → «Z-отчёт»). Владелец/менеджер.
export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.isSuperAdmin && !access.staffMember) return json({ error: 'forbidden' }, 403)

  const url = new URL(request.url)
  const shiftId = String(url.searchParams.get('shift_id') || '').trim()
  if (!shiftId) return json({ error: 'shift-id-required' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Скоуп: смена обязана принадлежать компании из орг вызывающего.
  const { data: shift } = await supabase.from('point_shifts').select('id, company_id').eq('id', shiftId).maybeSingle()
  if (!shift) return json({ error: 'not-found' }, 404)

  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })
  if (scope.allowedCompanyIds && !scope.allowedCompanyIds.includes(String(shift.company_id))) {
    return json({ error: 'forbidden' }, 403)
  }

  const report = await computeShiftReport(supabase, shiftId)
  if (!report) return json({ error: 'not-found' }, 404)
  return json({ ok: true, report })
}
