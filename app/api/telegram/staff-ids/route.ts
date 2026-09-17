import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { requireAddon } from '@/lib/server/entitlements'
import { requireCapability } from '@/lib/server/capabilities'
import { ensureOrganizationStaffAccess } from '@/lib/server/organizations'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response
  const addonDenied = await requireAddon(access, 'addon.telegram')
  if (addonDenied) return addonDenied
  // Раньше хватало любой авторизации — список с Telegram ID видел и оператор.
  const capDenied = await requireCapability(access, 'telegram.view')
  if (capDenied) return capDenied

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
  const addonDenied = await requireAddon(access, 'addon.telegram')
  if (addonDenied) return addonDenied
  // Бот узнаёт руководителя по telegram_chat_id в staff. Без этой проверки любой
  // пользователь организации записывал свой Telegram в строку владельца — и бот
  // считал его владельцем (копилот, одобрение расходов, авансы).
  const capDenied = await requireCapability(access, 'telegram.edit_staff_telegram')
  if (capDenied) return capDenied

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

  const chatIdValue = String(telegram_chat_id ?? '').trim()
  if (chatIdValue && !/^-?\d+$/.test(chatIdValue)) {
    return NextResponse.json({ error: 'Telegram ID должен быть числом' }, { status: 400 })
  }

  const supabase = createAdminSupabaseClient()
  // Telegram владельца меняет только сам владелец или суперадмин
  const { data: target } = await supabase.from('staff').select('role').eq('id', id).maybeSingle()
  if ((target as { role?: string } | null)?.role === 'owner' && !access.isSuperAdmin && access.staffRole !== 'owner') {
    return NextResponse.json({ error: 'Telegram владельца может изменить только владелец' }, { status: 403 })
  }
  const { error } = await supabase
    .from('staff')
    .update({ telegram_chat_id: chatIdValue || null })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
