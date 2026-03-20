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
  if (!isTelegramConfigured()) return

  const shiftLabel = params.shift === 'day' ? '☀️ Дневная' : '🌙 Ночная'
  const diff = params.diff ?? 0
  const diffStr = diff >= 0 ? `+${diff.toLocaleString('ru')}` : diff.toLocaleString('ru')

  const lines = [
    `🔴 <b>Недостача по смене</b>`,
    ``,
    `<b>Точка:</b> ${params.companyName}`,
    `<b>Оператор:</b> ${params.operatorName || '—'}`,
    `<b>Дата:</b> ${params.date} · ${shiftLabel}`,
    ``,
    `<b>ИТОГ:</b> ${diffStr} ₸`,
    params.kaspiAmount ? `<b>Kaspi:</b> ${params.kaspiAmount.toLocaleString('ru')} ₸` : null,
    params.wipon ? `<b>Вычет:</b> ${params.wipon.toLocaleString('ru')} ₸` : null,
  ].filter(Boolean).join('\n')

  await sendTelegram(lines)
}
