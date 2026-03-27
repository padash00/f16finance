import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { isAdminEmail } from '@/lib/server/admin'
import { createAdminToken } from '@/lib/server/admin-tokens'
import { requiredEnv } from '@/lib/server/env'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

type Body = {
  email?: string
  password?: string
}

export async function POST(request: Request) {
  try {
    // Rate limit: 10 admin login attempts per IP per minute
    const ip = getClientIp(request)
    const rl = checkRateLimit(`admin-login:${ip}`, 10, 60_000)
    if (!rl.allowed) {
      return json({ error: 'too-many-requests' }, 429)
    }

    const body = (await request.json().catch(() => null)) as Body | null
    const email = String(body?.email || '').trim().toLowerCase()
    const password = String(body?.password || '').trim()

    if (!email) return json({ error: 'email-required' }, 400)
    if (!password) return json({ error: 'password-required' }, 400)

    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || requiredEnv('SUPABASE_URL'),
      requiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      },
    )

    const { data, error } = await authClient.auth.signInWithPassword({
      email,
      password,
    })

    if (error || !data.user) {
      return json({ error: 'invalid-credentials' }, 401)
    }

    if (!isAdminEmail(data.user.email)) {
      await authClient.auth.signOut().catch(() => null)
      return json({ error: 'super-admin-only' }, 403)
    }

    await authClient.auth.signOut().catch(() => null)

    const token = createAdminToken(email)

    return json({
      ok: true,
      token,
      admin: {
        email,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-admin-login',
      message: error?.message || 'Point admin login error',
    })
    return json({ error: error?.message || 'Не удалось выполнить вход super-admin' }, 500)
  }
}
