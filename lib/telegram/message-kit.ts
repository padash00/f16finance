import 'server-only'

/** Экранирование для Telegram HTML (<b>, <i>, <code> и т.д.) */
export function escapeTelegramHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

const DEFAULT_BRAND = 'Orda Control'
const DEFAULT_FOOTER_SITE = 'ordaops.kz'

/**
 * Имя продукта в шапке/подвале Telegram.
 * 1) NEXT_PUBLIC_SITE_NAME — как в веб-интерфейсе (.env.example)
 * 2) ORDA_TELEGRAM_BRAND_NAME — только для текста в Telegram
 * 3) иначе «Orda Control»
 */
export function telegramBrandName(): string {
  const fromPublic = process.env.NEXT_PUBLIC_SITE_NAME?.trim()
  if (fromPublic) return fromPublic
  const onlyTg = process.env.ORDA_TELEGRAM_BRAND_NAME?.trim()
  if (onlyTg) return onlyTg
  return DEFAULT_BRAND
}

/**
 * Короткая строка сайта в подвале (без https://), напр. ordaops.kz
 * 1) ORDA_TELEGRAM_FOOTER_SITE — явно
 * 2) hostname из NEXT_PUBLIC_APP_URL или APP_URL
 * 3) иначе ordaops.kz
 */
export function telegramFooterSiteLabel(): string {
  const explicit = process.env.ORDA_TELEGRAM_FOOTER_SITE?.trim()
  if (explicit) return explicit
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim() || process.env.APP_URL?.trim()
  if (raw) {
    try {
      const url = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`
      const host = new URL(url).hostname.replace(/^www\./i, '')
      if (host) return host
    } catch {
      /* ignore */
    }
  }
  return DEFAULT_FOOTER_SITE
}

/**
 * Единое оформление служебных сообщений: шапка бренда + тело + аккуратный подвал.
 * В `coreHtml` передавайте уже безопасный HTML; динамические строки — через escapeTelegramHtml.
 */
export function ordaTelegramFrame(coreHtml: string): string {
  const core = coreHtml.trim()
  const brand = escapeTelegramHtml(telegramBrandName())
  const site = escapeTelegramHtml(telegramFooterSiteLabel())
  return [
    `<b>🟠 ${brand}</b>`,
    `<i>📢 Сообщение от системы</i>`,
    ``,
    core,
    ``,
    `<i>──────────────</i>`,
    `<i>${site} · ${brand}</i>`,
  ].join('\n')
}
