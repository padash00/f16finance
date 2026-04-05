import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body = {
  method?: 'email' | 'operator'
  target?: 'staff' | 'operator'
  status?: 'success' | 'failed'
  identifier?: string | null
  reason?: string | null
}

export async function POST(req: Request) {
  try {
    if (!hasAdminSupabaseCredentials()) {
      return NextResponse.json({ ok: false, skipped: true })
    }

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.method || !body?.target || !body?.status) {
      return NextResponse.json({ error: 'method, target и status обязательны' }, { status: 400 })
    }

    const identifier = body.identifier?.trim() || 'unknown'
    const client = createAdminSupabaseClient()

    await writeAuditLog(client, {
      actorUserId: null,
      entityType: 'auth-attempt',
      entityId: identifier,
      action: `${body.target}-${body.status}`,
      payload: {
        method: body.method,
        target: body.target,
        status: body.status,
        identifier,
        reason: body.reason || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Login attempt route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/login-attempt',
      message: error?.message || 'Login attempt route error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
