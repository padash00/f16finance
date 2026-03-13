import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { createRequestSupabaseClient, requireStaffCapabilityRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'

type MutationBody =
  | {
      action: 'createAdjustment'
      payload: {
        operator_id: string
        date: string
        amount: number
        kind: 'debt' | 'fine' | 'bonus' | 'advance'
        comment?: string | null
      }
    }
  | {
      action: 'updateOperatorChatId'
      operatorId: string
      telegram_chat_id: string | null
    }

export async function POST(req: Request) {
  try {
    const guard = await requireStaffCapabilityRequest(req, 'salary')
    if (guard) return guard

    const requestClient = createRequestSupabaseClient(req)
    const {
      data: { user },
    } = await requestClient.auth.getUser()

    const body = (await req.json().catch(() => null)) as MutationBody | null
    if (!body?.action) {
      return NextResponse.json({ error: 'Неверный формат запроса' }, { status: 400 })
    }

    const supabase = createAdminSupabaseClient()

    if (body.action === 'createAdjustment') {
      if (!body.payload.operator_id || !body.payload.date || !Number.isFinite(body.payload.amount)) {
        return NextResponse.json({ error: 'Недостаточно данных для корректировки' }, { status: 400 })
      }

      const { data, error } = await supabase
        .from('operator_salary_adjustments')
        .insert([
          {
            operator_id: body.payload.operator_id,
            date: body.payload.date,
            amount: Math.round(body.payload.amount),
            kind: body.payload.kind,
            comment: body.payload.comment?.trim() || null,
          },
        ])
        .select('id,operator_id,date,amount,kind,comment')
        .single()

      if (error) throw error
      await writeAuditLog(supabase, {
        actorUserId: user?.id || null,
        entityType: 'operator-salary-adjustment',
        entityId: String(data.id),
        action: 'create',
        payload: data,
      })
      return NextResponse.json({ ok: true, data })
    }

    if (!body.operatorId) {
      return NextResponse.json({ error: 'operatorId обязателен' }, { status: 400 })
    }

    const chatId = body.telegram_chat_id?.trim() || null
    const { data, error } = await supabase
      .from('operators')
      .update({ telegram_chat_id: chatId })
      .eq('id', body.operatorId)
      .select('id,name,short_name,is_active,telegram_chat_id')
      .single()

    if (error) throw error
    await writeAuditLog(supabase, {
      actorUserId: user?.id || null,
      entityType: 'operator',
      entityId: String(data.id),
      action: 'update-telegram-chat-id',
      payload: {
        name: data.name,
        short_name: data.short_name,
        telegram_chat_id: data.telegram_chat_id,
      },
    })
    return NextResponse.json({ ok: true, data })
  } catch (error: any) {
    console.error('Admin salary mutation error', error)
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/salary',
      message: error?.message || 'Admin salary mutation error',
    })
    return NextResponse.json({ error: error?.message || 'Ошибка сервера' }, { status: 500 })
  }
}
