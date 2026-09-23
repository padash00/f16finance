import 'server-only'

import {
  MAX_ATTEMPTS,
  nextRetryDelayMs,
  normalizeEmail,
  renderSaleReceiptEmail,
  sellerName,
} from '@/lib/domain/sale-receipt-email'
import { isMailerConfigured, sendSystemEmail } from '@/lib/server/mailer'
import { computeSaleReceipt } from '@/lib/server/sale-receipt'

/**
 * Отправка чека продажи на почту.
 *
 * Роут кладёт строку в sale_receipt_emails и сразу пытается отправить.
 * Не получилось — строка остаётся в очереди, крон добирает её с паузами
 * (см. nextRetryDelayMs). Продажу отправка не трогает никогда.
 */

export type RequestResult =
  | { ok: true; status: 'sent' | 'queued'; id: string; email: string }
  | { ok: false; error: 'invalid-email' | 'sale-not-found' | 'mailer-not-configured' | 'too-many-requests' }

type QueueRow = {
  id: string
  sale_id: string
  email: string
  attempts: number
}

/** Одинаковую пару чек+адрес за это время не шлём второй раз — это двойной клик. */
const DUPLICATE_WINDOW_MS = 2 * 60_000
/** Больше стольких писем по одному чеку за сутки не отправляем — защита от спама с кассы. */
const MAX_EMAILS_PER_SALE_PER_DAY = 5

/**
 * Поставить чек в очередь и попробовать отправить сразу.
 *
 * @param allowedCompanyIds null — без ограничения (только суперадмин);
 *   массив — чек должен принадлежать одной из этих компаний. Пустой массив
 *   означает «ничего нельзя», а не «всё можно».
 */
export async function requestSaleReceiptEmail(
  supabase: any,
  params: {
    saleId: string
    email: unknown
    allowedCompanyIds: string[] | null
    requestedBy: string
  },
): Promise<RequestResult> {
  const email = normalizeEmail(params.email)
  if (!email) return { ok: false, error: 'invalid-email' }

  if (!isMailerConfigured()) return { ok: false, error: 'mailer-not-configured' }

  const saleId = String(params.saleId || '').trim()
  if (!/^[0-9a-f-]{36}$/i.test(saleId)) return { ok: false, error: 'sale-not-found' }

  const { data: sale, error: saleError } = await supabase
    .from('point_sales')
    .select('id, company_id')
    .eq('id', saleId)
    .maybeSingle()
  if (saleError) throw saleError

  // Чужой чек и несуществующий отвечают одинаково — не подсказываем, что он есть.
  if (!sale) return { ok: false, error: 'sale-not-found' }
  const companyId = String((sale as any).company_id || '')
  if (params.allowedCompanyIds !== null && !params.allowedCompanyIds.includes(companyId)) {
    return { ok: false, error: 'sale-not-found' }
  }

  const { data: company } = await supabase
    .from('companies')
    .select('organization_id')
    .eq('id', companyId)
    .maybeSingle()
  const organizationId = (company as any)?.organization_id ? String((company as any).organization_id) : null

  // Двойной клик: та же пара за последние две минуты — возвращаем уже созданную.
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS).toISOString()
  const { data: recent } = await supabase
    .from('sale_receipt_emails')
    .select('id, status')
    .eq('sale_id', saleId)
    .eq('email', email)
    .in('status', ['pending', 'sent'])
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (recent) {
    return { ok: true, status: (recent as any).status === 'sent' ? 'sent' : 'queued', id: String((recent as any).id), email }
  }

  const dayAgo = new Date(Date.now() - 24 * 60 * 60_000).toISOString()
  const { count } = await supabase
    .from('sale_receipt_emails')
    .select('id', { count: 'exact', head: true })
    .eq('sale_id', saleId)
    .gte('created_at', dayAgo)
  if ((count || 0) >= MAX_EMAILS_PER_SALE_PER_DAY) return { ok: false, error: 'too-many-requests' }

  const { data: inserted, error: insertError } = await supabase
    .from('sale_receipt_emails')
    .insert({
      sale_id: saleId,
      company_id: companyId,
      organization_id: organizationId,
      email,
      requested_by: params.requestedBy.slice(0, 120),
    })
    .select('id, sale_id, email, attempts')
    .single()
  if (insertError) throw insertError

  const row = inserted as QueueRow
  const delivered = await deliverQueuedReceipt(supabase, row)
  return { ok: true, status: delivered ? 'sent' : 'queued', id: row.id, email }
}

/**
 * Одна попытка отправки строки очереди. Возвращает true, если письмо ушло.
 * Ошибку SMTP не пробрасывает: записывает её в строку и планирует повтор.
 */
export async function deliverQueuedReceipt(supabase: any, row: QueueRow): Promise<boolean> {
  const attempts = Number(row.attempts || 0) + 1

  try {
    const receipt = await computeSaleReceipt(supabase, row.sale_id)
    if (!receipt) throw new Error('sale-not-found')

    const { subject, text, html } = renderSaleReceiptEmail(receipt)
    await sendSystemEmail({
      to: row.email,
      subject,
      text,
      html,
      fromName: sellerName(receipt),
    })

    await supabase
      .from('sale_receipt_emails')
      .update({ status: 'sent', attempts, sent_at: new Date().toISOString(), last_error: null })
      .eq('id', row.id)
    return true
  } catch (error: any) {
    const message = String(error?.message || error || 'send-failed').slice(0, 500)
    // Чек удалён или адрес отвергнут сервером окончательно (SMTP 550–554:
    // ящика нет, домен не принимает) — повторять бессмысленно. Код 4xx —
    // временная ошибка, её и лечат повторы.
    const code = Number(error?.responseCode || 0)
    const permanent = message === 'sale-not-found' || (code >= 550 && code <= 554)
    const delay = permanent ? null : nextRetryDelayMs(attempts)

    await supabase
      .from('sale_receipt_emails')
      .update(
        delay === null
          ? { status: 'failed', attempts, last_error: message }
          : { attempts, last_error: message, next_attempt_at: new Date(Date.now() + delay).toISOString() },
      )
      .eq('id', row.id)
    return false
  }
}

/** Крон: добрать всё, что пора отправлять. */
export async function processSaleReceiptEmailQueue(supabase: any, limit = 50) {
  const { data: rows, error } = await supabase
    .from('sale_receipt_emails')
    .select('id, sale_id, email, attempts')
    .eq('status', 'pending')
    .lte('next_attempt_at', new Date().toISOString())
    .lt('attempts', MAX_ATTEMPTS)
    .order('next_attempt_at', { ascending: true })
    .limit(limit)
  if (error) throw error

  let sent = 0
  let retried = 0
  for (const row of (rows || []) as QueueRow[]) {
    if (await deliverQueuedReceipt(supabase, row)) sent++
    else retried++
  }
  return { scanned: (rows || []).length, sent, retried }
}

/** Человеческий текст ошибки для интерфейса кассы и портала. */
export function receiptEmailErrorText(error: string): string {
  switch (error) {
    case 'invalid-email':
      return 'Проверьте адрес почты — похоже, в нём опечатка.'
    case 'sale-not-found':
      return 'Чек не найден.'
    case 'mailer-not-configured':
      return 'Почта для отправки чеков не настроена. Обратитесь к администратору.'
    case 'too-many-requests':
      return 'Этот чек уже отправляли много раз за сутки.'
    default:
      return 'Не удалось отправить чек.'
  }
}
