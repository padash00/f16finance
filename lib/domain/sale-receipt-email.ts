/**
 * Письмо с чеком продажи: проверка адреса, текст и HTML, график повторов.
 *
 * Чистый модуль без сервера — чтобы вёрстку и правила можно было проверить
 * тестами. Данные чека приходят из computeSaleReceipt (lib/server/sale-receipt):
 * те же цифры, что на бумажном чеке и на онлайн-странице /r/<id>.
 */

export type ReceiptEmailItem = {
  name: string
  quantity: number
  unitPrice: number
  total: number
}

export type ReceiptEmailData = {
  saleNumber: number
  shiftNumber: number
  cashier: string
  soldAt: string | null
  pointName: string
  requisites: { name: string; bin: string; address: string }
  items: ReceiptEmailItem[]
  total: number
  cash: number
  kaspi: number
  paymentMethod: string
  onlineUrl: string
}

export type RenderedEmail = { subject: string; text: string; html: string }

/** Не больше пяти попыток. Паузы после 1-й, 2-й… неудачи. */
export const MAX_ATTEMPTS = 5
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000]

/**
 * Пауза перед следующей попыткой после `attempts` неудачных.
 * null — попытки кончились, строку пора помечать failed.
 */
export function nextRetryDelayMs(attempts: number): number | null {
  if (!Number.isFinite(attempts) || attempts < 1) return RETRY_DELAYS_MS[0]
  if (attempts >= MAX_ATTEMPTS) return null
  return RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)]
}

/**
 * Приводит адрес к виду для отправки или возвращает null.
 *
 * Проверка намеренно простая: одна «@», непустые части, точка в домене, без
 * пробелов и угловых скобок. Полный RFC 5322 здесь вреден — он пропускает
 * адреса, которые кассир ввёл с опечаткой, и спорит о кавычках, которых в
 * жизни никто не пишет. Настоящую проверку делает SMTP-сервер.
 */
export function normalizeEmail(raw: unknown): string | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (value.length < 3 || value.length > 254) return null
  if (/[\s<>(),;:"\[\]\\]/.test(value)) return null

  const at = value.indexOf('@')
  if (at <= 0 || at !== value.lastIndexOf('@')) return null

  const local = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (!local || local.length > 64) return null
  if (!domain.includes('.') || domain.startsWith('.') || domain.endsWith('.')) return null
  if (domain.includes('..') || local.startsWith('.') || local.endsWith('.')) return null
  if (!/^[a-z0-9.-]+$/.test(domain)) return null

  const tld = domain.slice(domain.lastIndexOf('.') + 1)
  if (tld.length < 2) return null

  return value
}

function escapeHtml(value: string): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/** 3640 → «3 640,00 ₸». Неразрывный пробел в разрядах, как на бумажном чеке. */
export function formatTenge(n: number): string {
  const value = Number.isFinite(n) ? n : 0
  return `${value.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₸`
}

function formatQty(n: number): string {
  const value = Number.isFinite(n) ? n : 0
  // Штучный товар — без дробной части; весовой — до трёх знаков
  return Number.isInteger(value)
    ? String(value)
    : value.toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 3 })
}

