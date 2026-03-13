import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type AuditRow = {
  id: string
  actor_user_id: string | null
  entity_type: string
  entity_id: string
  action: string
  payload: Record<string, unknown> | null
  created_at: string
}

type NotificationRow = {
  id: string
  channel: string
  recipient: string
  status: string
  payload: Record<string, unknown> | null
  created_at: string
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) {
      return json({ error: 'forbidden' }, 403)
    }

    const url = new URL(req.url)
    const search = url.searchParams.get('q')?.trim().toLowerCase() || ''
    const entityType = url.searchParams.get('entityType')?.trim().toLowerCase() || ''
    const action = url.searchParams.get('action')?.trim().toLowerCase() || ''
    const channel = url.searchParams.get('channel')?.trim().toLowerCase() || ''
    const status = url.searchParams.get('status')?.trim().toLowerCase() || ''
    const page = Math.max(1, Number(url.searchParams.get('page') || 1))
    const limit = Math.min(200, Math.max(20, Number(url.searchParams.get('limit') || 80)))

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const [{ data: auditRows, error: auditError }, { data: notificationRows, error: notificationError }] = await Promise.all([
      supabase.from('audit_log').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('notification_log').select('*').order('created_at', { ascending: false }).limit(300),
    ])

    if (auditError) throw auditError
    if (notificationError) throw notificationError

    const actorIds = Array.from(
      new Set(((auditRows || []) as AuditRow[]).map((row) => row.actor_user_id).filter(Boolean)),
    ) as string[]

    const actorEmailMap = new Map<string, string>()
    if (actorIds.length > 0 && hasAdminSupabaseCredentials()) {
      const { data, error } = await createAdminSupabaseClient().auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (!error && data?.users) {
        for (const user of data.users) {
          if (user.id && user.email && actorIds.includes(user.id)) {
            actorEmailMap.set(user.id, user.email)
          }
        }
      }
    }

    const combined = [
      ...((auditRows || []) as AuditRow[]).map((row) => ({
        id: `audit:${row.id}`,
        kind: 'audit' as const,
        createdAt: row.created_at,
        title: `${row.entity_type} • ${row.action}`,
        subtitle: row.entity_id,
        entityType: row.entity_type,
        action: row.action,
        actorUserId: row.actor_user_id,
        actorEmail: row.actor_user_id ? actorEmailMap.get(row.actor_user_id) || null : null,
        channel: null,
        status: null,
        recipient: null,
        payload: row.payload || null,
      })),
      ...((notificationRows || []) as NotificationRow[]).map((row) => ({
        id: `notification:${row.id}`,
        kind: 'notification' as const,
        createdAt: row.created_at,
        title: `${row.channel} • ${row.status}`,
        subtitle: row.recipient,
        entityType: null,
        action: row.payload?.kind ? String(row.payload.kind) : 'notification',
        actorUserId: null,
        actorEmail: null,
        channel: row.channel,
        status: row.status,
        recipient: row.recipient,
        payload: row.payload || null,
      })),
    ]
      .filter((item) => {
        if (entityType && (item.entityType || '').toLowerCase() !== entityType) return false
        if (action && (item.action || '').toLowerCase() !== action) return false
        if (channel && (item.channel || '').toLowerCase() !== channel) return false
        if (status && (item.status || '').toLowerCase() !== status) return false
        if (!search) return true

        const haystack = JSON.stringify(item).toLowerCase()
        return haystack.includes(search)
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const total = combined.length
    const start = (page - 1) * limit
    const items = combined.slice(start, start + limit)

    return json({
      ok: true,
      total,
      page,
      limit,
      items,
      filters: {
        entityTypes: Array.from(new Set(combined.map((item) => item.entityType).filter(Boolean))).sort(),
        actions: Array.from(new Set(combined.map((item) => item.action).filter(Boolean))).sort(),
        channels: Array.from(new Set(combined.map((item) => item.channel).filter(Boolean))).sort(),
        statuses: Array.from(new Set(combined.map((item) => item.status).filter(Boolean))).sort(),
      },
    })
  } catch (error: any) {
    console.error('Admin logs route error', error)
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
