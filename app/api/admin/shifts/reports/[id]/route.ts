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
         operator:staff!operator_id ( id, full_name, short_name ),
         closer:staff!closed_by ( id, full_name, short_name )`,
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
           runner:staff!run_by ( id, full_name, short_name ),
           cosigner:staff!co_signed_by ( id, full_name, short_name )`,
        )
        .eq('shift_id', id)
        .order('started_at', { ascending: false }),
      supabase
        .from('incidents')
        .select(
          `id, kind, title, description, fine_amount, bonus_amount,
           severity, status, source, occurred_at,
           subject_staff_id, reported_by, article_id, checklist_run_id,
           subject:staff!subject_staff_id ( id, full_name, short_name ),
           reporter:staff!reported_by ( id, full_name, short_name ),
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

    // Fallback: если staff-оператор смены пустой, подтягиваем из первой продажи
    const shiftWithOperator = shift as any
    if (!shiftWithOperator.operator || !shiftWithOperator.operator.id) {
      const { data: firstSale } = await supabase
        .from('point_sales')
        .select('operator_id, operator:operators!operator_id(id, full_name, short_name)')
        .eq('shift_id', id)
        .not('operator_id', 'is', null)
        .order('sold_at', { ascending: true })
        .limit(1)
        .maybeSingle()
      if (firstSale && (firstSale as any).operator) {
        const op = (firstSale as any).operator
        const opObj = Array.isArray(op) ? op[0] : op
        if (opObj?.id) {
          shiftWithOperator.operator = {
            id: opObj.id,
            full_name: opObj.full_name,
            short_name: opObj.short_name,
          }
          shiftWithOperator.operator_source = 'sales'
        }
      }
    }

    return json({
      ok: true,
      data: {
        shift: shiftWithOperator,
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

// ─── Админ-действия над сменой: closeForce, purge ───────────────────────────
function canManageShift(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || access.staffRole === 'owner'
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageShift(access)) return json({ error: 'forbidden' }, 403)

    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as {
      action?: 'closeForce' | 'purge'
      note?: string
      confirm?: string
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const actorUserId = access.user?.id || null

    if (body.action === 'closeForce') {
      const { error: rpcErr } = await supabase.rpc('point_shift_admin_close', {
        p_shift_id: id,
        p_actor_user_id: actorUserId,
        p_note: (body.note || '').trim() || null,
      })
      if (rpcErr) {
        const msg = String(rpcErr.message || '')
        if (msg.includes('shift-not-found')) return json({ error: 'shift-not-found' }, 404)
        if (msg.includes('shift-already-closed')) return json({ error: 'shift-already-closed' }, 409)
        throw rpcErr
      }
      return json({ ok: true })
    }

    if (body.action === 'purge') {
      // Только super-admin может удалять смены целиком
      if (!access.isSuperAdmin) return json({ error: 'forbidden', message: 'Удаление смены — только для суперадмина' }, 403)
      if (body.confirm !== 'УДАЛИТЬ СМЕНУ') {
        return json({ error: 'confirm-phrase-required', message: 'Введите фразу подтверждения: УДАЛИТЬ СМЕНУ' }, 400)
      }
      const { data, error: rpcErr } = await supabase.rpc('point_shift_admin_purge', {
        p_shift_id: id,
        p_actor_user_id: actorUserId,
      })
      if (rpcErr) throw rpcErr
      const result = Array.isArray(data) ? data[0] : data
      return json({ ok: true, data: result })
    }

    return json({ error: 'unknown-action' }, 400)
  } catch (error: any) {
    return json(
      { error: 'admin-shift-action-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
