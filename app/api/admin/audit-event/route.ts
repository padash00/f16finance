import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

type Body = {
  entityType?: string
  entityId?: string
  action?: string
  payload?: Record<string, unknown> | null
}

const ALLOWED_ENTITY_TYPES = new Set([
  'income',
  'income-export',
  'expense',
  'expense-export',
  'finance',
  'page-view',
])

export async function POST(req: Request) {
  try {
    const access = await getRequestAccessContext(req)
    if ('response' in access) return access.response

    const body = (await req.json().catch(() => null)) as Body | null
    if (!body?.entityType || !body?.entityId || !body?.action) {
      return NextResponse.json({ error: 'entityType, entityId и action обязательны' }, { status: 400 })
    }

    if (!ALLOWED_ENTITY_TYPES.has(body.entityType)) {
      return NextResponse.json({ error: 'entityType не разрешен' }, { status: 400 })
    }

    const client = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    await writeAuditLog(client, {
      actorUserId: access.user?.id || null,
      entityType: body.entityType,
      entityId: body.entityId,
      action: body.action,
      payload: body.payload || null,
    })

    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Admin audit-event route error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/audit-event',
      message: error?.message || 'Admin audit-event route error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
