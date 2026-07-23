/**
 * Генерация HTML чека для печати.
 * Используется в обеих версиях страницы продаж (классической и минималистичной).
 */

import { formatMoney } from '@/lib/utils'
import type { PointReceiptSettings } from '@/types'

export type SaleReceiptPreview = {
  saleId: string | null
  saleDate: string
  saleTime: string
  shift: 'day' | 'night' | string
  paymentMethod: 'cash' | 'kaspi' | 'mixed'
  cashAmount: number
  kaspiAmount: number
  totalAmount: number
  subtotal: number
  discountAmount: number
  loyaltyDiscountAmount: number
  customer?: { name: string; phone?: string | null } | null
  comment?: string | null
  operatorName: string
  companyName: string
  locationName: string
  // Реквизиты ККМ (приказ Минфина РК №626 от 24.10.2025).
  // Подгружаются с сервера и кэшируются локально. Если null — печатается старый
  // шаблон без обязательных реквизитов (нелегально с 01.01.2026).
  receiptSettings?: PointReceiptSettings | null
  // Признак возврата: чек печатается как «ВОЗВРАТ ПРИХОДА» со ссылкой
  // на оригинальный чек (originalSaleId / originalSaleDate).
  isReturn?: boolean
  // Повторная печать из истории продаж: на чеке крупная пометка «КОПИЯ».
  isCopy?: boolean
  originalSaleId?: string | null
  originalSaleDate?: string | null
  originalSaleTime?: string | null
  refundReason?: string | null
  lines: Array<{
    name: string
    quantity: number
    unit_price: number
    total: number
    unit?: string | null
  }>
}

export function paymentBadge(method: string) {
  if (method === 'cash') return 'Наличные'
  if (method === 'kaspi') return 'Безналичный'
  return 'Смешанная'
}

