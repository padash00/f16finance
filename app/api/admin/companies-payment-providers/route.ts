/**
 * GET — список компаний организации с их payment_provider
 * POST — обновить payment_provider компании
 */

import { NextResponse } from 'next/server'
import { requireCapability } from '@/lib/server/capabilities'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeAuditLog } from '@/lib/server/audit'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  // Список доступных провайдеров
  const { data: providers } = await supabase
    .from('payment_providers')
    .select('id, code, name, country_code, supports_midnight_split')
    .eq('is_active', true)
    .order('country_code', { ascending: true })
    .order('name', { ascending: true })

  // Компании с их payment_provider_id
  let companiesQuery = supabase
    .from('companies')
    .select('id, name, code, payment_provider_id')
    .order('name', { ascending: true })

  if (scope.allowedCompanyIds) {
    companiesQuery = companiesQuery.in('id', scope.allowedCompanyIds)
  }

  const { data: companies, error } = await companiesQuery
  if (error) return json({ error: error.message }, 500)

  return json({
    providers: providers || [],
    companies: companies || [],
  })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  // Только owner / manager / superadmin может менять провайдер
  const canEdit = access.isSuperAdmin || access.staffRole === 'owner' || access.staffRole === 'manager'
  if (!canEdit) return json({ error: 'forbidden' }, 403)

  // Гранулярная проверка права: изменение провайдера = изменение настроек точки
  const denied = await requireCapability(access, 'settings.manage_companies')
  if (denied) return denied

  const user = access.user
  if (!user) return json({ error: 'unauthenticated' }, 401)

  const body = await request.json().catch(() => null) as { companyId?: string; providerId?: string | null } | null
  if (!body?.companyId) return json({ error: 'companyId required' }, 400)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  // Проверка доступа к компании
  if (scope.allowedCompanyIds && !scope.allowedCompanyIds.includes(body.companyId)) {
    return json({ error: 'forbidden' }, 403)
  }

  // Валидация providerId
  if (body.providerId) {
    const { data: provider } = await supabase
      .from('payment_providers')
      .select('id, is_active')
      .eq('id', body.providerId)
      .maybeSingle()
    if (!provider || !provider.is_active) return json({ error: 'invalid provider' }, 400)
  }

  const { error } = await supabase
    .from('companies')
    .update({ payment_provider_id: body.providerId || null })
    .eq('id', body.companyId)

  if (error) return json({ error: error.message }, 500)

  await writeAuditLog(supabase, {
    actorUserId: user.id,
    entityType: 'company',
    entityId: body.companyId,
    action: 'company.payment_provider_changed',
    payload: { providerId: body.providerId },
  })

  return json({ ok: true })
}
