import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requirePointDevice } from '@/lib/server/point-devices'
import { checkRateLimit } from '@/lib/server/rate-limit'
import { receiptEmailErrorText, requestSaleReceiptEmail } from '@/lib/server/sale-receipt-email'

// Касса (Orda Point) отправляет чек продажи на почту покупателя.
// Авторизация — токен устройства; чек должен принадлежать одной из компаний
// устройства, иначе отвечаем «не найден».

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const point = await requirePointDevice(request)
  if ('response' in point) return point.response
  const { supabase, device } = point

  // Касса — не почтовый сервер: 30 писем в минуту с одного устройства хватает
  // с запасом, а при утечке токена спам не разгонится.
  const rl = checkRateLimit(`sale-receipt-email:point:${device.id}`, 30, 60_000)
  if (!rl.allowed) return json({ error: 'too-many-requests', message: 'Слишком много отправок, подождите минуту.' }, 429)

  let body: { saleId?: unknown; email?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid-json' }, 400)
  }

  try {
    const result = await requestSaleReceiptEmail(supabase, {
      saleId: String(body.saleId || ''),
      email: body.email,
      allowedCompanyIds: device.company_ids || [],
      requestedBy: `point:${device.id}`,
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
      area: 'api/point/sale-receipt-email',
      message: error?.message || 'sale receipt email failed',
    })
    return json({ error: 'server-error', message: 'Не удалось отправить чек.' }, 500)
  }
}