/** Время продажи по Казахстану, а не по часовому поясу сервера (Vercel — UTC). */
export function formatSoldAt(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('ru-RU', {
    timeZone: 'Asia/Qyzylorda',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function paymentLabel(method: string): string {
  if (method === 'cash') return 'Наличные'
  if (method === 'kaspi') return 'Безналичный'
  if (method === 'mixed') return 'Смешанная'
  return 'Оплата'
}

/** Название продавца: юрлицо из реквизитов, иначе название точки. */
export function sellerName(r: Pick<ReceiptEmailData, 'requisites' | 'pointName'>): string {
  return (r.requisites.name || r.pointName || 'Магазин').trim()
}

export function renderSaleReceiptEmail(r: ReceiptEmailData): RenderedEmail {
  const seller = sellerName(r)
  const when = formatSoldAt(r.soldAt)
  const subject = `Чек №${r.saleNumber} — ${seller}`

  const paymentRows: Array<[string, number]> = []
  if (r.paymentMethod === 'mixed') {
    if (r.cash > 0) paymentRows.push(['Наличные', r.cash])
    if (r.kaspi > 0) paymentRows.push(['Безналичный', r.kaspi])
  } else {
    paymentRows.push([paymentLabel(r.paymentMethod), r.total])
  }

  // ── Текстовая версия: для почтовиков без HTML и для фильтров спама ──
  const textLines = [
    seller,
    r.requisites.bin ? `БИН/ИИН ${r.requisites.bin}` : '',
    r.requisites.address || '',
    '',
    `Чек №${r.saleNumber} · ${when}`,
    `Смена №${r.shiftNumber || '—'} · Кассир: ${r.cashier || '—'}`,
    '',
    ...r.items.map((it, i) => `${i + 1}. ${it.name}\n   ${formatQty(it.quantity)} × ${formatTenge(it.unitPrice)} = ${formatTenge(it.total)}`),
    '',
    `ИТОГО: ${formatTenge(r.total)}`,
    ...paymentRows.map(([label, amount]) => `${label}: ${formatTenge(amount)}`),
    '',
    r.onlineUrl ? `Чек онлайн: ${r.onlineUrl}` : '',
    '',
    'Это электронная копия чека продажи. Если вам нужен фискальный чек — попросите его на кассе.',
  ].filter((line, idx, arr) => !(line === '' && arr[idx - 1] === ''))

  const text = textLines.join('\n').trim()

  // ── HTML: таблицы и инлайн-стили — так рисуют и Gmail, и Outlook, и Mail.ru ──
  const itemRows = r.items
    .map(
      (it, i) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px dashed #e2e8f0;vertical-align:top">
            <div style="font-size:14px;font-weight:600;color:#0f2038">${i + 1}. ${escapeHtml(it.name)}</div>
            <div style="font-size:13px;color:#56657d;margin-top:3px">${escapeHtml(formatQty(it.quantity))} × ${escapeHtml(formatTenge(it.unitPrice))}</div>
          </td>
          <td style="padding:10px 0 10px 12px;border-bottom:1px dashed #e2e8f0;vertical-align:top;text-align:right;white-space:nowrap;font-size:14px;font-weight:600;color:#0f2038">${escapeHtml(formatTenge(it.total))}</td>
        </tr>`,
    )
    .join('')

  const payRows = paymentRows
    .map(
      ([label, amount]) => `
        <tr>
          <td style="padding:4px 0;font-size:13px;color:#56657d">${escapeHtml(label)}</td>
          <td style="padding:4px 0;font-size:13px;color:#0f2038;text-align:right;white-space:nowrap">${escapeHtml(formatTenge(amount))}</td>
        </tr>`,
    )
    .join('')

  const onlineButton = r.onlineUrl
    ? `
      <tr><td style="padding-top:22px;text-align:center">
        <a href="${escapeHtml(r.onlineUrl)}" style="display:inline-block;background:#16a34a;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:12px 26px;border-radius:12px">Открыть чек онлайн</a>
      </td></tr>`
    : ''

  const html = `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:460px;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;font-family:Arial,Helvetica,sans-serif">
        <tr><td style="padding:26px 26px 6px;text-align:center">
          <div style="font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#15803d;font-weight:bold">Электронная копия чека</div>
          <div style="font-size:19px;font-weight:bold;color:#0f2038;margin-top:10px">${escapeHtml(seller)}</div>
          ${r.requisites.bin ? `<div style="font-size:13px;color:#64748b;margin-top:4px">БИН/ИИН ${escapeHtml(r.requisites.bin)}</div>` : ''}
          ${r.requisites.address ? `<div style="font-size:13px;color:#64748b;margin-top:2px">${escapeHtml(r.requisites.address)}</div>` : ''}
        </td></tr>

        <tr><td style="padding:16px 26px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0">
            <tr>
              <td style="padding:12px 0;font-size:12px;color:#64748b">Чек<div style="font-size:18px;font-weight:bold;color:#0f2038;margin-top:2px">№${r.saleNumber}</div><div style="margin-top:2px">${escapeHtml(when)}</div></td>
              <td style="padding:12px 0;font-size:12px;color:#64748b;text-align:right">Смена · кассир<div style="font-size:18px;font-weight:bold;color:#0f2038;margin-top:2px">№${escapeHtml(String(r.shiftNumber || '—'))}</div><div style="margin-top:2px">${escapeHtml(r.cashier || '—')}</div></td>
            </tr>
          </table>
        </td></tr>

        <tr><td style="padding:6px 26px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${itemRows}</table>
        </td></tr>

        <tr><td style="padding:16px 26px 0">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:4px 0;font-size:16px;font-weight:bold;color:#0f2038">Итого</td>
              <td style="padding:4px 0;font-size:20px;font-weight:bold;color:#0f2038;text-align:right;white-space:nowrap">${escapeHtml(formatTenge(r.total))}</td>
            </tr>
            ${payRows}
          </table>
        </td></tr>

        ${onlineButton}

        <tr><td style="padding:22px 26px 26px">
          <div style="border-top:1px solid #eef2f8;padding-top:14px;font-size:12px;line-height:1.5;color:#64748b;text-align:center">
            Это электронная копия чека продажи. Если вам нужен фискальный чек — попросите его на кассе.
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`

  return { subject, text, html }
}
