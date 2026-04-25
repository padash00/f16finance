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

    const { data: shift, error } = await supabase
      .from('point_shifts')
      .select(
        `id, company_id, organization_id, operator_id, point_device_id,
         status, shift_type, opened_at, closed_at,
         opening_cash, opening_notes,
         closing_cash, closing_kaspi, closing_kaspi_before_midnight, closing_kaspi_after_midnight, closing_notes,
         z_report_url, x_report_url, totals_json,
         handover_from_shift_id, closed_by, created_at, updated_at,
         company:company_id ( id, name, code ),
         operator:operator_id ( id, name, short_name ),
         closer:closed_by ( id, name, short_name )`,
      )
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (!shift) return json({ error: 'shift-not-found' }, 404)

    if (
      companyScope.allowedCompanyIds &&
      !companyScope.allowedCompanyIds.includes((shift as any).company_id)
    ) {
      return json({ error: 'forbidden' }, 403)
    }

    const [salesRes, returnsRes, runsRes, incidentsRes] = await Promise.all([
      supabase
        .from('point_sales')
        .select(
          'id, sale_date, shift, payment_method, cash_amount, kaspi_amount, total_amount, comment, sold_at, source',
        )
        .eq('shift_id', id)
        .order('sold_at', { ascending: false }),
      supabase
        .from('point_returns')
        .select(
          'id, return_date, shift, payment_method, cash_amount, kaspi_amount, total_amount, comment, returned_at, source',
        )
        .eq('shift_id', id)
        .order('returned_at', { ascending: false }),
      supabase
        .from('checklist_runs')
        .select(
          `id, template_id, status, started_at, completed_at, scheduled_at,
           responses, fines_total, bonuses_total, run_by, co_signed_by,
           template:template_id ( id, title, schedule_type, recurrence_minutes, blocks_shift ),
           runner:run_by ( id, name, short_name ),
           cosigner:co_signed_by ( id, name, short_name )`,
        )
        .eq('shift_id', id)
        .order('started_at', { ascending: false }),
      supabase
        .from('incidents')
        .select(
          `id, kind, title, description, fine_amount, bonus_amount,
           severity, status, source, occurred_at,
           subject_staff_id, reported_by, article_id, checklist_run_id,
           subject:subject_staff_id ( id, name, short_name ),
           reporter:reported_by ( id, name, short_name ),
           article:article_id ( id, title, slug )`,
        )
        .eq('shift_id', id)
        .order('occurred_at', { ascending: false }),
    ])

    const incidents = (incidentsRes.data || []) as any[]
    let finesTotal = 0
    let bonusesTotal = 0
    for (const inc of incidents) {
      if (inc.status !== 'confirmed') continue
      if (inc.kind === 'violation') finesTotal += Number(inc.fine_amount || 0)
      if (inc.kind === 'bonus') bonusesTotal += Number(inc.bonus_amount || 0)
    }

    return json({
      ok: true,
      data: {
        shift,
        sales: salesRes.data || [],
        returns: returnsRes.data || [],
        checklist_runs: runsRes.data || [],
        incidents,
        incidents_summary: {
          fines_total: finesTotal,
          bonuses_total: bonusesTotal,
          count: incidents.length,
        },
      },
    })
  } catch (error) {
    return json(
      { error: 'admin-shift-detail-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
