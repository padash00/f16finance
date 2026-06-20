import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

export const dynamic = 'force-dynamic'

// Диагностика валидации Bearer-токена ТРЕМЯ способами, чтобы понять, где ломается:
//  raw   — прямой GET {url}/auth/v1/user (apikey=anon + Bearer) — как валидирует GoTrue;
//  anon  — клиент на anon-ключе + Bearer-заголовок + getUser();
//  admin — клиент на service_role + getUser(token) (текущий серверный путь).
// Отдаём только данные владельца токена + статусы, без секретов. Можно удалить позже.
export async function GET(request: Request) {
  const raw = request.headers.get('authorization') || ''
  const token = (raw.match(/^Bearer\s+(.+)$/i)?.[1] || '').trim()
  const out: Record<string, unknown> = { hasToken: !!token, hasAdminCreds: hasAdminSupabaseCredentials() }
  if (!token) return NextResponse.json(out)

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

  let rawPart = 'raw —'
  try {
    const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${token}` } })
    const body: any = await r.json().catch(() => null)
    rawPart = `raw ${r.status} ${body?.id ? 'OK ' + (body?.email || '') : (body?.msg || body?.error_description || body?.error || 'no-user')}`
  } catch (e: any) {
    rawPart = `raw ERR ${e?.message || 'ex'}`
  }

  let anonPart = 'anon —'
  try {
    const c = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false } })
    const { data, error } = await c.auth.getUser()
    anonPart = `anon ${data?.user?.id ? 'OK ' + (data.user.email || '') : (error?.message || 'null')}`
  } catch (e: any) {
    anonPart = `anon ERR ${e?.message || 'ex'}`
  }

  let adminPart = 'admin —'
  try {
    if (hasAdminSupabaseCredentials()) {
      const { data, error } = await createAdminSupabaseClient().auth.getUser(token)
      adminPart = `admin ${data?.user?.id ? 'OK ' + (data.user.email || '') : (error?.message || 'null')}`
    } else {
      adminPart = 'admin нет-ключа'
    }
  } catch (e: any) {
    adminPart = `admin ERR ${e?.message || 'ex'}`
  }

  out.verdict = `${rawPart} · ${anonPart} · ${adminPart}`
  return NextResponse.json(out)
}
