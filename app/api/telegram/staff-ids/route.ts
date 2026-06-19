import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { ensureOrganizationStaffAccess } from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  // Изоляция: персонал только своей организации (service-role обходит RLS).
  const orgId = access.activeOrganization?.id || null
  if (!access.isSuperAdmin && !orgId) return NextResponse.json({ data: [] })

  const supabase = createAdminSupabaseClient()
  let query = supabase
    .from('staff')
    .select('id, full_name, role, telegram_chat_id, is_active')
    .order('full_name', { ascending: true })
  if (orgId) query = query.eq('organization_id', orgId)
  const { data, error } = await query

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ data: data ?? [] })
}

export async function PATCH(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const body = await request.json().catch(() => ({}))
  const { id, telegram_chat_id } = body
  if (!id) return NextResponse.json({ error: 'id обязателен' }, { status: 400 })

  // Изоляция: нельзя менять сотрудника чужой организации по присланному id.
  try {
    await ensureOrganizationStaffAccess({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
      staffId: id,
    })
  } catch {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  const supabase = createAdminSupabaseClient()
  const { error } = await supabase
    .from('staff')
    .update({ telegram_chat_id: telegram_chat_id?.trim() || null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
