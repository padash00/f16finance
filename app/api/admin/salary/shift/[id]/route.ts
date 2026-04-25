import { NextResponse } from 'next/server'

import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || ['owner', 'manager', 'other'].includes(access.staffRole)
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const { id } = await params
    if (!id) return json({ error: 'invalid-shift-id' }, 400)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const { data: shift, error: shiftError } = await supabase
      .from('point_shifts')
      .select(
        `id, company_id, organization_id, operator_id, status, shift_type,
         opened_at, closed_at, opening_cash, closing_cash, closing_kaspi,
         totals_json,
         company:company_id ( id, name, code ),
         operator:operator_id ( id, full_name, short_name )`,
      )
      .eq('id', id)
      .maybeSingle()

    if (shiftError) throw shiftError
    if (!shift) return json({ error: 'shift-not-found' }, 404)

    if (
      companyScope.allowedCompanyIds &&
      !companyScope.allowedCompanyIds.includes((shift as any).company_id)
    ) {
      return json({ error: 'forbidden' }, 403)
    }

    // Свежий пересчёт incidents — на случай если состав изменился после закрытия.
    const { data: incidents } = await supabase
      .from('incidents')
      .select('id, kind, fine_amount, bonus_amount, status, subject_staff_id, occurred_at, source, title')
      .eq('shift_id', id)

    const incidentsArr = (incidents || []) as any[]
    let finesTotal = 0
    let bonusesTotal = 0
    const byStaff: Record<string, { fines: number; bonuses: number; count: number }> = {}

    for (const inc of incidentsArr) {
      if (inc.status !== 'confirmed') continue
      const subject = inc.subject_staff_id || (shift as any).operator_id || 'unknown'
      if (!byStaff[subject]) byStaff[subject] = { fines: 0, bonuses: 0, count: 0 }
      if (inc.kind === 'violation') {
        finesTotal += Number(inc.fine_amount || 0)
        byStaff[subject].fines += Number(inc.fine_amount || 0)
      }
      if (inc.kind === 'bonus') {
        bonusesTotal += Number(inc.bonus_amount || 0)
        byStaff[subject].bonuses += Number(inc.bonus_amount || 0)
      }
      byStaff[subject].count += 1
    }

    const totals = ((shift as any).totals_json || {}) as Record<string, any>

    return json({
      ok: true,
      data: {
        shift,
        incidents: incidentsArr,
        salary: {
          fines_total: finesTotal,
          bonuses_total: bonusesTotal,
          adjustment: bonusesTotal - finesTotal,
          by_staff: byStaff,
        },
        totals_at_close: totals,
      },
    })
  } catch (error) {
    return json(
      { error: 'admin-salary-shift-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
