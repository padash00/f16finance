import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    if (!access.isSuperAdmin && access.staffRole !== 'owner') {
      return json({ error: 'forbidden' }, 403)
    }

    const { id } = await ctx.params
    const expenseId = String(id || '').trim()
    if (!expenseId) return json({ error: 'expenseId обязателен' }, 400)

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const { data: existing, error: existingError } = await supabase
      .from('expenses')
      .select('id, status')
      .eq('id', expenseId)
      .single()

    if (existingError || !existing) return json({ error: 'Расход не найден' }, 404)
    if (existing.status !== 'pending_approval') {
      return json({ error: 'Можно одобрить только расход в статусе ожидания' }, 409)
    }

    const { data, error } = await supabase
      .from('expenses')
      .update({
        status: 'approved',
        approved_by: access.user?.id || null,
        approved_at: new Date().toISOString(),
      })
      .eq('id', expenseId)
      .select('*')
      .single()

    if (error) throw error

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'expense',
      entityId: String(expenseId),
      action: 'expense.approve',
      payload: { expense_id: expenseId },
    })

    return json({ ok: true, data })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/[id]/approve',
      message: error?.message || 'approve failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
