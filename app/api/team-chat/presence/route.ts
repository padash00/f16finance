/**
 * Presence для чата: кто онлайн и кто печатает.
 *
 * POST { typing?: boolean } — heartbeat (раз в 10с) + опционально флаг "печатает"
 * GET — список активных за последние 30 секунд + кто сейчас печатает
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as { typing?: boolean } | null
  const typing = !!body?.typing

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  let userId: string | null = null
  let userName = 'Аноним'
  let userRole = 'staff'

  if (access.user) userId = access.user.id
  if (access.staffMember) {
    userName = access.staffMember.full_name || access.user?.email || 'Сотрудник'
    userRole = access.staffMember.role || 'staff'
  } else if (access.operatorAuth) {
    userId = access.operatorAuth.operator_id
    userRole = 'operator'
    const { data: op } = await supabase
      .from('operators')
      .select('short_name, name')
      .eq('id', access.operatorAuth.operator_id)
      .maybeSingle()
    userName = (op as any)?.short_name || (op as any)?.name || access.operatorAuth.username || 'Оператор'
  } else if (access.isSuperAdmin) {
    userName = access.user?.email || 'Супер-админ'
    userRole = 'super_admin'
  }

  if (!userId) return json({ error: 'unauthorized' }, 401)

  const orgId = access.activeOrganization?.id || null

  const { error } = await supabase.from('team_chat_presence').upsert(
    {
      user_id: userId,
      organization_id: orgId,
      user_name: userName,
      user_role: userRole,
      is_typing: typing,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,organization_id' },
  )

  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in access) return access.response

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const orgId = access.activeOrganization?.id || null
  const sinceSeen = new Date(Date.now() - 30_000).toISOString()
  const sinceTyping = new Date(Date.now() - 8_000).toISOString()

  let query = supabase
    .from('team_chat_presence')
    .select('user_id, user_name, user_role, is_typing, last_seen_at')
    .gte('last_seen_at', sinceSeen)

  if (orgId) {
    query = query.or(`organization_id.eq.${orgId},organization_id.is.null`)
  }

  const { data, error } = await query
  if (error) return json({ error: error.message }, 500)

  const online = data || []
  const typing = online.filter(
    (p) => p.is_typing && new Date(p.last_seen_at).getTime() > Date.now() - 8_000,
  )

  return json({
    online,
    onlineCount: online.length,
    typing,
  })
}
