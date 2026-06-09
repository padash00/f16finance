import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Платформа: аудит действий по организациям/биллингу (только суперадмин).

export const dynamic = 'force-dynamic'

const PLATFORM_ENTITY_TYPES = [
  'organization',
  'invoice',
  'subscription',
  'organization_member',
  'organization_addon',
  'organization_package',
  'feature_grant',
]

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response
    if (!access.isSuperAdmin) return json({ error: 'forbidden' }, 403)
    if (!hasAdminSupabaseCredentials()) return json({ data: [] })

    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from('audit_log')
      .select('id, actor_user_id, entity_type, entity_id, action, payload, created_at')
      .in('entity_type', PLATFORM_ENTITY_TYPES)
      .order('created_at', { ascending: false })
      .limit(150)

    if (error) {
      if (error.code === '42P01') return json({ data: [] })
      throw error
    }

    return json({ data: data || [] })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/admin/platform/audit GET', message: error?.message || 'error' })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
