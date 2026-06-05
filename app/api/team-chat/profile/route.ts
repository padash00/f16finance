/**
 * Профиль участника чата.
 * GET ?operatorId=X — публичный мини-профиль оператора (имя, фото, телефон, email).
 * GET ?userId=X — публичный мини-профиль staff/owner.
 *
 * Все авторизованные пользователи могут смотреть базовый профиль коллег.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveCompanyScope } from '@/lib/server/organizations'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const url = new URL(request.url)
  const operatorId = url.searchParams.get('operatorId')
  const userId = url.searchParams.get('userId')

  if (!operatorId && !userId) {
    return json({ error: 'operatorId или userId обязателен' }, 400)
  }

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  // Скоуп: можно смотреть профиль только коллег своей организации.
  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  if (operatorId) {
    // Оператор должен быть назначен на компанию своей организации.
    if (scope.allowedCompanyIds) {
      const { data: assign } = await supabase
        .from('operator_company_assignments')
        .select('operator_id')
        .eq('operator_id', operatorId)
        .in('company_id', scope.allowedCompanyIds)
        .limit(1)
      if (!assign || assign.length === 0) return json({ error: 'Оператор не найден' }, 404)
    }
    const { data: op, error: opErr } = await supabase
      .from('operators')
      .select('id, name, short_name, telegram_chat_id, is_active')
      .eq('id', operatorId)
      .maybeSingle()
    if (opErr || !op) return json({ error: 'Оператор не найден' }, 404)

    const { data: profile } = await supabase
      .from('operator_profiles')
      .select('full_name, photo_url, position, phone, email, hire_date, city, about')
      .eq('operator_id', operatorId)
      .maybeSingle()

    return json({
      type: 'operator',
      profile: {
        id: op.id,
        name: op.name,
        shortName: op.short_name,
        position: profile?.position || null,
        photoUrl: profile?.photo_url || null,
        phone: profile?.phone || null,
        email: profile?.email || null,
        city: profile?.city || null,
        about: profile?.about || null,
        hireDate: profile?.hire_date || null,
        telegramChatId: op.telegram_chat_id || null,
      },
    })
  }

  // staff/owner
  if (userId) {
    // Цель должна состоять в той же организации, что и запрашивающий.
    if (!access.isSuperAdmin) {
      const { data: myOrgs } = await supabase
        .from('organization_members')
        .select('organization_id')
        .eq('user_id', access.user?.id || '')
        .eq('status', 'active')
      const myOrgIds = (myOrgs || []).map((r: any) => r.organization_id).filter(Boolean)
      if (myOrgIds.length > 0) {
        const { data: shared } = await supabase
          .from('organization_members')
          .select('organization_id')
          .eq('user_id', userId)
          .eq('status', 'active')
          .in('organization_id', myOrgIds)
          .limit(1)
        if (!shared || shared.length === 0) return json({ error: 'Пользователь не найден' }, 404)
      }
    }
    const { data: staff } = await supabase
      .from('staff')
      .select('id, full_name, role, email, phone')
      .eq('user_id', userId)
      .maybeSingle()
    if (staff) {
      return json({
        type: 'staff',
        profile: {
          id: (staff as any).id,
          name: (staff as any).full_name || null,
          role: (staff as any).role || null,
          email: (staff as any).email || null,
          phone: (staff as any).phone || null,
        },
      })
    }
    return json({ error: 'Пользователь не найден' }, 404)
  }

  return json({ error: 'unknown' }, 400)
}
