/**
 * AI tool: отправить себе/в канал отчёт за период.
 * Capability: telegram-bot.view (любой staff)
 */

import type { CopilotTool } from '../../types'
import { writeAuditLog } from '@/lib/server/audit'

const TELEGRAM_API = 'https://api.telegram.org'

function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function addDaysISO(iso: string, diff: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export const sendTelegramReportTool: CopilotTool = {
  name: 'send_telegram_report',
  category: 'system',
  description: 'Отправить финансовый отчёт за день/неделю в Telegram (себе или в канал)',
  // Минимальная — у любого staff с view финансов
  requiredCapability: 'income.view',
  severity: 'medium',
  params: [
    {
      name: 'period',
      label: 'Период',
      type: 'select',
      required: true,
      description: 'За какой период отчёт',
      getOptions: async () => [
        { value: 'today', label: 'Сегодня' },
        { value: 'yesterday', label: 'Вчера' },
        { value: 'week', label: 'Неделя' },
      ],
    },
    {
      name: 'destination',
      label: 'Куда отправить',
      type: 'select',
      required: true,
      description: 'Себе в чат или в канал TELEGRAM_CHAT_ID',
      getOptions: async () => [
        { value: 'self', label: 'Себе в чат' },
        { value: 'channel', label: 'В канал владельца' },
      ],
    },
  ],
  handler: async (input, ctx) => {
    const period = String(input.period || 'today')
    const destination = String(input.destination || 'self')
    const today = todayISO()

    let from = today
    let to = today
    let title = 'Сегодня'
    if (period === 'yesterday') {
      from = to = addDaysISO(today, -1)
      title = 'Вчера'
    } else if (period === 'week') {
      from = addDaysISO(today, -6)
      title = 'Неделя'
    }

    // Получаем доходы и расходы
    const [incRes, expRes] = await Promise.all([
      ctx.supabase
        .from('incomes')
        .select('cash_amount, kaspi_amount, card_amount, online_amount')
        .gte('date', from)
        .lte('date', to)
        .range(0, 19999),
      ctx.supabase
        .from('expenses')
        .select('cash_amount, kaspi_amount')
        .gte('date', from)
        .lte('date', to)
        .range(0, 19999),
    ])

    let income = 0
    for (const r of (incRes.data || []) as any[]) {
      income += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0) + Number(r.card_amount || 0) + Number(r.online_amount || 0)
    }
    let expense = 0
    for (const r of (expRes.data || []) as any[]) {
      expense += Number(r.cash_amount || 0) + Number(r.kaspi_amount || 0)
    }
    const profit = income - expense
    const margin = income > 0 ? (profit / income) * 100 : 0

    const fmt = (n: number) => Math.round(n).toLocaleString('ru-RU') + ' ₸'
    const text = `📊 Отчёт за: ${title}
Период: ${from} — ${to}

Доходы: ${fmt(income)}
Расходы: ${fmt(expense)}
Прибыль: ${fmt(profit)}
Маржа: ${margin.toFixed(1)}%

🤖 Отправлено через AI Copilot`

    // Определяем chat_id
    let chatId: string | null = null
    if (destination === 'self' && ctx.telegramChatId) {
      chatId = String(ctx.telegramChatId)
    } else if (destination === 'channel') {
      chatId = process.env.TELEGRAM_CHAT_ID || process.env.TELEGRAM_OWNER_CHAT_ID || null
    }

    if (!chatId) return { ok: false, message: 'Не настроен Telegram chat_id для канала.' }

    const token = process.env.TELEGRAM_BOT_TOKEN
    if (!token) return { ok: false, message: 'Не настроен TELEGRAM_BOT_TOKEN.' }

    try {
      const res = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        return { ok: false, message: `Telegram API: ${err?.description || res.status}` }
      }
    } catch (e: any) {
      return { ok: false, message: `Сеть: ${e?.message || 'unknown'}` }
    }

    try {
      await writeAuditLog(ctx.supabase, {
        actorUserId: ctx.userId,
        entityType: 'telegram-report',
        entityId: chatId,
        action: 'send',
        payload: { period, destination, income, expense, profit, via: 'copilot', source: ctx.source },
      })
    } catch {}

    return { ok: true, message: `📨 Отчёт отправлен в Telegram (${destination === 'self' ? 'тебе' : 'в канал'}).` }
  },
}
