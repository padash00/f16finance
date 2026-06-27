import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

const ROLES = new Set(['owner', 'manager', 'marketer', 'other'])

type MemberRow = {
  id: string
  organization_id: string
  staff_id: string | null
  user_id: string | null
  email: string | null
  role: string
  status: string
  is_default: boolean
  metadata: any
}

// Производное состояние аккаунта участника — человекочитаемо для UI.
function accountState(m: MemberRow): 'no_email' | 'no_account' | 'invited' | 'active' {
  if (!m.email) return 'no_email'
  if (!m.user_id) return 'no_account'
  if (m.status === 'invited') return 'invited'
  return 'active'
}

function mapMember(m: MemberRow, staffName: Map<string, { full_name: string; short_name: string | null }>) {
  const staff = m.staff_id ? staffName.get(m.staff_id) : undefined
  const metaName = String(m.metadata?.full_name || m.metadata?.fullName || '').trim()
  const fullName = staff?.full_name || metaName || m.email || '—'
  return {
    id: m.id,
    organizationId: m.organization_id,
    staffId: m.staff_id,
    userId: m.user_id,
    email: m.email,
    role: m.role,
    status: m.status,
    isDefault: m.is_default,
    fullName,
    shortName: staff?.short_name || null,
    accountState: accountState(m),
    emailConfirmedAt: null as string | null,
  }
}

// GET ?organizationId=X → { items: OrganizationMember[] }
export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const orgId = String(new URL(request.url).searchParams.get('organizationId') || '').trim()
    if (!orgId) return json({ error: 'organizationId обязателен' }, 400)

    const { data, error } = await supabase
      .from('organization_members')
      .select('id, organization_id, staff_id, user_id, email, role, status, is_default, metadata')
      .eq('organization_id', orgId)
      .order('created_at', { ascending: true })
    if (error) return json({ error: error.message }, 500)

    const rows = (data || []) as MemberRow[]
    const staffIds = rows.map((r) => r.staff_id).filter(Boolean) as string[]
    const staffName = new Map<string, { full_name: string; short_name: string | null }>()
    if (staffIds.length) {
      const { data: staff } = await supabase.from('staff').select('id, full_name, short_name').in('id', staffIds)
      for (const s of staff || []) staffName.set(String(s.id), { full_name: String((s as any).full_name || ''), short_name: (s as any).short_name || null })
    }

    return json({ items: rows.map((r) => mapMember(r, staffName)) })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'organization-members.GET', message: error?.message || 'members error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}

// POST { action } — inviteMember / removeMember / setRole
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const body = (await request.json().catch(() => null)) as any
    const action = String(body?.action || '').trim()
    const orgId = String(body?.organizationId || '').trim()
    if (!orgId) return json({ error: 'organizationId обязателен' }, 400)

    if (action === 'inviteMember') {
      const email = String(body?.email || '').trim().toLowerCase()
      const fullName = String(body?.fullName || '').trim()
      const role = String(body?.role || 'manager').trim()
      if (!email || !email.includes('@')) return json({ error: 'Укажите корректный email' }, 400)
      if (!ROLES.has(role)) return json({ error: 'Недопустимая роль' }, 400)

      // Уже участник?
      const { data: existing } = await supabase
        .from('organization_members')
        .select('id')
        .eq('organization_id', orgId)
        .eq('email', email)
        .maybeSingle()
      if (existing) return json({ error: 'Этот email уже участник организации' }, 409)

      // Best-effort: пригласить через Supabase Auth (создаст пользователя + письмо).
      let userId: string | null = null
      let invited = false
      try {
        const res: any = await (supabase as any).auth.admin.inviteUserByEmail(email)
        if (!res?.error && res?.data?.user?.id) {
          userId = String(res.data.user.id)
          invited = true
        }
      } catch {
        /* почта не настроена — создаём запись без auth-аккаунта */
      }

      const { error: insErr } = await supabase.from('organization_members').insert({
        organization_id: orgId,
        email,
        role,
        status: 'invited',
        user_id: userId,
        metadata: { full_name: fullName },
      })
      if (insErr) return json({ error: insErr.message }, 500)

      return json({
        ok: true,
        message: invited ? `Приглашение отправлено на ${email}.` : `Участник ${email} добавлен (статус: приглашён).`,
      })
    }

    if (action === 'removeMember') {
      const memberId = String(body?.memberId || '').trim()
      if (!memberId) return json({ error: 'memberId обязателен' }, 400)
      const { error } = await supabase.from('organization_members').delete().eq('id', memberId).eq('organization_id', orgId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, message: 'Участник удалён' })
    }

    if (action === 'setRole') {
      const memberId = String(body?.memberId || '').trim()
      const role = String(body?.role || '').trim()
      if (!memberId || !ROLES.has(role)) return json({ error: 'memberId и корректная роль обязательны' }, 400)
      const { error } = await supabase
        .from('organization_members')
        .update({ role, updated_at: new Date().toISOString() })
        .eq('id', memberId)
        .eq('organization_id', orgId)
      if (error) return json({ error: error.message }, 500)
      return json({ ok: true, message: 'Роль обновлена' })
    }

    return json({ error: 'Неизвестное действие' }, 400)
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'organization-members.POST', message: error?.message || 'members error' })
    return json({ error: error?.message || 'Ошибка' }, 500)
  }
}
