import { NextResponse } from 'next/server'
import { createHash, randomBytes } from 'node:crypto'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { broadcastQrAuth } from '@/lib/server/kiosk-broadcast'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

async function findCustomerByLogin(admin: any, username: string, companyId: string | null) {
  const select = 'id, name, phone, kiosk_balance, auth_user_id, card_number'

  // Изоляция: ищем клиента только в компании станции, иначе клиент компании A
  // мог бы войти по QR на станции компании B (PII + баланс).
  let byPhoneQ = admin.from('customers').select(select).eq('phone', username).eq('is_active', true).limit(1)
  if (companyId) byPhoneQ = byPhoneQ.eq('company_id', companyId)
  const { data: byPhone, error: phoneErr } = await byPhoneQ.maybeSingle()

  if (phoneErr) throw phoneErr
  if (byPhone) return byPhone

  let byCardQ = admin.from('customers').select(select).eq('card_number', username).eq('is_active', true).limit(1)
  if (companyId) byCardQ = byCardQ.eq('company_id', companyId)
  const { data: byCard, error: cardErr } = await byCardQ.maybeSingle()

  if (cardErr) throw cardErr
  return byCard
}

export async function POST(request: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) return json({ error: 'not-configured' }, 503)

    const body = await request.json().catch(() => null) as {
      code?: string
      stationId?: string
      username?: string
      password?: string
    } | null

    const code = String(body?.code || '').trim().toUpperCase()
    const stationId = String(body?.stationId || '').trim()
    const username = String(body?.username || '').trim().toLowerCase()
    const password = String(body?.password || '').trim()

    if (!code || !stationId || !username || !password) {
      return json({ error: 'code, stationId, username and password required' }, 400)
    }
    if (!isUuid(stationId)) return json({ error: 'station-invalid' }, 400)

    const ip = getClientIp(request)
    const ipLimit = checkRateLimit(`kiosk-qr-login:ip:${ip}`, 20, 60_000)
    const userLimit = checkRateLimit(`kiosk-qr-login:user:${username}`, 10, 60_000)
    if (!ipLimit.allowed || !userLimit.allowed) {
      return json({ error: 'too-many-requests' }, 429)
    }

    const admin = createAdminSupabaseClient()

    const { data: station, error: stationErr } = await admin
      .from('arena_stations')
      .select('id, company_id')
      .eq('id', stationId)
      .maybeSingle()

    if (stationErr) throw stationErr
    if (!station) return json({ error: 'station-not-found' }, 404)

    const customer = await findCustomerByLogin(admin, username, (station as any).company_id || null)
    if (!customer?.auth_user_id) return json({ error: 'Клиент не найден' }, 404)

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!supabaseUrl || !supabaseAnonKey) return json({ error: 'auth-not-configured' }, 503)

    const { data: authUser, error: authUserErr } = await admin.auth.admin.getUserById(customer.auth_user_id)
    if (authUserErr || !authUser?.user?.email) {
      return json({ error: 'Неверный логин или пароль' }, 401)
    }

    const { createClient } = await import('@supabase/supabase-js')
    const clientSupa = createClient(supabaseUrl, supabaseAnonKey)
    const { error: signInErr } = await clientSupa.auth.signInWithPassword({
      email: authUser.user.email,
      password,
    })

    if (signInErr) return json({ error: 'Неверный логин или пароль' }, 401)

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString()
    const { error: tokenErr } = await admin.from('kiosk_client_tokens').insert({
      customer_id: customer.id,
      token_hash: sha256(token),
      station_id: station.id,
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
    await broadcastQrAuth(code, { stationId: station.id, client: clientSession })

    return json({ ok: true })
  } catch (error: any) {
    return json({ error: error?.message || 'qr-login-failed' }, 500)
  }
}
