import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

import { normalizeOperatorUsername, toOperatorAuthEmail } from '@/lib/core/auth'
import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requiredEnv } from '@/lib/server/env'
import { resolvePointOperatorLoginForDevice } from '@/lib/server/point-operator-login'
import { requirePointDevice } from '@/lib/server/point-devices'
import { checkRateLimit, getClientIp } from '@/lib/server/rate-limit'

type LoginBody = {
  username?: string
  password?: string
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  try {
    // Rate limit: 20 login attempts per IP per minute
    const ip = getClientIp(request)
    const rl = checkRateLimit(`point-login:${ip}`, 20, 60_000)
    if (!rl.allowed) {
      return json({ error: 'too-many-requests' }, 429)
    }

    const point = await requirePointDevice(request)
    if ('response' in point) return point.response

    const { supabase, device } = point
    const body = (await request.json().catch(() => null)) as LoginBody | null
    const username = normalizeOperatorUsername(body?.username || '')
    const password = (body?.password || '').trim()

    if (!username) return json({ error: 'username-required' }, 400)
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

    const { data: authData, error: signInError } = await authClient.auth.signInWithPassword({
      email: toOperatorAuthEmail(username),
      password,
    })

    if (signInError || !authData.user) {
      return json({ error: 'invalid-credentials' }, 401)
    }

    const resolved = await resolvePointOperatorLoginForDevice({
      supabase,
      device,
      authUserId: authData.user.id,
      audit: { method: 'password', enteredUsername: username },
    })

    await authClient.auth.signOut().catch(() => null)

    if (!resolved.ok) {
      return json({ error: resolved.error }, resolved.status)
    }

    return json(resolved.body)
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'point-login',
      message: error?.message || 'Point login error',
    })
    return json({ error: error?.message || 'Не удалось выполнить вход в программу точки' }, 500)
  }
}
