/**
 * Письмо с чеком продажи.
 *
 * Здесь охраняются три вещи, которые ломаются незаметно:
 *  — адрес с опечаткой не должен уйти в очередь и молча упасть через час;
 *  — название из базы не должно ломать HTML письма (магазин «<Дастан>»);
 *  — повторы должны кончаться, а не крутиться вечно на мёртвом ящике.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MAX_ATTEMPTS,
  formatSoldAt,
  nextRetryDelayMs,
  normalizeEmail,
  renderSaleReceiptEmail,
  sellerName,
  type ReceiptEmailData,
} from '@/lib/domain/sale-receipt-email'

function receipt(patch: Partial<ReceiptEmailData> = {}): ReceiptEmailData {
  return {
    saleNumber: 1047,
    shiftNumber: 212,
    cashier: 'Айгерим Т.',
    soldAt: '2026-09-24T08:15:00Z',
    pointName: 'Магазин «Дастан»',
    requisites: { name: 'ИП «Сапар»', bin: '901231300123', address: 'г. Алматы, ул. Абая, 10' },
    items: [
      { name: 'Энергетик 0,45 л', quantity: 2, unitPrice: 690, total: 1380 },
      { name: 'Шоколад 90 г', quantity: 1, unitPrice: 2260, total: 2260 },
    ],
    total: 3640,
    cash: 2000,
    kaspi: 1640,
    paymentMethod: 'mixed',
    onlineUrl: 'https://sapar.ordaops.kz/r/2f1c9a7e-0000-4000-8000-000000000001',
    ...patch,
  }
}

// ─── Адрес ───────────────────────────────────────────────

test('нормальный адрес приводится к нижнему регистру и без пробелов', () => {
  assert.equal(normalizeEmail('  Aigerim.T@Mail.KZ '), 'aigerim.t@mail.kz')
})

test('адреса с опечатками отбрасываются', () => {
  for (const bad of [
    '',
    'aigerim',
    'aigerim@',
    '@mail.kz',
    'aigerim@mail',
    'aigerim@@mail.kz',
    'aigerim@mail..kz',
    'aigerim@.mail.kz',
    'aigerim@mail.kz.',
    'aigerim @mail.kz',
    'aigerim@mail.k',
    '<aigerim@mail.kz>',
    'aigerim@mail.kz, boss@mail.kz',
  ]) {
    assert.equal(normalizeEmail(bad), null, `должен быть отвергнут: «${bad}»`)
  }
})

test('кириллица в домене не проходит — такие адреса почти всегда опечатка раскладки', () => {
  assert.equal(normalizeEmail('айгерим@почта.кз'), null)
})

test('null и не-строки не роняют проверку', () => {
  assert.equal(normalizeEmail(null), null)
  assert.equal(normalizeEmail(undefined), null)
  assert.equal(normalizeEmail(42), null)
})

// ─── Повторы ─────────────────────────────────────────────

test('паузы между повторами растут', () => {
  const delays = [1, 2, 3, 4].map((n) => nextRetryDelayMs(n) as number)
  for (let i = 1; i < delays.length; i++) assert.ok(delays[i] > delays[i - 1])
})

test('после пятой неудачи повторов больше нет', () => {
  assert.equal(nextRetryDelayMs(MAX_ATTEMPTS), null)
  assert.equal(nextRetryDelayMs(MAX_ATTEMPTS + 3), null)
})

// ─── Письмо ──────────────────────────────────────────────

test('тема письма: номер чека и продавец', () => {
  const { subject } = renderSaleReceiptEmail(receipt())
  assert.equal(subject, 'Чек №1047 — ИП «Сапар»')
})

test('продавец — юрлицо из реквизитов, иначе название точки', () => {
  assert.equal(sellerName(receipt()), 'ИП «Сапар»')
  assert.equal(sellerName(receipt({ requisites: { name: '', bin: '', address: '' } })), 'Магазин «Дастан»')
})

test('в письме все позиции, итог и ссылка на онлайн-чек', () => {
  const { text, html } = renderSaleReceiptEmail(receipt())
  for (const body of [text, html]) {
    assert.ok(body.includes('Энергетик 0,45 л'))
    assert.ok(body.includes('Шоколад 90 г'))
    assert.ok(body.includes('/r/2f1c9a7e-0000-4000-8000-000000000001'))
  }
  assert.ok(text.includes('ИТОГО'))
})

test('смешанная оплата раскладывается на наличные и безнал', () => {
  const { text } = renderSaleReceiptEmail(receipt())
  assert.match(text, /Наличные: 2\s000,00 ₸/)
  assert.match(text, /Безналичный: 1\s640,00 ₸/)
})

test('опасные символы в названиях экранируются, HTML не ломается', () => {
  const { html } = renderSaleReceiptEmail(
    receipt({
      requisites: { name: '<script>alert(1)</script>', bin: '', address: '' },
      items: [{ name: 'Товар "в кавычках" & <тег>', quantity: 1, unitPrice: 100, total: 100 }],
    }),
  )
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(html.includes('&quot;в кавычках&quot; &amp; &lt;тег&gt;'))
})

test('письмо честно называет себя копией, а не фискальным чеком', () => {
  const { text, html } = renderSaleReceiptEmail(receipt())
  assert.ok(text.includes('электронная копия чека'))
  assert.ok(html.includes('Электронная копия чека'))
})

test('время продажи — по Казахстану, а не по часам сервера', () => {
  // 08:15 UTC = 13:15 в Кызылорде (UTC+5)
  assert.ok(formatSoldAt('2026-09-24T08:15:00Z').includes('13:15'))
})

test('без ссылки на онлайн-чек кнопка не рисуется', () => {
  const { html } = renderSaleReceiptEmail(receipt({ onlineUrl: '' }))
  assert.ok(!html.includes('Открыть чек онлайн'))
})
