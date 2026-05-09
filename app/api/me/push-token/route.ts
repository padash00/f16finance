/**
 * Регистрация APNs/FCM токена устройства.
 * iOS PushDeviceRegistrar шлёт сюда после получения токена от системы.
 *
 * POST { deviceToken, platform?, appVersion?, deviceName? }
 * DELETE { deviceToken } — отписка (выход из аккаунта)
 */

import { NextResponse } from 'next/server'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as {
    deviceToken?: string
    platform?: string
    appVersion?: string
    deviceName?: string
  } | null

  const token = String(body?.deviceToken || '').trim()
  if (!token || token.length < 32) {
    return json({ error: 'deviceToken обязателен' }, 400)
  }

  const userId = access.user?.id
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase

  const operatorId = access.operatorAuth ? String(access.operatorAuth.operator_id) : null
  const platform = (body?.platform || 'ios').toLowerCase()

  const { error } = await supabase.from('push_devices').upsert(
    {
      user_id: userId,
      operator_id: operatorId,
      device_token: token,
      platform,
      app_version: body?.appVersion || null,
      device_name: body?.deviceName || null,
      is_active: true,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,device_token' },
  )

  if (error) return json({ error: error.message }, 500)
  return json({ ok: true })
}

export async function DELETE(request: Request) {
  const access = await getRequestAccessContext(request, { allowCustomer: true })
  if ('response' in access) return access.response

  const body = (await request.json().catch(() => null)) as { deviceToken?: string } | null
  const token = String(body?.deviceToken || '').trim()
  if (!token) return json({ error: 'deviceToken обязателен' }, 400)

  const userId = access.user?.id
  if (!userId) return json({ error: 'unauthorized' }, 401)

  const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
  await supabase
    .from('push_devices')
    .update({ is_active: false })
    .eq('user_id', userId)
    .eq('device_token', token)

  return json({ ok: true })
}
