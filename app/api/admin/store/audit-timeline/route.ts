import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageStore(access: {
  isSuperAdmin: boolean
  staffRole: 'manager' | 'marketer' | 'owner' | 'other'
}) {
  // Capability checks выше уже отсеивают; здесь — любой staff
  return access.isSuperAdmin || !!access.staffRole
}

const STORE_AUDIT_ENTITY_TYPES = [
  'inventory-request',
  'inventory-receipt',
  'inventory-writeoff',
  'inventory-warehouse-alloc',
  'inventory-catalog-stock',
  'inventory-warehouse-stock',
]

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManageStore(access)) return json({ error: 'forbidden' }, 403)

    const url = new URL(request.url)
    const limit = Math.min(100, Math.max(10, Number(url.searchParams.get('limit') || 30)))
    const entityType = String(url.searchParams.get('entity_type') || '').trim()
    const entityId = String(url.searchParams.get('entity_id') || '').trim()

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    let query = supabase
      .from('audit_log')
      .select('id, actor_user_id, entity_type, entity_id, action, payload, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (entityType) query = query.eq('entity_type', entityType)
    else query = query.in('entity_type', STORE_AUDIT_ENTITY_TYPES)
    if (entityId) query = query.eq('entity_id', entityId)

    const { data: rows, error } = await query
    if (error) throw error

    const actorIds = Array.from(new Set((rows || []).map((r: any) => String(r.actor_user_id || '').trim()).filter(Boolean)))
    const staffMap: Record<string, { full_name: string | null; role: string | null }> = {}
    if (actorIds.length > 0) {
      const { data: staffRows } = await supabase
        .from('staff')
        .select('id, full_name, role')
        .in('id', actorIds)
      for (const s of staffRows || []) {
        staffMap[String((s as any).id)] = {
          full_name: ((s as any).full_name as string) || null,
          role: ((s as any).role as string) || null,
        }
      }
    }

    const timeline = (rows || []).map((row: any) => ({
      ...row,
      actor_staff: row.actor_user_id ? staffMap[String(row.actor_user_id)] || null : null,
    }))

    return json({ ok: true, data: { timeline } })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/store/audit-timeline.GET',
      message: error?.message || 'Store audit timeline GET error',
    })
    return json({ error: error?.message || 'Не удалось загрузить журнал действий' }, 500)
  }
}

