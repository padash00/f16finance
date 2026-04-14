import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { broadcastQrAuth } from '@/lib/server/kiosk-broadcast'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) return json({ error: 'not-configured' }, 503)

    const body = await request.json().catch(() => null) as {
      code?: string
      username?: string
      password?: string
    } | null

    const code = String(body?.code || '').trim().toUpperCase()
    const username = String(body?.username || '').trim()
    const password = String(body?.password || '').trim()

    if (!code || !username || !password) return json({ error: 'code, username and password required' }, 400)

    const admin = createAdminSupabaseClient()

    // Найти клиента по телефону или номеру карты
    const { data: customer, error: findErr } = await admin
      .from('customers')
      .select('id, name, phone, kiosk_balance, auth_user_id, card_number')
      .or(`phone.eq.${username},card_number.eq.${username}`)
      .eq('is_active', true)
      .maybeSingle()

    if (findErr) throw findErr
    if (!customer?.auth_user_id) return json({ error: 'Клиент не найден' }, 404)

    // Проверить пароль через Supabase Auth
    const authRes = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '',
        },
        body: JSON.stringify({ email: `${username}@orda.internal`, password }),
      },
    )
    if (!authRes.ok) return json({ error: 'Неверный логин или пароль' }, 401)

    // Создать kiosk_client_token (без station_id — QR логин глобальный)
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    const { error: tokenErr } = await admin.from('kiosk_client_tokens').insert({
      customer_id: customer.id,
      token_hash: sha256(token),
      station_id: null,
      expires_at: expiresAt,
    })
    if (tokenErr) throw tokenErr

    const clientSession = {
      token,
      clientId: customer.id,
      displayName: customer.name || username,
      username,
      avatarUrl: null,
      balance: Number(customer.kiosk_balance || 0),
    }

    // Broadcast в канал QR кода
    await broadcastQrAuth(code, { client: clientSession })

    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'qr-login-failed' }, 500)
  }
}
