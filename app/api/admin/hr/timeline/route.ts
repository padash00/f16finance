/**
 * HR Timeline — единая лента всех HR-событий по компании.
 *
 * GET /api/admin/hr/timeline?days=30&limit=200
 *
 * Возвращает события из audit_log:
 *   create | update | dismiss | restore | promote | demote | change_role
 * для entity_type IN ('staff', 'operator')
 *
 * Каждое событие enriched: target_name (на кого), actor_name (кто сделал).
 */

import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials, createRequestSupabaseClient } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const RELEVANT_ACTIONS = ['create', 'update', 'dismiss', 'restore', 'promote', 'demote', 'change_role']

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const denied = await requireCapability(access, 'hr.view')
    if (denied) return denied as any

    if (!access.isSuperAdmin && !access.staffRole) return json({ error: 'forbidden' }, 403)

    const url = new URL(req.url)
    const days = Math.max(1, Math.min(365, Number(url.searchParams.get('days')) || 30))
    const limit = Math.max(10, Math.min(500, Number(url.searchParams.get('limit')) || 200))
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(req)

    const { data, error } = await supabase
      .from('audit_log')
      .select('id, entity_type, entity_id, action, payload, created_at, actor_user_id')
      .in('entity_type', ['staff', 'operator'])
      .in('action', RELEVANT_ACTIONS)
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) throw error
    const events = (data || []) as any[]

    // Enrich: actor names from staff
    const actorIds = Array.from(new Set(events.map((e) => e.actor_user_id).filter(Boolean)))
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

    // Enrich: target names from staff/operators
    const staffIds = Array.from(new Set(events.filter((e) => e.entity_type === 'staff').map((e) => e.entity_id)))
    const operatorIds = Array.from(new Set(events.filter((e) => e.entity_type === 'operator').map((e) => e.entity_id)))

    const targets: Record<string, string> = {}
    if (staffIds.length > 0) {
      const { data: rows } = await supabase
        .from('staff')
        .select('id, full_name, short_name')
        .in('id', staffIds)
      for (const r of (rows || []) as any[]) {
        targets[`staff-${r.id}`] = String(r.full_name || r.short_name || r.id)
      }
    }
    if (operatorIds.length > 0) {
      const { data: rows } = await supabase
        .from('operators')
        .select('id, name, short_name')
        .in('id', operatorIds)
      for (const r of (rows || []) as any[]) {
        targets[`operator-${r.id}`] = String(r.name || r.short_name || r.id)
      }
    }

    const items = events.map((e) => ({
      id: String(e.id),
      kind: e.entity_type as 'staff' | 'operator',
      target_id: String(e.entity_id),
      target_name: targets[`${e.entity_type}-${e.entity_id}`] || null,
      action: String(e.action),
      payload: e.payload || null,
      actor_name: e.actor_user_id ? actors[String(e.actor_user_id)] || null : null,
      created_at: e.created_at,
    }))

    return json({ data: items, days })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/hr/timeline GET',
      message: error?.message || 'timeline failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
