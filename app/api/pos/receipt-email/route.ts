import { NextResponse } from 'next/server'

import { writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { checkRateLimit } from '@/lib/server/rate-limit'
import { getRequestAccessContext } from '@/lib/server/request-auth'
import { receiptEmailErrorText, requestSaleReceiptEmail } from '@/lib/server/sale-receipt-email'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'

// Веб-касса и история чеков в портале отправляют чек на почту покупателя.
// Права те же, что у веб-кассы: сессия сотрудника и компания чека в его
// скоупе. Чек другой организации отвечает «не найден».

export const runtime = 'nodejs'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

export async function POST(request: Request) {
  const access = await getRequestAccessContext(request)
  if ('response' in access) return access.response

  const rl = checkRateLimit(`sale-receipt-email:staff:${access.user?.id || 'anon'}`, 30, 60_000)
  if (!rl.allowed) return json({ error: 'too-many-requests', message: 'Слишком много отправок, подождите минуту.' }, 429)

  let body: { saleId?: unknown; email?: unknown }
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid-json' }, 400)
  }

  try {
    const companyScope = await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      isSuperAdmin: access.isSuperAdmin,
    })
    // null — только суперадмин; иначе массив. Пустой массив = ничего нельзя.
    const allowedCompanyIds = access.isSuperAdmin ? companyScope.allowedCompanyIds : companyScope.allowedCompanyIds || []

    const supabase = hasAdminSupabaseCredentials() ? createAdminSupabaseClient() : access.supabase
    const result = await requestSaleReceiptEmail(supabase, {
      saleId: String(body.saleId || ''),
      email: body.email,
      allowedCompanyIds,
      requestedBy: `staff:${access.user?.id || 'unknown'}`,
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
      area: 'api/pos/receipt-email',
      message: error?.message || 'sale receipt email failed',
    })
    return json({ error: 'server-error', message: 'Не удалось отправить чек.' }, 500)
  }
}
