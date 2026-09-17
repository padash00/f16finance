/**
 * Дата и смена дохода по часам Казахстана, а не сервера (UTC).
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { kzKaspiBeforeMidnight, resolveKzShift } from '@/lib/core/kz-shift'

// 2026-09-17 в UTC-часах → по Алматы +5
const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 8, 17, h, m))

test('по часам: день 08–20, ночь 20–08, после полуночи — вчерашняя дата', () => {
  assert.deepEqual(resolveKzShift(utc(3)), { date: '2026-09-17', shift: 'day', afterMidnight: false }) // 08:00
  assert.deepEqual(resolveKzShift(utc(14, 59)), { date: '2026-09-17', shift: 'day', afterMidnight: false }) // 19:59
  assert.deepEqual(resolveKzShift(utc(15)), { date: '2026-09-17', shift: 'night', afterMidnight: false }) // 20:00
  assert.deepEqual(resolveKzShift(utc(19)), { date: '2026-09-17', shift: 'night', afterMidnight: true }) // 00:00 18-го → ночь 17-го
  assert.deepEqual(resolveKzShift(utc(21)), { date: '2026-09-17', shift: 'night', afterMidnight: true }) // 02:00 18-го
  assert.deepEqual(resolveKzShift(utc(2, 59)), { date: '2026-09-16', shift: 'night', afterMidnight: true }) // 07:59
})

test('тип открытой смены важнее часов', () => {
  // Дневную открыли в 07:50 — всё равно день сегодняшней даты
  assert.deepEqual(resolveKzShift(utc(2, 50), 'day'), { date: '2026-09-17', shift: 'day', afterMidnight: false })
  // Ночную открыли в 19:50 — ночь сегодняшней даты, до полуночи
  assert.deepEqual(resolveKzShift(utc(14, 50), 'night'), { date: '2026-09-17', shift: 'night', afterMidnight: false })
  // Ночную закрывают в 08:10 — всё ещё вчерашняя ночь
  assert.deepEqual(resolveKzShift(utc(3, 10), 'night'), { date: '2026-09-16', shift: 'night', afterMidnight: true })
  // custom — по часам
  assert.equal(resolveKzShift(utc(10), 'custom').shift, 'day')
})

test('kaspi_before_midnight: день — null, ночь до полуночи — вся сумма, после — 0', () => {
  assert.equal(kzKaspiBeforeMidnight(resolveKzShift(utc(10)), 500), null)
  assert.equal(kzKaspiBeforeMidnight(resolveKzShift(utc(16)), 500), 500)
  assert.equal(kzKaspiBeforeMidnight(resolveKzShift(utc(20)), 500), 0)
})
