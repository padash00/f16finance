import 'server-only'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID

export function isTelegramConfigured(): boolean {
  return !!(BOT_TOKEN && ADMIN_CHAT_ID)
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
      text,
      parse_mode: 'HTML',
    }),
  }).catch(() => {
    // Не критично — уведомление не обязательно
  })
}

export async function notifyShiftReport(params: {
  companyName: string
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

  const fmt = (n: number) => n.toLocaleString('ru-RU')
  const shiftLabel = params.shift === 'day' ? '☀️ Дневная' : '🌙 Ночная'
  const diff = params.diff ?? 0
  const diffSign = diff >= 0 ? '+' : ''
  const diffIcon = diff < 0 ? '🔴' : '🟢'

  const lines = [
    `${diffIcon} <b>Смена закрыта</b>`,
    ``,
    `📍 <b>${params.companyName}</b>`,
    `👤 ${params.operatorName || '—'} · ${params.date} · ${shiftLabel}`,
    ``,
    params.cashAmount ? `💵 Наличные: ${fmt(params.cashAmount)} ₸` : null,
    params.coins ? `🪙 Мелочь: ${fmt(params.coins)} ₸` : null,
    params.kaspiAmount ? `💳 Kaspi: ${fmt(params.kaspiAmount)} ₸` : null,
    params.onlineAmount ? `🌐 Kaspi Online: ${fmt(params.onlineAmount)} ₸` : null,
    params.debts ? `📋 Тех: ${fmt(params.debts)} ₸` : null,
    params.startCash ? `➖ Старт: ${fmt(params.startCash)} ₸` : null,
    params.wipon ? `➖ Вычет: ${fmt(params.wipon)} ₸` : null,
    ``,
    `<b>ИТОГ: ${diffSign}${fmt(diff)} ₸</b>`,
  ].filter(Boolean).join('\n')

  await sendTelegram(lines)
  if (params.operatorChatId) {
    await sendTelegram(lines, params.operatorChatId).catch(() => null)
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
