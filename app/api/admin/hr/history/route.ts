import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { ensureOrganizationOperatorAccess, ensureOrganizationStaffAccess } from '@/lib/server/organizations'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'hr.view')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
      return json({ error: 'forbidden' }, 403)
    }

    const url = new URL(req.url)
    const kind = url.searchParams.get('kind')
    const id = String(url.searchParams.get('id') || '').trim()

    if (kind !== 'staff' && kind !== 'operator') {
      return json({ error: 'kind должен быть staff или operator' }, 400)
    }
    if (!id) return json({ error: 'id обязателен' }, 400)

    // Изоляция: id обязан принадлежать орг — иначе передав чужой operator/staff id
    // читаются HR-события (увольнения/смены ролей) сотрудника другой орг.
    try {
      if (kind === 'operator') {
        await ensureOrganizationOperatorAccess({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          operatorId: id,
        })
      } else {
        await ensureOrganizationStaffAccess({
          activeOrganizationId: access.activeOrganization?.id || null,
          isSuperAdmin: access.isSuperAdmin,
          staffId: id,
        })
      }
    } catch {
      return json({ error: 'forbidden', code: 'entity-not-in-organization' }, 403)
    }

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const { data, error } = await supabase
      .from('audit_log')
      .select('id, action, payload, created_at, actor_user_id')
      .eq('entity_type', kind)
      .eq('entity_id', id)
      .in('action', ['dismiss', 'restore', 'create', 'update', 'archive', 'activate', 'deactivate'])
      .order('created_at', { ascending: false })
      .limit(50)

    if (error) throw error

    const actorIds = Array.from(new Set((data || []).map((row: any) => row.actor_user_id).filter(Boolean)))
    const actors: Record<string, string> = {}
    if (actorIds.length > 0) {
      const { data: actorRows } = await supabase
        .from('staff')
        .select('user_id, full_name, short_name')
        .in('user_id', actorIds)
      for (const row of (actorRows || []) as any[]) {
        if (row.user_id) actors[String(row.user_id)] = String(row.full_name || row.short_name || '')
      }
    }

    const items = (data || []).map((row: any) => ({
      id: String(row.id),
      action: String(row.action),
      payload: row.payload || null,
      created_at: row.created_at,
      actor_name: row.actor_user_id ? actors[row.actor_user_id] || null : null,
    }))

    return json({ data: items })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/hr/history GET',
      message: error?.message || 'history failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
