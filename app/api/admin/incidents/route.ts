import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks (если есть выше) уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks (если есть выше) уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const status = url.searchParams.get('status')
    const kind = url.searchParams.get('kind')
    const companyId = url.searchParams.get('company_id')
    const shiftId = url.searchParams.get('shift_id')
    const subjectStaffId = url.searchParams.get('subject_staff_id')
    const severity = url.searchParams.get('severity')
    const dateFrom = url.searchParams.get('date_from')
    const dateTo = url.searchParams.get('date_to')
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500)

    let query = supabase
      .from('incidents')
      .select(
        `id, company_id, organization_id, shift_id, article_id,
         checklist_run_id, checklist_item_id,
         kind, subject_staff_id, reported_by, reported_by_user_id,
         title, description, photo_urls,
         fine_amount, bonus_amount,
         severity, status, source,
         occurred_at, decided_at, decided_by, decision_notes,
         created_at, updated_at,
         company:company_id ( id, name, code ),
         subject:staff!subject_staff_id ( id, full_name, short_name ),
         reporter:staff!reported_by ( id, full_name, short_name ),
         article:article_id ( id, title, slug )`,
      )
      .order('occurred_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)
    if (kind && kind !== 'all') query = query.eq('kind', kind)
    if (severity && severity !== 'all') query = query.eq('severity', severity)
    if (companyId) query = query.eq('company_id', companyId)
    if (shiftId) query = query.eq('shift_id', shiftId)
    if (subjectStaffId) query = query.eq('subject_staff_id', subjectStaffId)
    if (dateFrom) query = query.gte('occurred_at', dateFrom)
    if (dateTo) query = query.lte('occurred_at', dateTo)

    if (companyScope.allowedCompanyIds) {
      query = query.in('company_id', companyScope.allowedCompanyIds)
    }

    const { data, error } = await query
    if (error) throw error

    return json({ ok: true, data: { incidents: data || [] } })
  } catch (error) {
    return json(
      { error: 'admin-incidents-list-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}

type CreateBody = {
  company_id?: string | null
  kind?: string | null
  title?: string | null
  description?: string | null
  subject_staff_id?: string | null
  reported_by?: string | null
  article_id?: string | null
  severity?: string | null
  fine_amount?: number | null
  bonus_amount?: number | null
  photo_urls?: string[] | null
  shift_id?: string | null
  status?: string | null
  source?: string | null
  occurred_at?: string | null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const body = (await request.json().catch(() => ({}))) as CreateBody
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    if (!body.company_id) return json({ error: 'company-required' }, 400)
    if (!body.title || !body.title.trim()) return json({ error: 'title-required' }, 400)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes(body.company_id)) {
      return json({ error: 'company-forbidden' }, 403)
    }

    const { data: incidentId, error: rpcError } = await supabase.rpc('incidents_create', {
      p_company_id: body.company_id,
      p_kind: body.kind || 'violation',
      p_title: body.title,
      p_description: body.description || null,
      p_subject_staff_id: body.subject_staff_id || null,
      p_reported_by: body.reported_by || null,
      p_reported_by_user_id: access.user?.id || null,
      p_article_id: body.article_id || null,
      p_severity: body.severity || 'normal',
      p_fine_amount: body.fine_amount ?? null,
      p_bonus_amount: body.bonus_amount ?? null,
      p_photo_urls: body.photo_urls || [],
      p_shift_id: body.shift_id || null,
      p_source: body.source || 'manual',
      p_checklist_run_id: null,
      p_checklist_item_id: null,
      p_status: body.status || 'confirmed',
    })

    if (rpcError) {
      return json({ error: 'incident-create-failed', detail: rpcError.message }, 400)
    }

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'incident',
      entityId: String(incidentId),
      action: 'incident-created',
      payload: { kind: body.kind, company_id: body.company_id, source: body.source || 'manual' },
    })

    return json({ ok: true, data: { id: incidentId } }, 201)
  } catch (error) {
    return json(
      { error: 'admin-incidents-create-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
