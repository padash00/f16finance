import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManage(access: { isSuperAdmin: boolean; staffRole: string }) {
  // Capability checks (если есть выше) уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

const ALLOWED_STATUS = new Set(['draft', 'confirmed', 'disputed', 'voided'])
const ALLOWED_KIND = new Set(['violation', 'bonus', 'note'])
const ALLOWED_SEVERITY = new Set(['info', 'normal', 'warning', 'critical'])

type PatchBody = {
  status?: string | null
  kind?: string | null
  severity?: string | null
  title?: string | null
  description?: string | null
  fine_amount?: number | null
  bonus_amount?: number | null
  photo_urls?: string[] | null
  decision_notes?: string | null
  subject_staff_id?: string | null
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const { id } = await params
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const { data, error } = await supabase
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
         decider:staff!decided_by ( id, full_name, short_name ),
         article:article_id ( id, title, slug )`,
      )
      .eq('id', id)
      .maybeSingle()

    if (error) throw error
    if (!data) return json({ error: 'incident-not-found' }, 404)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes((data as any).company_id)) {
      return json({ error: 'forbidden' }, 403)
    }

    return json({ ok: true, data: { incident: data } })
  } catch (error) {
    return json(
      { error: 'admin-incident-detail-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)

    const { id } = await params
    const body = (await request.json().catch(() => ({}))) as PatchBody
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const { data: existing, error: loadError } = await supabase
      .from('incidents')
      .select('id, company_id, status')
      .eq('id', id)
      .maybeSingle()
    if (loadError) throw loadError
    if (!existing) return json({ error: 'incident-not-found' }, 404)

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    if (
      companyScope.allowedCompanyIds &&
      !companyScope.allowedCompanyIds.includes((existing as any).company_id)
    ) {
      return json({ error: 'forbidden' }, 403)
    }

    const patch: Record<string, unknown> = {}
    if (body.status !== undefined && body.status !== null) {
      if (!ALLOWED_STATUS.has(body.status)) return json({ error: 'status-invalid' }, 400)
      patch.status = body.status
      if (['confirmed', 'disputed', 'voided'].includes(body.status)) {
        patch.decided_at = new Date().toISOString()
        patch.decided_by = null
      }
    }
    if (body.kind !== undefined && body.kind !== null) {
      if (!ALLOWED_KIND.has(body.kind)) return json({ error: 'kind-invalid' }, 400)
      patch.kind = body.kind
    }
    if (body.severity !== undefined && body.severity !== null) {
      if (!ALLOWED_SEVERITY.has(body.severity)) return json({ error: 'severity-invalid' }, 400)
      patch.severity = body.severity
    }
    if (body.title !== undefined && body.title !== null) {
      const t = body.title.trim()
      if (!t) return json({ error: 'title-required' }, 400)
      patch.title = t
    }
    if (body.description !== undefined) {
      patch.description = body.description ? String(body.description).trim() || null : null
    }
    if (body.fine_amount !== undefined && body.fine_amount !== null) {
      patch.fine_amount = Math.max(0, Number(body.fine_amount) || 0)
    }
    if (body.bonus_amount !== undefined && body.bonus_amount !== null) {
      patch.bonus_amount = Math.max(0, Number(body.bonus_amount) || 0)
    }
    if (body.photo_urls !== undefined && Array.isArray(body.photo_urls)) {
      patch.photo_urls = body.photo_urls
    }
    if (body.decision_notes !== undefined) {
      patch.decision_notes = body.decision_notes ? String(body.decision_notes).trim() || null : null
    }
    if (body.subject_staff_id !== undefined) {
      patch.subject_staff_id = body.subject_staff_id || null
    }

    if (Object.keys(patch).length === 0) {
      return json({ ok: true, data: { id, updated: false } })
    }

    const { error: updateError } = await supabase.from('incidents').update(patch).eq('id', id)
    if (updateError) throw updateError

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'incident',
      entityId: id,
      action: 'incident-updated',
      payload: patch,
    })

    return json({ ok: true, data: { id, updated: true } })
  } catch (error) {
    return json(
      { error: 'admin-incident-update-failed', detail: (error as any)?.message || String(error) },
      500,
    )
  }
}
