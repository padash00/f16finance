import { NextResponse } from 'next/server'
import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireAdminRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

export async function POST(request: Request) {
  try {
    const guard = await requireAdminRequest(request)
    if (guard) return guard

    const body = await request.json().catch(() => null)
    const { operatorId, username } = body ?? {}

    if (!operatorId || typeof operatorId !== 'string' || !username || typeof username !== 'string') {
      return NextResponse.json({ error: 'operatorId и username обязательны' }, { status: 400 })
    }

    const trimmed = username.trim().toLowerCase()
    if (trimmed.length < 2) {
      return NextResponse.json({ error: 'Логин должен быть не менее 2 символов' }, { status: 400 })
    }

    const supabaseAdmin = createAdminSupabaseClient()

    // Check uniqueness
    const { data: existing } = await supabaseAdmin
      .from('operator_auth')
      .select('operator_id')
      .eq('username', trimmed)
      .neq('operator_id', operatorId)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'Такой логин уже занят другим оператором' }, { status: 409 })
    }

    const { error } = await supabaseAdmin
      .from('operator_auth')
      .update({ username: trimmed })
      .eq('operator_id', operatorId)

    if (error) throw error

    await writeAuditLog(supabaseAdmin, {
      actorUserId: null,
      entityType: 'operator-auth',
      entityId: operatorId,
      action: 'update-username',
      payload: { new_username: trimmed },
    })

    return NextResponse.json({ ok: true, username: trimmed })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/update-operator-login',
      message: error?.message || 'Server error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
