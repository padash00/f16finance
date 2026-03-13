import { NextResponse } from 'next/server'

import { writeSystemErrorLog } from '@/lib/server/audit'
import { createRequestSupabaseClient } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body = {
  area?: string
  message?: string
  pathname?: string
  source?: string
  stack?: string
  userAgent?: string
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.message) {
      return NextResponse.json({ error: 'message обязателен' }, { status: 400 })
    }

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const client = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : requestClient
    await writeSystemErrorLog(client, {
      actorUserId: user?.id || null,
      scope: 'client',
      area: body.area || body.pathname || 'unknown-client-area',
      message: body.message,
      payload: {
        pathname: body.pathname || null,
        source: body.source || null,
        stack: body.stack || null,
        user_agent: body.userAgent || null,
      },
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Client log route error', error)
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
