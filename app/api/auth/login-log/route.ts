import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body = {
  method?: 'email' | 'operator'
  target?: 'staff' | 'operator'
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.method || !body?.target) {
      return NextResponse.json({ error: 'method и target обязательны' }, { status: 400 })
    }

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
    }

    const client = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient

    await writeAuditLog(client, {
      actorUserId: user.id,
      entityType: 'auth-session',
      entityId: user.id,
      action: `${body.target}-login`,
      payload: {
        method: body.method,
        target: body.target,
        email: user.email || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Login log route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/login-log',
      message: error?.message || 'Login log route error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
