import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { resolveStation, resolveClient } from '../../_lib/auth'

export async function POST(req: NextRequest) {
  if (!hasAdminSupabaseCredentials()) {
    return NextResponse.json({ error: 'service-unavailable' }, { status: 503 })
  }

  const stationResult = await resolveStation(req)
  if ('error' in stationResult) {
    return NextResponse.json({ error: stationResult.error }, { status: stationResult.status })
  }

  const clientResult = await resolveClient(req, stationResult.station.id)
  if ('error' in clientResult) {
    return NextResponse.json({ error: clientResult.error }, { status: clientResult.status })
  }

  const { customer } = clientResult
  const admin = createAdminSupabaseClient()
  const body = await req.json().catch(() => ({}))

  const oldPassword = String(body?.oldPassword || '').trim()
  const newPassword = String(body?.newPassword || '').trim()

  if (!oldPassword || !newPassword) {
    return NextResponse.json({ error: 'passwords-required' }, { status: 400 })
  }
  if (newPassword.length < 6) {
    return NextResponse.json({ error: 'password-too-short' }, { status: 400 })
  }

  if (!customer.auth_user_id) {
    return NextResponse.json({ error: 'no-auth-account' }, { status: 403 })
  }

  // Получаем email
  const { data: authUser, error: authErr } = await admin.auth.admin.getUserById(customer.auth_user_id)
  if (authErr || !authUser?.user?.email) {
    return NextResponse.json({ error: 'auth-user-not-found' }, { status: 404 })
  }

  // Проверяем старый пароль
  const { createClient } = await import('@supabase/supabase-js')
  const clientSupa = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  const { error: signInErr } = await clientSupa.auth.signInWithPassword({
    email: authUser.user.email,
    password: oldPassword,
  })
  if (signInErr) {
    return NextResponse.json({ error: 'old-password-incorrect' }, { status: 401 })
  }

  // Меняем пароль
  const { error: updateErr } = await admin.auth.admin.updateUserById(customer.auth_user_id, {
    password: newPassword,
  })
  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
