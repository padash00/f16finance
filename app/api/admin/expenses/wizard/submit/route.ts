import { NextResponse } from 'next/server'

import { writeAuditLog, writeSystemErrorLogSafe } from '@/lib/server/audit'
import { resolveCompanyScope } from '@/lib/server/organizations'
import { pushToOrganization } from '@/lib/server/push'
import { createRequestSupabaseClient, getRequestAccessContext } from '@/lib/server/request-auth'
import { createAdminSupabaseClient, hasAdminSupabaseCredentials } from '@/lib/server/supabase'
import { sendTelegramMessage } from '@/lib/telegram/send'
import { escapeTelegramHtml } from '@/lib/telegram/message-kit'

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status })
}

function fmtMoney(n: number) {
  return Math.round(n).toLocaleString('ru-RU') + ' ₸'
}

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

function validatePayload(p: WizardPayload, role: string, isSuperAdmin: boolean): string | null {
  if (!p.date) return 'Дата обязательна'
  if (!p.company_id) return 'Точка обязательна'
  if (!p.category_id || !p.category_name) return 'Категория обязательна'
  if (!p.item_name || p.item_name.trim().length < 5) {
    return 'Краткое название обязательно (≥ 5 символов)'
  }
  if (!p.comment || p.comment.trim().length < 20) {
    return 'Комментарий обязателен (≥ 20 символов)'
  }

  const cash = Number(p.amount_cash || 0)
  const kaspi = Number(p.amount_kaspi || 0)
  if (cash < 0 || kaspi < 0) return 'Сумма не может быть отрицательной'
  if (cash + kaspi <= 0) return 'Сумма расхода обязательна'

  const dateMs = new Date(p.date).getTime()
  if (Number.isNaN(dateMs)) return 'Некорректная дата'
  if (dateMs > Date.now() + 24 * 60 * 60 * 1000) return 'Дата не может быть в будущем'
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
  if (dateMs < sevenDaysAgo && !p.backdated_confirmed) {
    return 'Подтвердите, что это действительно дата старого расхода'
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

  // Capability checks выше уже отсеивают; здесь — любой staff
  if (!isSuperAdmin && !role) {
    return 'forbidden'
  }

  return null
}

export async function POST(request: Request) {
  try {
    const access = await getRequestAccessContext(request)
    if ('response' in access) return access.response

    const role = access.staffRole
    // Capability checks выше уже отсеивают; здесь — любой staff
    if (!access.isSuperAdmin && !role) {
      return json({ error: 'forbidden' }, 403)
    }

    const body = await request.json().catch(() => null) as { session_id?: string } | null
    const sessionId = String(body?.session_id || '').trim()
    if (!sessionId) return json({ error: 'session_id обязателен' }, 400)

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
    const validationError = validatePayload(payload, role, access.isSuperAdmin)
    if (validationError) return json({ error: validationError }, 400)

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
    const commentWithDocuments =
      documentUrls.length > 1
        ? `${(payload.comment || '').trim()}\n\nДокументы:\n${documentUrls.map((url, index) => `${index + 1}. ${url}`).join('\n')}`
        : (payload.comment || '').trim()

    const insertRow: Record<string, unknown> = {
      date: payload.date,
      company_id: payload.company_id,
      operator_id: payload.operator_id || null,
      category: String(categoryRow.name || '').trim(),
      cash_amount: Number(payload.amount_cash || 0),
      kaspi_amount: Number(payload.amount_kaspi || 0),
      comment: commentWithDocuments,
      attachment_url: primaryDocumentUrl,
      wizard_session_id: sessionId,
      document_kind: payload.document_kind,
      document_url: primaryDocumentUrl,
      whitelist_vendor_id: payload.whitelist_vendor_id || null,
      one_off_payee: payload.one_off_payee || null,
      one_off_reason: payload.one_off_reason || null,
      status,
    }

    const { data: inserted, error: insertError } = await supabase
      .from('expenses')
      .insert([insertRow])
      .select('*')
      .single()

    if (insertError) throw insertError

    if (documentUrls.length > 0) {
      const { error: attachmentsError } = await supabase
        .from('expense_attachments')
        .insert(documentUrls.map((url, index) => ({
          expense_id: inserted.id,
          wizard_session_id: sessionId,
          document_url: url,
          sort_order: index,
          uploaded_by: access.user?.id || null,
        })))
      if (attachmentsError && attachmentsError.code !== '42P01') throw attachmentsError
    }

    const { error: consumeError } = await supabase
      .from('expense_wizard_sessions')
      .update({
        consumed_at: new Date().toISOString(),
        status: 'submitted',
        expense_id: inserted.id,
      })
      .eq('id', sessionId)

    if (consumeError) throw consumeError

    const dateMs = new Date(payload.date as string).getTime()
    const backdated = dateMs < Date.now() - 7 * 24 * 60 * 60 * 1000

    await writeAuditLog(supabase, {
      actorUserId: access.user?.id || null,
      entityType: 'expense',
      entityId: String(inserted.id),
      action: 'wizard.expense.submit',
      payload: {
        session_id: sessionId,
        expense_id: inserted.id,
        status,
        document_kind: payload.document_kind,
        document_urls: documentUrls,
        backdated,
        item_name: payload.item_name,
        amount_total: Number(payload.amount_cash || 0) + Number(payload.amount_kaspi || 0),
      },
    })

    if (status === 'pending_approval') {
      const ownerChatId = process.env.TELEGRAM_OWNER_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || null
      if (ownerChatId) {
        const total = Number(payload.amount_cash || 0) + Number(payload.amount_kaspi || 0)

        let suggestWhitelist = false
        const payee = (payload.one_off_payee || '').trim().toLowerCase()
        if (payee) {
          const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
          const { data: prior } = await supabase
            .from('expenses')
            .select('id, one_off_payee, status')
            .eq('document_kind', 'one_off')
            .gte('date', since)
            .in('status', ['confirmed', 'approved'])
          const matches = (prior || []).filter((row: any) => {
            return String(row.one_off_payee || '').trim().toLowerCase() === payee
          })
          suggestWhitelist = matches.length >= 3
        }

        let companyName = ''
        if (payload.company_id) {
          const { data: company } = await supabase
            .from('companies')
            .select('name')
            .eq('id', payload.company_id)
            .maybeSingle()
          companyName = String(company?.name || '')
        }

        const userName = String(access.staffMember?.full_name || access.staffMember?.email || access.user?.email || 'Сотрудник')

        const linesParts = [
          '🟡 <b>Расход на одобрение</b>',
          `Точка: ${escapeTelegramHtml(companyName)}`,
          `Категория: ${escapeTelegramHtml(payload.category_name || '')}`,
          `Сумма: ${escapeTelegramHtml(fmtMoney(total))}`,
          `Дата: ${escapeTelegramHtml(payload.date || '')}`,
          `Кому: ${escapeTelegramHtml(payload.one_off_payee || '')}`,
          `Почему нет чека: ${escapeTelegramHtml(payload.one_off_reason || '')}`,
          `Создал: ${escapeTelegramHtml(userName)}`,
        ]
        if (suggestWhitelist) {
          linesParts.push('')
          linesParts.push('⚠️ Это уже 3-й платёж этому вендору за месяц. Возможно стоит добавить в whitelist.')
        }
        const text = linesParts.join('\n')

        await sendTelegramMessage(ownerChatId, text, {
          parseMode: 'HTML',
          replyMarkup: {
            inline_keyboard: [[
              { text: '✅ Одобрить', callback_data: `expense_approve:${inserted.id}` },
              { text: '❌ Отклонить', callback_data: `expense_decline:${inserted.id}` },
            ]],
          },
        }).catch(() => null)
      }

      // Push в мобильное приложение владельцам организации.
      const pushTotal = Number(payload.amount_cash || 0) + Number(payload.amount_kaspi || 0)
      await pushToOrganization(supabase as any, access.activeOrganization?.id || null, {
        title: 'Расход на одобрение',
        body: `${payload.category_name || 'Расход'} · ${fmtMoney(pushTotal)} — нужно одобрить`,
        data: { type: 'expense_approval', expenseId: (inserted as any)?.id || null },
      })
    }

    return json({ ok: true, data: inserted })
  } catch (error: any) {
    await writeSystemErrorLogSafe({
      scope: 'server',
      area: 'api/admin/expenses/wizard/submit',
      message: error?.message || 'submit failed',
    })
    return json({ error: error?.message || 'Ошибка сервера' }, 500)
  }
}
