import 'server-only'

import { ordaTelegramFrame } from '@/lib/telegram/message-kit'

export type TelegramSendOptions = {
  parseMode?: 'HTML' | 'Markdown'
  /** Не оборачивать в брендированный шаблон (редко: сырой HTML без рамки) */
  skipFrame?: boolean
  replyMarkup?: Record<string, unknown>
}

export async function sendTelegramMessage(
  chatId: string | number,
  text: string,
  options?: TelegramSendOptions,
): Promise<{ ok: boolean; error?: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return { ok: false, error: 'TELEGRAM_BOT_TOKEN не настроен' }

  const parseMode = options?.parseMode ?? 'HTML'
  let outgoing = text
  if (parseMode === 'HTML' && !options?.skipFrame) {
    outgoing = ordaTelegramFrame(text)
  }

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: outgoing,
      parse_mode: parseMode,
      disable_web_page_preview: true,
    }
    if (options?.replyMarkup) body.reply_markup = options.replyMarkup

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json()
    if (!json.ok) return { ok: false, error: json.description || 'Telegram API error' }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Network error' }
  }
}

/**
 * Ответ на нажатие inline-кнопки. Без него Telegram крутит «часики» на кнопке
 * секунд десять, и человек жмёт её повторно — получаем дубли ответов.
 */
export async function answerTelegramCallback(
  callbackQueryId: string,
  text?: string,
  showAlert = false,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert: showAlert }),
  }).catch(() => null)
}

/**
 * Перерисовать уже отправленное сообщение (снимаем кнопки после ответа, чтобы
 * на один вопрос нельзя было ответить дважды).
 */
export async function editTelegramMessage(
  chatId: string | number,
  messageId: number,
  text: string,
  options?: TelegramSendOptions,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return
  const parseMode = options?.parseMode ?? 'HTML'
  const outgoing = parseMode === 'HTML' && !options?.skipFrame ? ordaTelegramFrame(text) : text
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text: outgoing,
    parse_mode: parseMode,
    disable_web_page_preview: true,
  }
  if (options?.replyMarkup) body.reply_markup = options.replyMarkup
  await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => null)
}

export function htmlBold(text: string) {
  return `<b>${text}</b>`
}

export function htmlCode(text: string) {
  return `<code>${text}</code>`
}
