import { NextResponse } from 'next/server'

import { requireAdminRequest } from '@/lib/server/request-auth'
import { createAdminSupabaseClient } from '@/lib/server/supabase'
import { findOperatorByKey } from '@/lib/server/repositories/salary'
import { buildSalaryTelegramMessage, getOperatorSalarySnapshot } from '@/lib/server/services/salary'
import { sendTelegramMessage } from '@/lib/telegram/send'

type ReqBody = {
  operatorId: string
  weekStart?: string
  dateFrom?: string
  dateTo?: string
  lastItem?: { name: string; qty: number; total: number }
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function GET() {
  return json({
    ok: true,
    hint: 'Use POST with JSON body',
    example: {
      operatorId: 'UUID (operators.id) OR telegram_chat_id digits',
      dateFrom: '2026-01-11',
      dateTo: '2026-01-18',
      weekStart: '2026-01-13 (optional, any date ok -> will be normalized to Monday)',
    },
  })
}

export async function POST(req: Request) {
  try {
    const guard = await requireAdminRequest(req)
    if (guard) return guard

    const body = (await req.json().catch(() => null)) as ReqBody | null
    if (!body?.operatorId?.trim()) return json({ error: 'operatorId обязателен' }, 400)

    const dateFrom = (body.dateFrom || '').trim()
    const dateTo = (body.dateTo || '').trim()
    if (!dateFrom) return json({ error: 'dateFrom обязателен (YYYY-MM-DD)' }, 400)
    if (!dateTo) return json({ error: 'dateTo обязателен (YYYY-MM-DD)' }, 400)

    const supabase = createAdminSupabaseClient()
    const operator = await findOperatorByKey(supabase, body.operatorId.trim())

    if (!operator) {
      return json({ error: `Оператор не найден (${body.operatorId.trim()})` }, 404)
    }

    if (!operator.telegram_chat_id) {
      return json({ error: 'У оператора нет telegram_chat_id' }, 400)
    }

    const snapshot = await getOperatorSalarySnapshot(supabase, {
      operatorId: operator.id,
      dateFrom,
      dateTo,
      weekStart: body.weekStart,
    })

    const text = buildSalaryTelegramMessage({
      operatorName: operator.short_name || operator.name || 'Оператор',
      dateFrom,
      dateTo,
      weekStart: snapshot.weekStart,
      weekEnd: snapshot.weekEnd,
      summary: snapshot,
      lastItem: body.lastItem,
    })

    const result = await sendTelegramMessage(operator.telegram_chat_id, text)
    if (!result.ok) {
      return json({ error: result.error || 'Telegram не принял сообщение' }, 502)
    }

    return json({ ok: true, operator: { id: operator.id, telegram_chat_id: operator.telegram_chat_id } })
  } catch (error: any) {
    console.error(error)
    return json({ error: error?.message || 'Server error' }, 500)
  }
}
