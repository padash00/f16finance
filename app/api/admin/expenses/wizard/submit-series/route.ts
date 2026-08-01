import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { requireCapability } from '@/lib/server/capabilities'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { pushToOrganization } from '@/lib/server/push'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'

// Серия расходов: одна сессия мастера → N записей по периодам.
// Кейс: налог за полгода заплачен одним платежом, но в отчётах должен
// лежать помесячно. Документ, комментарий и подтверждение «задним числом»
// заполняются один раз и применяются ко всем строкам серии.

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₸'
}

const MAX_PERIODS = 24

type WizardPayload = {
  date?: string
  company_id?: string
  operator_id?: string | null
  category_id?: string
  category_name?: string
  amount_cash?: number
  amount_kaspi?: number
  item_name?: string
  comment?: string
  backdated_confirmed?: boolean
  document_kind?: 'receipt' | 'invoice' | 'bill' | 'whitelist' | 'one_off'
  document_url?: string | null
  document_urls?: string[] | null
  whitelist_vendor_id?: string | null
  one_off_payee?: string | null
  one_off_reason?: string | null
}

type SeriesPeriod = {
  date: string
  amount_cash?: number
  amount_kaspi?: number
  label?: string
}

// Валидация карточки — всё то же, что и для одиночного расхода, кроме даты:
// дата у каждого периода своя и проверяется отдельно.
function validateCard(p: WizardPayload): string | null {
  if (!p.company_id) return 'Точка обязательна'
  if (!p.category_id || !p.category_name) return 'Категория обязательна'
  if (!p.item_name || p.item_name.trim().length < 5) {
    return 'Краткое название обязательно (≥ 5 символов)'
  }
  if (!p.comment || p.comment.trim().length < 20) {
    return 'Комментарий обязателен (≥ 20 символов)'
  }

  const kind = p.document_kind
  if (!kind) return 'Выберите тип документа'

  if (kind === 'receipt' || kind === 'invoice' || kind === 'bill') {
    const documentUrls = Array.isArray(p.document_urls) ? p.document_urls.filter(Boolean) : []
    if (documentUrls.length === 0 && !p.document_url) return 'Прикрепите чек/накладную'
  } else if (kind === 'whitelist') {
    if (!p.whitelist_vendor_id) return 'Выберите доверенного поставщика'
  } else if (kind === 'one_off') {
    if (!p.one_off_payee || p.one_off_payee.trim().length < 3) {
      return 'Укажите получателя (≥ 3 символов)'
    }
    if (!p.one_off_reason || p.one_off_reason.trim().length < 30) {
      return 'Опишите причину отсутствия документа (≥ 30 символов)'
    }
  } else {
    return 'Неизвестный тип документа'
  }

  return null
}

