/**
 * GET — возвращает payment_provider для текущего пользователя:
 *  — Если в access есть active org → берём провайдер most-common среди компаний org
 *  — Фолбэк: первый провайдер (kaspi)
 *
 * Используется хуком useCashlessLabels в админке.
 * Cache на стороне клиента — провайдер меняется редко.
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  const scope = await resolveCompanyScope({
    activeOrganizationId: access.activeOrganization?.id || null,
    isSuperAdmin: access.isSuperAdmin,
  })

  // Если super-admin без активной org — отдаём kaspi по умолчанию
  let providerId: string | null = null

  if (scope.allowedCompanyIds && scope.allowedCompanyIds.length > 0) {
    // Самый популярный провайдер среди компаний организации
    const { data } = await supabase
      .from('companies')
      .select('payment_provider_id')
      .in('id', scope.allowedCompanyIds)
    if (data) {
      const counts = new Map<string, number>()
      for (const row of data as any[]) {
        if (row.payment_provider_id) counts.set(row.payment_provider_id, (counts.get(row.payment_provider_id) || 0) + 1)
      }
      let topId: string | null = null
      let topCount = 0
      for (const [id, count] of counts) {
        if (count > topCount) { topId = id; topCount = count }
      }
      providerId = topId
    }
  }

  // Резолвим объект провайдера
  let provider: any = null
  if (providerId) {
    const { data } = await supabase
      .from('payment_providers')
      .select('id, code, name, country_code, supports_midnight_split')
      .eq('id', providerId)
      .maybeSingle()
    provider = data
  }
  if (!provider) {
    const { data } = await supabase
      .from('payment_providers')
      .select('id, code, name, country_code, supports_midnight_split')
      .eq('code', 'kaspi')
      .maybeSingle()
    provider = data
  }

  return NextResponse.json({ provider })
}
