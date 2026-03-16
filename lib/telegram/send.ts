import 'server-only'

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не настроен' }

  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: parseMode,
        disable_web_page_preview: true,
      }),
    })
    const json = await res.json()
    if (!json.ok) return { ok: false, error: json.description || 'Telegram API error' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

export function htmlBold(text: string) {
  return `<b>${text}</b>`
}

export function htmlCode(text: string) {
  return `<code>${text}</code>`
}
