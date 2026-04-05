import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireOperatorAuthRow } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { authId?: string } | null
    if (!body?.authId) {
      return NextResponse.json({ error: 'authId обязателен' }, { status: 400 })
    }

    const guard = await requireOperatorAuthRow(req, body.authId)
    if (guard) return guard

    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase
      .from('operator_auth')
      .update({ last_login: new Date().toISOString() })
      .eq('id', body.authId)
      .select('id, operator_id, user_id')
      .single()

    if (error) throw error
    await writeAuditLog(supabase, {
      actorUserId: data?.user_id || null,
      entityType: 'operator-auth',
      entityId: String(data?.id || body.authId),
      action: 'login',
      payload: { operator_id: data?.operator_id || null },
    })
    return NextResponse.json({ ok: true })
  } catch (error: any) {
    console.error('Operator last_login update error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/auth/operator-last-login',
      message: error?.message || 'Operator last_login update error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
