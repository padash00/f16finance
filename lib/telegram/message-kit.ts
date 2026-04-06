import 'server-only'

/** Экранирование для Telegram HTML (<b>, <i>, <code> и т.д.) */
export function escapeTelegramHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const BRAND = 'Orda Control'
const SITE = 'ordaops.kz'

/**
 * Единое оформление служебных сообщений: шапка бренда + тело + аккуратный подвал.
 * В `coreHtml` передавайте уже безопасный HTML; динамические строки — через escapeTelegramHtml.
 */
export function ordaTelegramFrame(coreHtml: string): string {
  const core = coreHtml.trim()
  return [
    `<b>🟠 ${BRAND}</b>`,
    `<i>📢 Сообщение от системы</i>`,
    ``,
    core,
    ``,
    `<i>──────────────</i>`,
    `<i>${SITE} · ${BRAND}</i>`,
  ].join('\n')
}
