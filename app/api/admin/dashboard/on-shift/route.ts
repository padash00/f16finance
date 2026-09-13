import { NextResponse } from 'next/server'

import { addDaysISO } from '@/lib/core/date'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireAnyCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

/**
 * Кто на смене — для карточек точек на главном дашборде.
 *
 * Два источника:
 * - открытая смена на кассе (`point_shifts`, status=open) — «работает прямо сейчас»;
 * - график (`shifts`) на сегодня и завтра — «кто должен выйти».
 *
 * На точках, где кассовые смены не открывают (клуб на SENET), остаётся только
 * график, поэтому клиент не должен писать «смена не открыта» — этого мы не знаем.
 */

type OnShiftPoint = {
  open: { operatorName: string; shiftType: string; openedAt: string } | null
  scheduled: Array<{ date: string; shiftType: string; operatorName: string }>
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireAnyCapability(access, ['dashboard.view', 'shifts.view'])
    if (denied) return denied

    const url = new URL(req.url)
    const dateParam = url.searchParams.get('date') || ''
    // Дата берётся у клиента: сервер живёт в UTC, а сутки в Казахстане начинаются на 5 часов раньше
    const today = /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : new Date().toISOString().slice(0, 10)
    const tomorrow = addDaysISO(today, 1)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : createRequestSupabaseClient(req)
    const scope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (scope.allowedCompanyIds !== null && scope.allowedCompanyIds.length === 0) {
      return NextResponse.json({ ok: true, data: { today, points: {} } })
    }

    let openQuery: any = supabase
      .from('point_shifts')
      .select('company_id, shift_type, opened_at, operator:staff!operator_id ( full_name, short_name )')
      .eq('status', 'open')
    let scheduleQuery: any = supabase
      .from('shifts')
      .select('company_id, date, shift_type, operator_name')
      .gte('date', today)
      .lte('date', tomorrow)
      .order('date')
    if (scope.allowedCompanyIds !== null) {
      openQuery = openQuery.in('company_id', scope.allowedCompanyIds)
      scheduleQuery = scheduleQuery.in('company_id', scope.allowedCompanyIds)
    }

    const [openRes, scheduleRes] = await Promise.all([openQuery, scheduleQuery])
    if (openRes.error) throw openRes.error
    if (scheduleRes.error) throw scheduleRes.error

    const points: Record<string, OnShiftPoint> = {}
    const point = (companyId: string) => {
      if (!points[companyId]) points[companyId] = { open: null, scheduled: [] }
      return points[companyId]
    }

    for (const row of (openRes.data || []) as any[]) {
      const operator = Array.isArray(row.operator) ? row.operator[0] : row.operator
      point(String(row.company_id)).open = {
        operatorName: operator?.full_name || operator?.short_name || 'Оператор',
        shiftType: String(row.shift_type || 'day'),
        openedAt: String(row.opened_at),
      }
    }

    for (const row of (scheduleRes.data || []) as any[]) {
      const name = String(row.operator_name || '').trim()
      if (!name) continue
      point(String(row.company_id)).scheduled.push({
        date: String(row.date),
        shiftType: String(row.shift_type || 'day'),
        operatorName: name,
      })
    }

    return NextResponse.json({ ok: true, data: { today, points } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/dashboard/on-shift GET', message: error?.message || 'error' })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
