import { NextResponse } from 'next/server'

import { writeAuditLog } from '@/lib/server/audit'
import { invalidateCapabilitiesCache } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * GET /api/admin/user-capability-overrides?user_id=...
 *   → переопределения для одного сотрудника
 *
 * GET /api/admin/user-capability-overrides
 *   → все переопределения (с информацией о пользователе)
 */
export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

  const url = new URL(request.url)
  const userId = url.searchParams.get('user_id')

  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : access.supabase

  let query = supabase
    .from('user_capability_overrides')
    .select('user_id, capability, granted, reason, created_at, created_by')
    .order('created_at', { ascending: false })

  if (userId) query = query.eq('user_id', userId)

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)

  return json({ items: data || [] })
}

/**
 * POST /api/admin/user-capability-overrides
 * Body: { action: 'set' | 'remove', user_id, capability, granted?, reason? }
 *
 * 'set':    создать или обновить переопределение
 * 'remove': удалить переопределение (вернуть к роли)
 */
export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)

  const body = (await request.json().catch(() => null)) as
    | { action?: string; user_id?: string; capability?: string; granted?: boolean; reason?: string }
    | null

  if (!body?.action) return json({ error: 'action обязателен' }, 400)
  const userId = String(body.user_id || '').trim()
  const capability = String(body.capability || '').trim()
  if (!userId || !capability) return json({ error: 'user_id и capability обязательны' }, 400)

  const supabase = hasAdminSupabaseCredentials()
    ? createAdminSupabaseClient()
    : access.supabase

  if (body.action === 'set') {
    const granted = body.granted !== false
    const reason = String(body.reason || '').trim() || null

    const { error } = await supabase
      .from('user_capability_overrides')
      .upsert(
        {
          user_id: userId,
          capability,
          granted,
          reason,
          created_by: access.user?.id || null,
        },
        { onConflict: 'user_id,capability' },
      )

    if (error) return json({ error: error.message }, 500)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'user-capability-override',
      entityId: `${userId}:${capability}`,
      action: granted ? 'grant' : 'revoke',
      payload: { user_id: userId, capability, granted, reason },
    })

    invalidateCapabilitiesCache(userId)
    return json({ ok: true })
  }

  if (body.action === 'remove') {
    const { error } = await supabase
      .from('user_capability_overrides')
      .delete()
      .eq('user_id', userId)
      .eq('capability', capability)

    if (error) return json({ error: error.message }, 500)

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'user-capability-override',
      entityId: `${userId}:${capability}`,
      action: 'remove',
      payload: { user_id: userId, capability },
    })

    invalidateCapabilitiesCache(userId)
    return json({ ok: true })
  }

  return json({ error: `Неизвестное action: ${body.action}` }, 400)
}
