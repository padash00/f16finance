import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { computeBusinessIntelligence } from '@/lib/server/business-intelligence'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function canView(access: { isSuperAdmin: boolean; staffRole: string }) {
  return access.isSuperAdmin || !!access.staffRole
}

export async function GET(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response
    if (!canView(access)) return json({ error: 'forbidden' }, 403)

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const url = new URL(request.url)
    const companyId = String(url.searchParams.get('company_id') || '').trim() || null
    if (companyId && companyScope.allowedCompanyIds && !companyScope.allowedCompanyIds.includes(companyId)) {
      return json({ error: 'forbidden' }, 403)
    }
    const days = Number(url.searchParams.get('days')) || null
    // Произвольный период (мягкая валидация формата YYYY-MM-DD; движок проверит сам).
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
    const fromRaw = String(url.searchParams.get('from') || '').trim()
    const toRaw = String(url.searchParams.get('to') || '').trim()
    const from = DATE_RE.test(fromRaw) ? fromRaw : null
    const to = DATE_RE.test(toRaw) ? toRaw : null

    const data = await computeBusinessIntelligence(supabase, {
      organizationId: access.activeOrganization?.id || null,
      allowedCompanyIds: companyScope.allowedCompanyIds,
      isSuperAdmin: access.isSuperAdmin,
      companyId,
      days,
      from,
      to,
    })

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/business-intelligence.GET',
      message: error?.message || 'business-intelligence GET error',
    })
    return json({ ok: false, error: error?.message || 'Ошибка' }, 500)
  }
}
