/**
 * Live-presence: какие операторские терминалы сейчас онлайн.
 * Используется на сайте админа — видит "Точка №2 — Айбек, активен 12 сек назад".
 *
 * GET → список устройств
 * POST → отправить push сообщение в operator (kind, body)
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeAuditLog } from '@/lib/server/audit'

export const runtime = 'nodejs'

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000 // 2 минуты — "онлайн"

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canManageDevices(access: { isSuperAdmin: boolean; staffRole?: string | null }) {
  return access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  let query = supabase
    .from('point_projects')
    .select(
      'id, name, project_token, last_seen_at, last_app_version, is_active, last_operator_id, company_ids, last_operator:last_operator_id(id, name, short_name)',
    )
    .eq('is_active', true)
    .order('last_seen_at', { ascending: false })

  // Фильтрация по компаниям (если не суперадмин)
  if (scope.allowedCompanyIds) {
    // company_ids — массив, проверяем пересечение
    query = query.overlaps('company_ids', scope.allowedCompanyIds)
  }

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)

  const now = Date.now()
  const devices = ((data as any[]) || []).map((d) => {
    const lastSeen = d.last_seen_at ? new Date(d.last_seen_at).getTime() : 0
    const ageMs = now - lastSeen
    const isOnline = ageMs < ONLINE_THRESHOLD_MS && lastSeen > 0
    const operator = Array.isArray(d.last_operator) ? d.last_operator[0] : d.last_operator
    return {
      id: d.id,
      name: d.name || 'Без имени',
      isOnline,
      ageSeconds: lastSeen > 0 ? Math.floor(ageMs / 1000) : null,
      lastSeenAt: d.last_seen_at,
      appVersion: d.last_app_version,
      operatorName: operator?.short_name || operator?.name || null,
      tokenPreview: (d.project_token || '').slice(0, 8) + '…',
    }
  })

  // Сортируем: онлайн → вверх
  devices.sort((a, b) => Number(b.isOnline) - Number(a.isOnline) || (a.ageSeconds || 999999) - (b.ageSeconds || 999999))

  return json({ devices, onlineCount: devices.filter((d) => d.isOnline).length })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!canManageDevices(access)) return json({ error: 'forbidden' }, 403)
  if (!access.user) return json({ error: 'unauthenticated' }, 401)

  const body = await request.json().catch(() => null) as
    | { deviceId?: string; deviceIds?: string[]; kind?: string; body?: string; expiresInMin?: number }
    | null

  if (!body || !body.body || (!body.deviceId && !body.deviceIds?.length)) {
    return json({ error: 'deviceId(s) and body required' }, 400)
  }

  const kind = ['info', 'warning', 'urgent', 'lock_sales', 'unlock_sales'].includes(body.kind || '')
    ? body.kind!
    : 'info'

  const targets = body.deviceIds?.length ? body.deviceIds : [body.deviceId!]
  const expiresAt = body.expiresInMin ? new Date(Date.now() + body.expiresInMin * 60_000).toISOString() : null

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const rows = targets.map((deviceId) => ({
    device_id: deviceId,
    kind,
    body: String(body.body || '').slice(0, 1000),
    sent_by: access.user.id,
    sent_by_name: access.user.email || null,
    expires_at: expiresAt,
  }))

  const { error } = await supabase.from('point_device_messages').insert(rows)
  if (error) return json({ error: error.message }, 500)

  await writeAuditLog(supabase, {
    actorUserId: access.user.id,
    entityType: 'point_device',
    entityId: targets.join(','),
    action: 'point_device.message_sent',
    payload: { kind, body: body.body?.slice(0, 200) },
  })

  return json({ ok: true, sent: rows.length })
}
