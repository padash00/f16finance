/**
 * AI tools: отправить сообщение оператору / всем операторам через Telegram.
 * Capability: operators.view (минимум — для отправки нужен список) +
 * проверка наличия telegram_chat_id у оператора.
 */

import type { CopilotTool } from '../../types'
import { companyOptions, scopedCompanyIds, scopedOperatorIds } from '../../query-helpers'
import { writeAuditLog } from '@/lib/server/audit'

const TELEGRAM_API = 'https://api.telegram.org'

async function sendDirectTelegram(chatId: string | number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return false
  try {
    const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    })
    return res.ok
  } catch {
    return false
  }
}

export const sendMessageToOperatorTool: CopilotTool = {
  name: 'send_message_to_operator',
  category: 'team',
  description: 'Отправить сообщение конкретному оператору в Telegram',
  requiredCapability: 'operators.view',
  severity: 'medium',
  params: [
    {
      name: 'operator_id',
      label: 'Кому отправить',
      type: 'select',
      required: true,
      description: 'ID оператора. Только тех у кого есть telegram_chat_id',
      getOptions: async (ctx) => {
        const { data } = await ctx.supabase
          .from('operators')
          .select('id, name, short_name, telegram_chat_id')
          .eq('is_active', true)
          .not('telegram_chat_id', 'is', null)
          .order('name')
        return (data || []).map((op: any) => ({ value: op.id, label: op.short_name || op.name }))
      },
    },
    {
      name: 'message',
      label: 'Сообщение',
      type: 'string',
      required: true,
      description: 'Текст сообщения',
    },
  ],
  handler: async (input, ctx) => {
    const operatorId = String(input.operator_id || '')
    const message = String(input.message || '').trim()
    if (!operatorId || !message) return { ok: false, message: 'Нужны оператор и текст.' }

    // Мультитенантная изоляция: писать можно только оператору своей организации.
    const allowedOps = await scopedOperatorIds(ctx)
    if (allowedOps && !allowedOps.includes(operatorId)) return { ok: false, message: 'Оператор не найден.' }

    const { data: op, error } = await ctx.supabase
      .from('operators')
      .select('id, name, short_name, telegram_chat_id')
      .eq('id', operatorId)
      .single()
    if (error || !op) return { ok: false, message: 'Оператор не найден.' }
    if (!op.telegram_chat_id) return { ok: false, message: `У ${op.name} не привязан Telegram.` }

    const sent = await sendDirectTelegram(op.telegram_chat_id, message)
    if (!sent) return { ok: false, message: 'Не удалось отправить в Telegram.' }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator',
        entityId: operatorId,
        action: 'send-message',
        payload: { operator_name: op.name, message_length: message.length, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📨 Отправлено: ${op.short_name || op.name}` }
  },
}

export const broadcastToOperatorsTool: CopilotTool = {
  name: 'broadcast_to_operators',
  category: 'team',
  description: 'Отправить сообщение всем операторам с привязанным Telegram',
  requiredCapability: 'operators.view',
  severity: 'high',
  params: [
    {
      name: 'company_id',
      label: 'Только одной точке',
      type: 'select',
      required: false,
      description: 'Если выбрано — только операторам этой точки. Иначе всем.',
      getOptions: async (ctx) => companyOptions(ctx, { allLabel: '📢 Всем операторам' }),
    },
    {
      name: 'message',
      label: 'Текст рассылки',
      type: 'string',
      required: true,
      description: 'Сообщение для всех',
    },
  ],
  handler: async (input, ctx) => {
    const companyId = String(input.company_id || '')
    const message = String(input.message || '').trim()
    if (!message) return { ok: false, message: 'Текст обязателен.' }

    // Мультитенантная изоляция: если указана точка — она должна быть своей организации.
    const allowedCos = await scopedCompanyIds(ctx)
    if (companyId && allowedCos && !allowedCos.includes(companyId)) {
      return { ok: false, message: 'Точка не найдена.' }
    }

    let opQuery = ctx.supabase
      .from('operators')
      .select('id, name, telegram_chat_id, operator_company_assignments!operator_id(company_id, is_active)')
      .eq('is_active', true)
      .not('telegram_chat_id', 'is', null)
    // Рассылка ограничена операторами своей организации (даже при «всем операторам»).
    const allowedOps = await scopedOperatorIds(ctx)
    if (allowedOps) opQuery = opQuery.in('id', allowedOps)

    const { data: ops } = await opQuery
    let targets = (ops || []) as any[]
    if (companyId) {
      targets = targets.filter((op) => {
        const assignments = op.operator_company_assignments || []
        return assignments.some((a: any) => a.company_id === companyId && a.is_active)
      })
    }

    if (targets.length === 0) return { ok: false, message: 'Нет получателей.' }

    let sent = 0
    let failed = 0
    for (const op of targets) {
      const ok = await sendDirectTelegram(op.telegram_chat_id, message)
      if (ok) sent++
      else failed++
    }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'operator-broadcast',
        entityId: companyId || 'all',
        action: 'broadcast',
        payload: { company_id: companyId || null, sent, failed, total: targets.length, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📢 Доставлено: ${sent} из ${targets.length}${failed > 0 ? ` (${failed} не дошло)` : ''}.` }
  },
}
