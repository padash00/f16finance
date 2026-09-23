import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireOperator } from '@/lib/server/operator-context'
import { checkRateLimit } from '@/lib/server/rate-limit'
import { receiptEmailErrorText, requestSaleReceiptEmail } from '@/lib/server/sale-receipt-email'

// Веб-касса оператора со сменой отправляет чек на почту покупателя.
// Оператор авторизуется не сессией сотрудника, а своим контуром
// (requireOperator), поэтому отдельный роут. Чек должен принадлежать одной
// из компаний, к которым оператор привязан.

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const ctx = await requireOperator(request)
  if ('response' in ctx) return ctx.response

  const rl = checkRateLimit(`sale-receipt-email:operator:${ctx.operatorId}`, 30, 60_000)
  if (!rl.allowed) return json({ error: 'too-many-requests', message: 'Слишком много отправок, подождите минуту.' }, 429)

  let body: { saleId?: unknown; email?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid-json' }, 400)
  }

  try {
    const result = await requestSaleReceiptEmail(ctx.supabase, {
      saleId: String(body.saleId || ''),
      email: body.email,
      allowedCompanyIds: ctx.companyIds,
      requestedBy: `operator:${ctx.operatorId}`,
    })

    if (!result.ok) {
      const status = result.error === 'sale-not-found' ? 404 : result.error === 'too-many-requests' ? 429 : result.error === 'mailer-not-configured' ? 503 : 400
      return json({ error: result.error, message: receiptEmailErrorText(result.error) }, status)
    }

    return json({
      ok: true,
      status: result.status,
      email: result.email,
      message: result.status === 'sent' ? `Чек отправлен на ${result.email}` : `Чек будет отправлен на ${result.email} в ближайшие минуты`,
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/operator/receipt-email',
      message: error?.message || 'sale receipt email failed',
    })
    return json({ error: 'server-error', message: 'Не удалось отправить чек.' }, 500)
  }
}
