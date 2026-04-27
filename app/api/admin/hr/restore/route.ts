import { NextResponse } from 'next/server'

import { ensureOrganizationOperatorAccess, ensureOrganizationStaffAccess } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  kind?: 'staff' | 'operator'
  id?: string
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    if (!access.isSuperAdmin && access.staffRole !== 'owner') {
      return json({ error: 'forbidden' }, 403)
    }

    const body = (await req.json().catch(() => null)) as Body | null
    const kind = body?.kind
    const id = String(body?.id || '').trim()

    if (kind !== 'staff' && kind !== 'operator') {
      return json({ error: 'kind должен быть staff или operator' }, 400)
    }
    if (!id) return json({ error: 'id обязателен' }, 400)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const activeOrganizationId = access.activeOrganization?.id || null

    if (kind === 'staff') {
      await ensureOrganizationStaffAccess({
        activeOrganizationId,
        isSuperAdmin: access.isSuperAdmin,
        staffId: id,
      })

      const { error } = await supabase
        .from('staff')
        .update({
          is_active: true,
          dismissed_at: null,
          dismissal_reason: null,
          dismissed_by: null,
        })
        .eq('id', id)

      if (error) throw error

      if (activeOrganizationId) {
        await supabase
          .from('organization_members')
          .update({ status: 'active' })
          .eq('organization_id', activeOrganizationId)
          .eq('staff_id', id)
      }
    } else {
      await ensureOrganizationOperatorAccess({
        activeOrganizationId,
        isSuperAdmin: access.isSuperAdmin,
        operatorId: id,
      })

      const { error } = await supabase
        .from('operators')
        .update({
          is_active: true,
          dismissed_at: null,
          dismissal_reason: null,
          dismissed_by: null,
        })
        .eq('id', id)

      if (error) throw error

      await supabase
        .from('operator_auth')
        .update({ is_active: true })
        .eq('operator_id', id)
    }

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: kind,
      entityId: id,
      action: 'restore',
      payload: { restored_at: new Date().toISOString() },
    })

    return json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/hr/restore',
      message: error?.message || 'restore failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
