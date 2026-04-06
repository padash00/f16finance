import 'server-only'

import { ordaTelegramFrame } from '@/lib/telegram/message-kit'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID

export function isTelegramConfigured(): boolean {
  return !!BOT_TOKEN
}

export async function sendTelegram(
  text: string,
  chatId?: string,
): Promise<void> {
  const token = BOT_TOKEN
  const chat = chatId || ADMIN_CHAT_ID
  if (!token || !chat) return

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chat,
      text: ordaTelegramFrame(text),
      parse_mode: 'HTML',
    }),
  }).catch(() => {
    // Уведомление не должно ломать основной сценарий.
  })
}

function escapeHtmlTelegram(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export async function notifyShiftReport(params: {
  companyName: string
  pointName?: string | null
  reportChatId?: string | null
  operatorName: string | null
  operatorChatId?: string | null
  date: string
  shift: 'day' | 'night'
  cashAmount: number
  kaspiAmount: number
  onlineAmount: number
  coins?: number | null
  debts?: number | null
  startCash?: number | null
  wipon?: number | null
  diff?: number | null
}): Promise<void> {
  if (!isTelegramConfigured()) return

  const fmt = (n: number) =>
    n.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 0 })
  const shiftLabel = params.shift === 'day' ? '☀️ День' : '🌙 Ночь'
  const diff = Number(params.diff ?? 0)
  const diffSign = diff >= 0 ? '+' : ''
  const ok = diff >= 0

  const company = escapeHtmlTelegram(params.companyName || 'Точка')
  const device = params.pointName ? escapeHtmlTelegram(params.pointName) : null
  const who = escapeHtmlTelegram(params.operatorName || '—')
  const dateStr = escapeHtmlTelegram(params.date)

  const cash = Number(params.cashAmount || 0)
  const coins = Number(params.coins || 0)
  const kaspi = Number(params.kaspiAmount || 0)
  const online = Number(params.onlineAmount || 0)
  const tech = Number(params.debts || 0)
  const start = Number(params.startCash || 0)
  const wipon = Number(params.wipon || 0)

  type Row = { k: string; v: number; always?: boolean }
  const rows: Row[] = [
    { k: 'Наличные', v: cash },
    { k: 'Мелочь', v: coins },
    { k: 'Kaspi POS', v: kaspi },
    { k: 'Kaspi Online', v: online },
    { k: 'Тех / прочее', v: tech },
    { k: 'Старт кассы', v: start },
    { k: 'Вычет (сист.)', v: wipon },
    { k: 'ИТОГ', v: diff, always: true },
  ]

  const visible = rows.filter((r) => r.always || r.v !== 0)
  const labelW = Math.min(22, Math.max(12, ...visible.map((r) => r.k.length)))
  const preBody = visible
    .map((r) => {
      const isTotal = r.k === 'ИТОГ'
      const sep = isTotal ? '─'.repeat(labelW + 2 + 14) : null
      const amountStr = isTotal ? `${diffSign}${fmt(r.v)}` : fmt(r.v)
      const line = `${r.k.padEnd(labelW, ' ')}  ${amountStr} ₸`
      return sep ? `${sep}\n${line}` : line
    })
    .join('\n')

  const title = ok ? '✅ Смена закрыта' : '⚠️ Закрытие смены'
  const html = [
    `<b>${title}</b>`,
    '',
    `🏷 <b>${company}</b>${device ? ` · <code>${device}</code>` : ''}`,
    `👤 <i>${who} · ${dateStr} · ${shiftLabel}</i>`,
    '',
    `<pre>${preBody}</pre>`,
  ].join('\n')

  await sendTelegram(html, params.reportChatId || undefined)
  if (params.operatorChatId) {
    await sendTelegram(html, params.operatorChatId).catch(() => null)
  }
}

/** @deprecated use notifyShiftReport */
export async function notifyShiftDeficit(params: {
  companyName: string
  operatorName: string | null
  date: string
  shift: 'day' | 'night'
  cashAmount: number
  kaspiAmount: number
  wipon: number | null
  diff: number | null
}): Promise<void> {
  return notifyShiftReport({ ...params, onlineAmount: 0 })
}
