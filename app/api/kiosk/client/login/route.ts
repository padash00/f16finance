import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sanitizeOrFilterValue } from '@/lib/server/postgrest-filter'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'
import { resolveStation, generateToken, sha256 } from '../../_lib/auth'

export async function POST(req: NextRequest) {
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'service-unavailable' }, { status: 503 })
  }

  const result = await resolveStation(req)
  if ('error' in result) {
    return NextResponse.json({ error: result.error }, { status: result.status })
  }

  const { station } = result
  const admin = createAdminSupabaseClient()

  const body = await req.json().catch(() => null)
  const username = String(body?.username || '').trim().toLowerCase()
  const password = String(body?.password || '').trim()

  if (!username || !password) {
    return NextResponse.json({ error: 'username-and-password-required' }, { status: 400 })
  }

  // Защита от перебора пароля (по IP и по логину).
  const ip = getClientIp(req)
  const ipLimit = checkRateLimit(`client-login:ip:${ip}`, 15, 60_000)
  const userLimit = checkRateLimit(`client-login:user:${username}`, 8, 60_000)
  if (!ipLimit.allowed || !userLimit.allowed) {
    return NextResponse.json(
      { error: 'too-many-requests', message: 'Слишком много попыток входа. Подождите минуту.' },
      { status: 429 },
    )
  }

  // Ищем пользователя в Supabase Auth по email (username = email или phone)
  // Сначала пробуем найти customer по phone или card_number совпадающим с username
  const { data: customers, error: searchErr } = await admin
    .from('customers')
    .select('id, name, phone, kiosk_balance, auth_user_id')
    .eq('is_active', true)
    .or(`phone.eq.${sanitizeOrFilterValue(username)},card_number.eq.${sanitizeOrFilterValue(username)}`)
    .limit(1)

  if (searchErr) {
    return NextResponse.json({ error: searchErr.message }, { status: 500 })
  }

  // Если нашли клиента с auth_user_id — авторизуемся через Supabase Auth
  const customer = customers?.[0]
  if (!customer) {
    return NextResponse.json({ error: 'invalid-credentials' }, { status: 401 })
  }

  if (!customer.auth_user_id) {
    return NextResponse.json({ error: 'client-has-no-login' }, { status: 403 })
  }

  // Верифицируем пароль через Supabase Auth signInWithPassword
  const { createClient } = await import('@supabase/supabase-js')
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

  // Получаем email auth пользователя
  const { data: authUser, error: authUserErr } = await admin.auth.admin.getUserById(customer.auth_user_id)
  if (authUserErr || !authUser?.user?.email) {
    return NextResponse.json({ error: 'invalid-credentials' }, { status: 401 })
  }

  const clientSupa = createClient(supabaseUrl, supabaseAnonKey)
  const { error: signInErr } = await clientSupa.auth.signInWithPassword({
    email: authUser.user.email,
    password,
  })

  if (signInErr) {
    return NextResponse.json({ error: 'invalid-credentials' }, { status: 401 })
  }

  // Создаём kiosk_client_token
  const rawToken = generateToken()
  const { error: tokenErr } = await admin.from('kiosk_client_tokens').insert({
    customer_id: customer.id,
    token_hash: sha256(rawToken),
    station_id: station.id,
    expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString(),
  })

  if (tokenErr) {
    return NextResponse.json({ error: tokenErr.message }, { status: 500 })
  }

  return NextResponse.json({
    token: rawToken,
    client: {
      token: rawToken,
      clientId: customer.id,
      displayName: customer.name,
      username: customer.phone ?? username,
      avatarUrl: null,
      balance: Number(customer.kiosk_balance),
    },
  })
}
