import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const revalidate = 0

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { humanizeDbError } from '@/lib/server/db-error-humanize'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireStaffCapability } from '@/lib/server/capabilities'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type SavePayload = {
  action: 'save'
  id?: string
  name: string
  payload: Record<string, unknown>
}
type DeletePayload = {
  action: 'delete'
  id: string
}
type Body = SavePayload | DeletePayload

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const url = new URL(req.url)
    const id = String(url.searchParams.get('id') || '').trim()
    const orgId = access.activeOrganization?.id || null

    if (id) {
      let q: any = supabase.from('branch_plan_drafts').select('*').eq('id', id).limit(1)
      if (orgId && !access.isSuperAdmin) q = q.eq('organization_id', orgId)
      const { data, error } = await q.maybeSingle()
      if (error) throw error
      if (!data) return json({ error: 'not-found' }, 404)
      return json({ ok: true, data: { draft: data } })
    }

    let listQ: any = supabase
      .from('branch_plan_drafts')
      .select('id, name, payload, updated_at, created_at')
      .order('updated_at', { ascending: false })
      .limit(100)
    if (orgId && !access.isSuperAdmin) listQ = listQ.eq('organization_id', orgId)
    const { data: drafts, error } = await listQ
    if (error) throw error

    return json({ ok: true, data: { drafts: drafts || [] } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/branch-plan.GET',
      message: error?.message || 'error',
    })
    return json({
      error: humanizeDbError(error, 'Не удалось загрузить финмодель'),
      debug: {
        code: String(error?.code || ''),
        message: String(error?.message || ''),
        details: String(error?.details || ''),
        hint: String(error?.hint || ''),
      },
    }, 500)
  }
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    const denied = await requireStaffCapability(access, 'branch-plan.edit')
    if (denied) return denied

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : null
    if (!supabase) return json({ error: 'no admin supabase' }, 500)

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.action) return json({ error: 'invalid-action' }, 400)
    const actorUserId = access.user?.id || null
    const orgId = access.activeOrganization?.id || null

    if (body.action === 'delete') {
      const id = String(body.id || '').trim()
      if (!id) return json({ error: 'id-required' }, 400)
      let delQ: any = supabase.from('branch_plan_drafts').delete().eq('id', id)
      if (orgId && !access.isSuperAdmin) delQ = delQ.eq('organization_id', orgId)
      const { error } = await delQ
      if (error) throw error
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'branch-plan-draft',
        entityId: id,
        action: 'delete',
        payload: {},
      })
      return json({ ok: true })
    }

    if (body.action === 'save') {
      const name = String(body.name || '').trim() || 'Без названия'
      const id = body.id?.trim() || null
      const payload = body.payload || {}
      if (id) {
        let updQ: any = supabase
          .from('branch_plan_drafts')
          .update({ name, payload, updated_at: new Date().toISOString() })
          .eq('id', id)
          .select('id')
          .single()
        if (orgId && !access.isSuperAdmin) updQ = updQ.eq('organization_id', orgId)
        const { data, error } = await updQ
        if (error) throw error
        await writeAuditLog(supabase as any, {
          actorUserId,
          entityType: 'branch-plan-draft',
          entityId: String(data?.id || id),
          action: 'update',
          payload: { name },
        })
        return json({ ok: true, data: { id: data?.id || id } })
      }
      const insertPayload: Record<string, unknown> = {
        organization_id: orgId,
        name,
        payload,
        created_by: actorUserId,
      }
      const { data, error } = await supabase
        .from('branch_plan_drafts')
        .insert([insertPayload])
        .select('id')
        .single()
      if (error) throw error
      await writeAuditLog(supabase as any, {
        actorUserId,
        entityType: 'branch-plan-draft',
        entityId: String(data?.id || ''),
        action: 'create',
        payload: { name },
      })
      return json({ ok: true, data: { id: data?.id } })
    }

    return json({ error: 'invalid-action' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/branch-plan.POST',
      message: error?.message || 'error',
    })
    return json({ error: humanizeDbError(error, 'Не удалось сохранить финмодель') }, 500)
  }
}
