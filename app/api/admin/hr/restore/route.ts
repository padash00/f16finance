import { NextResponse } from 'next/server'

import { ensureOrganizationOperatorAccess, ensureOrganizationStaffAccess } from '@/lib/server/organizations'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
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

    const denied = await requireCapability(access, 'staff.toggle_status')
    if (denied) return denied as any

    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !access.staffRole) {
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

      const { data: staffRow, error } = await supabase
        .from('staff')
        .update({
          is_active: true,
          dismissed_at: null,
          dismissal_date: null,
          dismissal_type: null,
          dismissal_reason: null,
          dismissed_by: null,
        })
        .eq('id', id)
        .select('id, user_id')
        .single()

      if (error) throw error

      if (activeOrganizationId) {
        await supabase
          .from('organization_members')
          .update({ status: 'active' })
          .eq('organization_id', activeOrganizationId)
          .eq('staff_id', id)
      }

      // Снимаем бан с auth.user, если он был наложен при увольнении
      const staffUserId = (staffRow as any)?.user_id
      if (staffUserId) {
        try {
          await (supabase as any).auth.admin.updateUserById(staffUserId, { ban_duration: 'none' })
        } catch { /* not critical */ }
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
          dismissal_date: null,
          dismissal_type: null,
          dismissal_reason: null,
          dismissed_by: null,
        })
        .eq('id', id)

      if (error) throw error

      const { data: opAuthRows } = await supabase
        .from('operator_auth')
        .update({ is_active: true })
        .eq('operator_id', id)
        .select('user_id')

      // Снимаем бан с auth.user оператора
      for (const row of (opAuthRows || []) as any[]) {
        if (row?.user_id) {
          try {
            await (supabase as any).auth.admin.updateUserById(String(row.user_id), { ban_duration: 'none' })
          } catch { /* not critical */ }
        }
      }

      // Возвращаем назначения активными при восстановлении
      await supabase
        .from('operator_company_assignments')
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
