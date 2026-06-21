import { NextResponse } from 'next/server'

import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'

export const dynamic = 'force-dynamic'

// Регистрация Expo push-токена устройства (мобилка зовёт после входа).
export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const body = (await request.json().catch(() => null)) as { token?: string; platform?: string } | null
    const token = String(body?.token || '').trim()
    if (!token.startsWith('ExponentPushToken') && !token.startsWith('ExpoPushToken')) {
      return NextResponse.json({ error: 'bad-token' }, { status: 400 })
    }

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const { error } = await supabase.from('mobile_push_tokens').upsert(
      {
        token,
        user_id: access.user?.id || null,
        operator_id: access.operatorAuth?.operator_id || null,
        organization_id: access.activeOrganization?.id || null,
        platform: String(body?.platform || '').slice(0, 16),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'token' },
    )
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    await writeSystemErrorLogSafe({ scope: 'server', area: 'api/mobile/register-push', message: error?.message || 'register-push' })
    return NextResponse.json({ error: error?.message || 'Ошибка' }, { status: 500 })
  }
}