function validatePeriods(periods: SeriesPeriod[], backdatedConfirmed: boolean): string | null {
  if (!Array.isArray(periods) || periods.length === 0) return 'Список периодов пуст'
  if (periods.length < 2) return 'В серии должно быть минимум 2 периода'
  if (periods.length > MAX_PERIODS) return `Слишком много периодов (максимум ${MAX_PERIODS})`

  const seenDates = new Set<string>()
  let hasBackdated = false

  for (const period of periods) {
    const date = String(period?.date || '').trim()
    if (!date) return 'У периода не указана дата'
    const dateMs = new Date(date).getTime()
    if (Number.isNaN(dateMs)) return `Некорректная дата периода: ${date}`
    if (dateMs > Date.now() + 24 * 60 * 60 * 1000) {
      return `Дата периода не может быть в будущем: ${date}`
    }
    if (seenDates.has(date)) return `Одна и та же дата в серии дважды: ${date}`
    seenDates.add(date)
    if (dateMs < Date.now() - 7 * 24 * 60 * 60 * 1000) hasBackdated = true

    const cash = Number(period?.amount_cash || 0)
    const kaspi = Number(period?.amount_kaspi || 0)
    if (!Number.isFinite(cash) || !Number.isFinite(kaspi)) return `Некорректная сумма периода ${date}`
    if (cash < 0 || kaspi < 0) return `Сумма периода ${date} не может быть отрицательной`
    if (cash + kaspi <= 0) return `Сумма периода ${date} должна быть больше 0`
  }

  if (hasBackdated && !backdatedConfirmed) {
    return 'Подтвердите, что это действительно старые расходы'
  }

  return null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const role = access.staffRole
    if (!access.isSuperAdmin && !role) {
      return json({ error: 'forbidden' }, 403)
    }
    const denied = await requireCapability(access, 'expenses.create')
    if (denied) return denied

    const body = await request.json().catch(() => null) as {
      session_id?: string
      periods?: SeriesPeriod[]
      period_kind?: 'month' | 'quarter' | 'week'
    } | null

    const sessionId = String(body?.session_id || '').trim()
    if (!sessionId) return json({ error: 'session_id обязателен' }, 400)

    const periods = Array.isArray(body?.periods) ? body!.periods! : []
    const periodKind = body?.period_kind === 'quarter' || body?.period_kind === 'week' ? body.period_kind : 'month'

    const supabase = hasAdminSupabaseCredentials()
      ? createAdminSupabaseClient()
      : createRequestSupabaseClient(request)

    const { data: session, error: sessionError } = await supabase
      .from('expense_wizard_sessions')
      .select('id, user_id, organization_id, payload, status, consumed_at, expires_at')
      .eq('id', sessionId)
      .single()

    if (sessionError || !session) return json({ error: 'Сессия не найдена' }, 404)
    if (session.user_id !== access.user?.id) return json({ error: 'forbidden' }, 403)
    if (session.consumed_at) return json({ error: 'Сессия уже использована' }, 410)
    if (new Date(session.expires_at).getTime() < Date.now()) {
      return json({ error: 'Сессия истекла' }, 410)
    }

    const payload = (session.payload || {}) as WizardPayload

    const cardError = validateCard(payload)
    if (cardError) return json({ error: cardError }, 400)
    const periodsError = validatePeriods(periods, Boolean(payload.backdated_confirmed))
    if (periodsError) return json({ error: periodsError }, 400)

    await resolveCompanyScope({
      activeOrganizationId: access.activeOrganization?.id || null,
      requestedCompanyId: payload.company_id || null,
      isSuperAdmin: access.isSuperAdmin,
    })

    const { data: categoryRow, error: categoryError } = await supabase
      .from('expense_categories')
      .select('id, name, accounting_group')
      .eq('id', payload.category_id || '')
      .maybeSingle()
    if (categoryError) throw categoryError
    if (!categoryRow?.id || !String(categoryRow.name || '').trim()) {
      return json({ error: 'Категория не найдена. Выберите категорию заново.' }, 400)
    }
    const isCogs = String(categoryRow.accounting_group || '').trim().toLowerCase() === 'cogs'
    if (isCogs && !access.isSuperAdmin && role !== 'owner') {
      return json({ error: 'Категории COGS нельзя добавлять вручную. Используйте приемку.' }, 400)
    }

    const isOwner = access.isSuperAdmin || role === 'owner'
    const status = payload.document_kind === 'one_off' && !isOwner ? 'pending_approval' : 'confirmed'

    const documentUrls = Array.isArray(payload.document_urls)
      ? payload.document_urls.map((url) => String(url || '')).filter(Boolean)
      : payload.document_url
        ? [String(payload.document_url)]
        : []
    const primaryDocumentUrl = documentUrls[0] || payload.document_url || null

    // series_id генерируем на сервере — клиент на него не влияет.
    const seriesId = crypto.randomUUID()
    const baseComment = (payload.comment || '').trim()
    const documentsBlock = documentUrls.length > 1
      ? `\n\nДокументы:\n${documentUrls.map((url, index) => `${index + 1}. ${url}`).join('\n')}`
      : ''

    const insertRows = periods.map((period, index) => {
      const periodLabel = String(period?.label || '').trim()
      const seriesNote = `Серия ${index + 1}/${periods.length}${periodLabel ? ` · период: ${periodLabel}` : ''}`
      return {
        date: period.date,
        company_id: payload.company_id,
        operator_id: payload.operator_id || null,
        category: String(categoryRow.name || '').trim(),
        cash_amount: Number(period.amount_cash || 0),
        kaspi_amount: Number(period.amount_kaspi || 0),
        comment: `${baseComment}\n${seriesNote}${documentsBlock}`,
        attachment_url: primaryDocumentUrl,
        wizard_session_id: sessionId,
        document_kind: payload.document_kind,
        document_url: primaryDocumentUrl,
        whitelist_vendor_id: payload.whitelist_vendor_id || null,
        one_off_payee: payload.one_off_payee || null,
        one_off_reason: payload.one_off_reason || null,
        status,
        series_id: seriesId,
        series_index: index,
      } as Record<string, unknown>
    })

    const { data: inserted, error: insertError } = await supabase
      .from('expenses')
      .insert(insertRows)
      .select('*')

    if (insertError) {
      // Колонок серии ещё нет — миграция не применена. Говорим это прямо,
      // иначе пользователь увидит сырое «column does not exist».
      if ((insertError as any).code === '42703') {
        return json({
          error: 'Серии расходов пока недоступны: не применена миграция 20260801_expense_series. Примените её в SQL Editor Supabase.',
          code: 'series-migration-required',
        }, 503)
      }
      throw insertError
    }
    const rows = inserted || []
    if (rows.length === 0) return json({ error: 'Не удалось создать записи серии' }, 500)

    if (documentUrls.length > 0) {
      const attachmentRows = rows.flatMap((row: any) => documentUrls.map((url, index) => ({
        expense_id: row.id,
        wizard_session_id: sessionId,
        document_url: url,
        sort_order: index,
        uploaded_by: access.user?.id || null,
      })))
      const { error: attachmentsError } = await supabase
        .from('expense_attachments')
        .insert(attachmentRows)
      if (attachmentsError && attachmentsError.code !== '42P01') throw attachmentsError
    }

    const { error: consumeError } = await supabase
      .from('expense_wizard_sessions')
      .update({
        consumed_at: new Date().toISOString(),
        status: 'submitted',
        expense_id: rows[0].id,
      })
      .eq('id', sessionId)

    if (consumeError) throw consumeError

    const totalAmount = rows.reduce(
      (sum: number, row: any) => sum + Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0),
      0,
    )

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'expense_series',
      entityId: seriesId,
      action: 'wizard.expense.submit_series',
      payload: {
        session_id: sessionId,
        series_id: seriesId,
        period_kind: periodKind,
        count: rows.length,
        status,
        document_kind: payload.document_kind,
        document_urls: documentUrls,
        item_name: payload.item_name,
        amount_total: totalAmount,
        expense_ids: rows.map((row: any) => String(row.id)),
        dates: rows.map((row: any) => String(row.date)),
      },
    })

    // Одно уведомление на всю серию — иначе владельцу прилетит N одинаковых.
    if (status === 'pending_approval') {
      const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || null
      if (ownerChatId) {
        let companyName = ''
        if (payload.company_id) {
          const { data: company } = await supabase
            .from('companies')
            .select('name')
            .eq('id', payload.company_id)
            .maybeSingle()
          companyName = String(company?.name || '')
        }

        const userName = String(
          access.staffMember?.full_name || access.staffMember?.email || access.user?.email || 'Сотрудник',
        )

        const lines = [
          '🟡 <b>Серия расходов на одобрение</b>',
          `Точка: ${escapeTelegramHtml(companyName)}`,
          `Категория: ${escapeTelegramHtml(payload.category_name || '')}`,
          `Периодов: ${rows.length} · Итого: ${escapeTelegramHtml(fmtMoney(totalAmount))}`,
          `Кому: ${escapeTelegramHtml(payload.one_off_payee || '')}`,
          `Почему нет чека: ${escapeTelegramHtml(payload.one_off_reason || '')}`,
          `Создал: ${escapeTelegramHtml(userName)}`,
          '',
          ...rows.map((row: any) => `• ${escapeTelegramHtml(String(row.date))} — ${escapeTelegramHtml(fmtMoney(Number(row.cash_amount || 0) + Number(row.kaspi_amount || 0)))}`),
          '',
          '<i>Одобрить можно на /expenses/pending — там каждая запись серии отдельно.</i>',
        ]

        await sendTelegramMessage(ownerChatId, lines.join('\n'), { parseMode: 'HTML' }).catch(() => null)
      }

      await pushToOrganization(supabase as any, access.activeOrganization?.id || null, {
        title: 'Серия расходов на одобрение',
        body: `${payload.category_name || 'Расход'} · ${rows.length} периодов · ${fmtMoney(totalAmount)}`,
        data: { type: 'expense_approval', seriesId },
      })
    }

    return json({
      ok: true,
      data: {
        series_id: seriesId,
        count: rows.length,
        status,
        total: totalAmount,
        items: rows,
      },
    })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/wizard/submit-series',
      message: error?.message || 'submit series failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
