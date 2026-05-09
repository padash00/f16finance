/**
 * Список флагов ИИ-модерации для владельца / супер-админа.
 *
 * GET ?status=pending|confirmed|dismissed&limit=50
 * PATCH { id, status, note? } — рассмотреть флаг
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canModerate(access: any): boolean {
  if (access.isSuperAdmin) return true
  const role = (access.staffMember?.role || '').toLowerCase()
  return role === 'owner'
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!canModerate(access)) return json({ error: 'forbidden' }, 403)

  const url = new URL(request.url)
  const status = url.searchParams.get('status') || 'pending'
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit')) || 50))

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  let query = supabase
    .from('chat_moderation_flags')
    .select('*')
    .order('severity', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status !== 'all') {
    query = query.eq('status', status)
  }

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)

  // Кол-во pending для бейджа
  const { count: pendingCount } = await supabase
    .from('chat_moderation_flags')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')

  return json({ flags: data || [], pendingCount: pendingCount || 0 })
}

export async function PATCH(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  if (!canModerate(access)) return json({ error: 'forbidden' }, 403)

  const body = (await request.json().catch(() => null)) as
    | { id?: string; status?: 'confirmed' | 'dismissed'; note?: string }
    | null
  if (!body?.id || !body?.status) return json({ error: 'id и status обязательны' }, 400)
  if (!['confirmed', 'dismissed'].includes(body.status)) {
    return json({ error: 'status: confirmed|dismissed' }, 400)
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const { error } = await supabase
    .from('chat_moderation_flags')
    .update({
      status: body.status,
      reviewed_by: access.user?.id || null,
      reviewed_at: new Date().toISOString(),
      reviewer_note: body.note || null,
    })
    .eq('id', body.id)
  if (error) return json({ error: error.message }, 500)

  return json({ ok: true })
}
