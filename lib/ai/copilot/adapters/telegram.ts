/**
 * Telegram adapter для Copilot.
 *
 * Конвертирует CopilotResponse → Telegram sendMessage payload
 * с inline_keyboard для интерактивных кнопок.
 *
 * Кнопки группируются по 2 в ряд (для длинных списков — по 1).
 * callback_data ограничен 64 байтами в Telegram → используем
 * compact-format и при длинных значениях — сокращаем.
 */

import type { CopilotResponse } from '../types'

export function copilotResponseToTelegram(response: CopilotResponse): {
  text: string
  reply_markup?: { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> }
  parse_mode?: 'HTML'
} {
  const payload: ReturnType<typeof copilotResponseToTelegram> = {
    text: response.text,
  }

  if (response.buttons && response.buttons.length > 0) {
    // Группируем по 2 в ряд если их много, по 1 если кнопки длинные
    const longButtons = response.buttons.some((b) => b.label.length > 20)
    const perRow = longButtons ? 1 : 2

    const inline_keyboard: Array<Array<{ text: string; callback_data: string }>> = []
    for (let i = 0; i < response.buttons.length; i += perRow) {
      const row = response.buttons.slice(i, i + perRow).map((b) => ({
        text: b.label,
        // Префиксуем cp: чтобы webhook знал что это Copilot callback
        // и не путал с другими (sw:, si:, ireq:, pdf_*).
        callback_data: truncateCallback('cp:' + b.callbackData),
      }))
      inline_keyboard.push(row)
    }

    payload.reply_markup = { inline_keyboard }
  }

  return payload
}

/**
 * Telegram limit на callback_data — 64 байта.
 * Если превышено (например UUID + параметр) — оставляем хеш.
 * Но для UUID 36 символов + name + value часто превышаем.
 *
 * Стратегия: если > 64 — обрезаем end. Имя параметра и значение
 * UUID обычно вмещаются.
 */
function truncateCallback(data: string): string {
  if (Buffer.byteLength(data, 'utf8') <= 64) return data
  // Обрезаем до 60 байт чтобы оставить место для возможной пометки
  return data.slice(0, 60)
}
