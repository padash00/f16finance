import { NextResponse } from 'next/server'

import { requireOrgFeature } from '@/lib/server/entitlements'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}
function canManage(access: any) {
  if (access.isSuperAdmin) return true
  const role = String(access.staffMember?.role || access.staffRole || '').toLowerCase()
  return role === 'owner' || role === 'manager'
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const gate = await requireOrgFeature(access, 'restaurant.recipes_lite')
    if (gate) return gate
    const orgId = access.activeOrganization?.id || null
    if (!access.isSuperAdmin && !orgId) return json({ ok: true, ingredients: [] })
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data, error } = await supabase
      .from('ingredients')
      .select('id, name, unit, purchase_price, category, is_active')
      .eq('organization_id', orgId || '00000000-0000-0000-0000-000000000000')
      .eq('is_active', true)
      .order('name')
    if (error) throw error
    return json({ ok: true, ingredients: data || [] })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const gate = await requireOrgFeature(access, 'restaurant.recipes_lite')
    if (gate) return gate
    const orgId = access.activeOrganization?.id || null
    if (!orgId) return json({ error: 'Нет активной организации' }, 400)
    const body = (await request.json().catch(() => null)) as any
    const name = String(body?.name || '').trim()
    if (!name) return json({ error: 'Название обязательно' }, 400)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { data, error } = await supabase
      .from('ingredients')
      .insert({
        organization_id: orgId,
        name,
        unit: String(body?.unit || 'г').trim() || 'г',
        purchase_price: Number(body?.purchase_price) || 0,
        category: body?.category?.trim() || null,
      })
      .select('id, name, unit, purchase_price, category, is_active')
      .single()
    if (error) throw error
    return json({ ok: true, ingredient: data })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canManage(access)) return json({ error: 'forbidden' }, 403)
    const orgId = access.activeOrganization?.id || null
    const id = new URL(request.url).searchParams.get('id')
    if (!id) return json({ error: 'id обязателен' }, 400)
    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    let del = supabase.from('ingredients').delete().eq('id', id)
    if (!access.isSuperAdmin && orgId) del = del.eq('organization_id', orgId)
    const { error } = await del
    if (error) throw error
    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
