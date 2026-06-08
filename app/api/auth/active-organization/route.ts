import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { ACTIVE_ORGANIZATION_COOKIE } from '@/lib/server/organizations'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// «Войти в организацию»: ставит cookie активной организации.
// Суперадмин — любая организация; остальные — только свои (из access.organizations).

export const dynamic = 'force-dynamic'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req, { allowCustomer: true })
    if ('response' in access) return access.response

    const body = (await req.json().catch(() => null)) as { organizationId?: string } | null
    const organizationId = String(body?.organizationId || '').trim()
    if (!organizationId) return json({ error: 'organizationId обязателен' }, 400)

    const own = (access.organizations || []).find((o: any) => String(o.id) === organizationId) || null
    if (!access.isSuperAdmin && !own) return json({ error: 'forbidden' }, 403)

    let org: { id: string; name: string; slug: string } | null = own
      ? { id: String(own.id), name: String((own as any).name || ''), slug: String((own as any).slug || '') }
      : null

    if (!org && access.isSuperAdmin && hasAdminSupabaseCredentials()) {
      const supabase = createAdminSupabaseClient()
      const { data } = await supabase
        .from('organizations')
        .select('id, name, slug')
        .eq('id', organizationId)
        .maybeSingle()
      if (data) org = { id: String((data as any).id), name: String((data as any).name || ''), slug: String((data as any).slug || '') }
    }

    if (!org) return json({ error: 'Организация не найдена' }, 404)

    const res = NextResponse.json({ ok: true, activeOrganization: org })
    res.cookies.set({
      name: ACTIVE_ORGANIZATION_COOKIE,
      value: org.id,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    })
    return res
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/auth/active-organization POST', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