export function formatShiftLabel(shift: 'day' | 'night' | string) {
  if (shift === 'day') return 'Дневная'
  if (shift === 'night') return 'Ночная'
  return shift
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function buildReceiptHtml(preview: SaleReceiptPreview) {
  const customerBlock = preview.customer
    ? `<div style="margin-top:8px;font-size:12px;">Клиент: ${escapeHtml(preview.customer.name)}${preview.customer.phone ? ` (${escapeHtml(preview.customer.phone)})` : ''}</div>`
    : ''

  const commentBlock = preview.comment
    ? `<div style="margin-top:8px;font-size:12px;">Комментарий: ${escapeHtml(preview.comment)}</div>`
    : ''

  const totalQty = preview.lines.reduce((s, l) => s + Number(l.quantity || 0), 0)
  const itemsCount = preview.lines.length

  // Реквизиты ККМ для шапки и подвала (приказ МФ РК №626).
  const rs = preview.receiptSettings || null

  const taxPayerBlock = rs?.tax_payer_name
    ? `<div style="font-weight:700;font-size:14px;margin-top:6px;">${escapeHtml(rs.tax_payer_name)}</div>
       ${rs.tax_payer_bin ? `<div class="muted">БИН/ИИН: ${escapeHtml(rs.tax_payer_bin)}</div>` : ''}
       ${rs.point_address ? `<div class="muted">${escapeHtml(rs.point_address)}</div>` : ''}`
    : ''

  const kkmBlock = rs && (rs.kkm_factory_number || rs.kkm_registration_number)
    ? `<div style="margin-top:6px;font-size:11px;">
         ${rs.kkm_factory_number ? `<div>ККМ зав. №: <strong>${escapeHtml(rs.kkm_factory_number)}</strong></div>` : ''}
         ${rs.kkm_registration_number ? `<div>ККМ рег. №: <strong>${escapeHtml(rs.kkm_registration_number)}</strong></div>` : ''}
       </div>`
    : ''

  // НДС: если плательщик — отдельная строка в итогах. Расчёт «в т.ч. НДС».
  const vatRate = Number(rs?.vat_rate || 0)
  const vatInclusiveAmount = rs?.is_vat_payer && vatRate > 0
    ? (preview.totalAmount * vatRate) / (100 + vatRate)
    : 0
  const vatBlock = rs?.is_vat_payer && vatInclusiveAmount > 0
    ? `<div class="summary-row"><span>в т.ч. НДС (${vatRate}%)</span><strong>${escapeHtml(formatMoney(vatInclusiveAmount))}</strong></div>`
    : ''

  // Фискальный признак — placeholder. Заменится реальным значением после
  // подключения Webkassa (Уровень B плана).
  const fiscalSign = (preview.saleId || '').replace(/[^a-z0-9]/gi, '').slice(-16).toUpperCase().padStart(16, '0')

  const ofdBlock = rs && (rs.ofd_name || rs.ofd_check_url)
    ? `<div style="margin-top:8px;font-size:11px;">
         ${rs.ofd_name ? `<div>ОФД: <strong>${escapeHtml(rs.ofd_name)}</strong></div>` : ''}
         ${rs.ofd_check_url ? `<div class="muted">Проверка чека: ${escapeHtml(rs.ofd_check_url)}</div>` : ''}
       </div>`
    : ''

  const footerExtra = rs?.receipt_footer_text
    ? `<div class="muted" style="margin-top:8px;">${escapeHtml(rs.receipt_footer_text)}</div>`
    : '<div class="muted" style="margin-top:6px;">Сохраните чек до выхода</div><div class="muted" style="margin-top:4px;">Возврат: 14 дней</div>'

  const isReturn = !!preview.isReturn
  const isCopy = !!preview.isCopy
  // Заметная пометка «КОПИЯ» — сразу под типом документа и в подвале
  const copyBlock = isCopy
    ? `<div style="margin-top:6px;"><span style="display:inline-block;border:2px dashed #000;padding:3px 12px;font-weight:800;font-size:16px;letter-spacing:4px;">КОПИЯ</span></div>`
    : ''
  const copyFooter = isCopy
    ? `<div style="margin-top:6px;font-weight:700;letter-spacing:2px;">*** КОПИЯ ЧЕКА — ПОВТОРНАЯ ПЕЧАТЬ ***</div>`
    : ''
  const docTitle = isReturn ? 'ВОЗВРАТ ПРИХОДА' : 'ЧЕК ПРИХОДА'
  const docTitleColor = isReturn ? '#b91c1c' : '#000'
  const totalLabel = isReturn ? 'К возврату' : 'К оплате'
  const thanksText = isReturn ? 'ВОЗВРАТ ОФОРМЛЕН' : 'СПАСИБО ЗА ПОКУПКУ!'

  // Блок ссылки на оригинальный чек — обязателен для возврата
  const originalRefBlock = isReturn
    ? `<div style="margin-top:6px;font-size:12px;padding:6px;border:1px solid #000;">
         <div><strong>Возврат к чеку:</strong></div>
         ${preview.originalSaleId ? `<div>№ ${escapeHtml(preview.originalSaleId.slice(-6))}</div>` : ''}
         ${preview.originalSaleDate ? `<div class="muted">${escapeHtml(preview.originalSaleDate)}${preview.originalSaleTime ? ` ${escapeHtml(preview.originalSaleTime)}` : ''}</div>` : ''}
         ${preview.refundReason ? `<div class="muted" style="margin-top:4px;">Причина: ${escapeHtml(preview.refundReason)}</div>` : ''}
       </div>`
    : ''

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(docTitle)} ${escapeHtml(preview.saleId?.slice(-6) || '')}</title>
    <style>
      @page { size: 80mm auto; margin: 4mm; }
      * { box-sizing: border-box; }
      body { font-family: 'Arial', sans-serif; margin: 0; padding: 8px 6px; color: #000; font-size: 14px; line-height: 1.4; }
      .wrap { max-width: 76mm; margin: 0 auto; }
      .center { text-align: center; }
      .muted { color: #4b5563; font-size: 12px; }
      .line { border-top: 1px dashed #000; margin: 8px 0; }
      .header-title { font-weight: 800; font-size: 22px; letter-spacing: 1px; }
      .doc-type { font-weight: 800; font-size: 16px; letter-spacing: 2px; margin-top: 6px; padding: 4px 6px; border: 2px solid ${docTitleColor}; color: ${docTitleColor}; display: inline-block; }
      .header-sub { font-size: 13px; margin-top: 2px; }
      .meta { font-size: 12px; margin-top: 6px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      .item-row td { padding: 4px 0 0 0; vertical-align: top; }
      .item-name { font-weight: 600; font-size: 14px; }
      .item-qty-price { font-size: 12px; color: #4b5563; padding-bottom: 4px; border-bottom: 1px dotted #d1d5db; }
      .summary-row { display: flex; justify-content: space-between; font-size: 14px; padding: 2px 0; }
      .summary-row.discount { color: #dc2626; }
      .total-block { background: ${docTitleColor}; color: #fff; padding: 8px 10px; margin: 8px 0 4px; border-radius: 4px; }
      .total-row { display: flex; justify-content: space-between; align-items: baseline; }
      .total-label { font-size: 14px; font-weight: 600; }
      .total-value { font-size: 22px; font-weight: 800; }
      .payment-row { display: flex; justify-content: space-between; font-size: 13px; margin-top: 4px; padding: 4px 0; }
      .payment-label { font-weight: 600; }
      .footer { margin-top: 12px; padding-top: 8px; border-top: 1px dashed #000; font-size: 11px; }
      .thanks { font-size: 16px; font-weight: 700; margin-top: 8px; }
      .fiscal { font-family: 'Courier New', monospace; letter-spacing: 1px; font-size: 12px; margin-top: 6px; }
      .placeholder-note { color: #b45309; font-size: 10px; margin-top: 4px; font-style: italic; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="center">
        <div class="header-title">ORDA POINT</div>
        <div class="doc-type">${escapeHtml(docTitle)}</div>
        ${copyBlock}
        <div class="header-sub" style="margin-top:6px;">${escapeHtml(preview.companyName)}</div>
        <div class="muted">${escapeHtml(preview.locationName)}</div>
        ${taxPayerBlock}
        ${kkmBlock}
      </div>
      <div class="line"></div>
      <div class="meta">
        <div><strong>Дата:</strong> ${escapeHtml(preview.saleDate)} ${escapeHtml(preview.saleTime)}</div>
        <div><strong>Смена:</strong> ${escapeHtml(formatShiftLabel(preview.shift))}</div>
        <div><strong>${isReturn ? 'Возврат' : 'Чек'} №:</strong> ${escapeHtml(preview.saleId?.slice(-6) || 'новый')}</div>
        <div><strong>Оператор:</strong> ${escapeHtml(preview.operatorName)}</div>
      </div>
      ${originalRefBlock}
      <div class="line"></div>
      <table>
        <tbody>${preview.lines
          .map(
            (line) => `
          <tr class="item-row">
            <td colspan="2">
              <div class="item-name">${escapeHtml(line.name)}</div>
              <div class="item-qty-price">
                ${line.quantity} × ${escapeHtml(formatMoney(line.unit_price))}
                <span style="float:right;font-weight:600;color:#000;">${escapeHtml(formatMoney(line.total))}</span>
              </div>
            </td>
          </tr>
        `,
          )
          .join('')}</tbody>
      </table>
      <div class="line"></div>
      <div class="summary-row"><span>Позиций</span><span>${itemsCount}</span></div>
      <div class="summary-row"><span>Всего штук</span><span>${totalQty}</span></div>
      <div class="summary-row"><span>Подытог</span><strong>${escapeHtml(formatMoney(preview.subtotal))}</strong></div>
      ${
        preview.discountAmount > 0
          ? `<div class="summary-row discount"><span>Скидка</span><strong>− ${escapeHtml(formatMoney(preview.discountAmount))}</strong></div>`
          : ''
      }
      ${
        preview.loyaltyDiscountAmount > 0
          ? `<div class="summary-row discount"><span>Бонусы</span><strong>− ${escapeHtml(formatMoney(preview.loyaltyDiscountAmount))}</strong></div>`
          : ''
      }
      <div class="total-block">
        <div class="total-row">
          <span class="total-label">${escapeHtml(totalLabel)}</span>
          <span class="total-value">${escapeHtml(formatMoney(preview.totalAmount))} ₸</span>
        </div>
      </div>
      <div class="payment-row">
        <span class="payment-label">${escapeHtml(paymentBadge(preview.paymentMethod))}</span>
        <strong>${escapeHtml(formatMoney(preview.totalAmount))} ₸</strong>
      </div>
      ${
        preview.paymentMethod === 'mixed'
          ? `
        <div class="payment-row" style="font-size:12px;color:#4b5563;">
          <span>↳ Наличные</span><span>${escapeHtml(formatMoney(preview.cashAmount))} ₸</span>
        </div>
        <div class="payment-row" style="font-size:12px;color:#4b5563;">
          <span>↳ Безналичный</span><span>${escapeHtml(formatMoney(preview.kaspiAmount))} ₸</span>
        </div>
      `
          : ''
      }
      ${vatBlock}
      ${customerBlock}
      ${commentBlock}
      ${ofdBlock}
      <div class="footer center">
        <div class="thanks">${escapeHtml(thanksText)}</div>
        ${copyFooter}
        <div class="fiscal">ФП: ${fiscalSign}</div>
        <div class="placeholder-note">фискализация: тестовый режим</div>
        ${footerExtra}
      </div>
    </div>
    <script>
      window.onload = () => {
        try { window.focus(); } catch (e) {}
        // 500мс — хватит даже на медленных принтерах чтобы стили применились
        setTimeout(() => { try { window.focus(); window.print(); } catch (e) {} }, 500);
      };
    </script>
  </body>
</html>`
}

/**
 * Строит HTML для чека БЕЗ авто-печати.
 * Используется для отображения в iframe внутри программы.
 */
export function buildReceiptHtmlForPreview(preview: SaleReceiptPreview) {
  // Та же разметка, но без window.print() в onload —
  // печать вызывается явно из родительского окна
  return buildReceiptHtml(preview).replace(
    /<script>[\s\S]*?<\/script>/,
    '',
  )
}

/**
 * Печать iframe (с уже готовым HTML внутри).
 * Запускает системный диалог печати, привязанный к ОСНОВНОМУ окну
 * (диалог не уходит «за» программу).
 */
export function printReceiptFromIframe(iframe: HTMLIFrameElement | null) {
  if (!iframe) return false
  try {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    return true
  } catch {
    return false
  }
}

/** Короткий beep через WebAudio (для подтверждения добавления/ошибки). */
let audioCtx: AudioContext | null = null

export function beep(type: 'ok' | 'error' = 'ok') {
  try {
    // Уважаем настройку оператора — если он отключил звуки, не пикаем
    const soundEnabled = window.localStorage.getItem('orda.soundEnabled') !== '0'
    if (!soundEnabled) return

    if (!audioCtx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return
      audioCtx = new Ctx()
    }
    const ctx = audioCtx!
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = type === 'ok' ? 880 : 220
    gain.gain.setValueAtTime(0.0001, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.01)
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (type === 'ok' ? 0.08 : 0.2))
    osc.start()
    osc.stop(ctx.currentTime + (type === 'ok' ? 0.1 : 0.25))
  } catch {
    /* без звука */
  }
}
