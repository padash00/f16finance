/**
 * Горизонт бронирования: докуда оператору разрешено обещать.
 *
 * Правило владельца: дневная смена может забронировать на ночь, ночная — не
 * может на следующий день. Смысл в том, чтобы никто не раздавал обязательства
 * сменам, которые об этом не знают.
 *
 * Все времена в тестах местные, казахстанские: граница смены — шесть утра по
 * часам клуба, а не по всемирному времени.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { checkBookingHorizon, operationalDayEnd } from '@/lib/core/booking-horizon'

/** Местное время Казахстана в объект Date. */
function local(iso: string): Date {
  return new Date(`${iso}+05:00`)
}

test('днём горизонт тянется до утра следующего дня', () => {
  // Дневная смена в два часа дня: ночь впереди, и бронировать на неё можно.
  const end = operationalDayEnd(local('2026-08-20T14:00:00'))
  assert.equal(end.toISOString(), local('2026-08-21T06:00:00').toISOString())
})

test('ночью после полуночи горизонт — сегодняшнее утро', () => {
  // Два часа ночи — это ещё вчерашние операционные сутки, и заканчиваются они
  // сегодня в шесть. Дальше начинается чужая смена.
  const end = operationalDayEnd(local('2026-08-21T02:00:00'))
  assert.equal(end.toISOString(), local('2026-08-21T06:00:00').toISOString())
})

test('ровно в шесть утра начинаются новые сутки', () => {
  const end = operationalDayEnd(local('2026-08-21T06:00:00'))
  assert.equal(end.toISOString(), local('2026-08-22T06:00:00').toISOString())
})

test('дневная смена бронирует на ночь — разрешено', () => {
  const now = local('2026-08-20T15:00:00')
  const check = checkBookingHorizon(local('2026-08-20T21:00:00'), local('2026-08-20T23:00:00'), now)
  assert.equal(check.ok, true)
})

test('дневная смена бронирует на глубокую ночь — тоже разрешено', () => {
  // Час ночи следующего календарного дня — это всё ещё те же операционные
  // сутки, и дневная смена вправе их занять.
  const now = local('2026-08-20T15:00:00')
  const check = checkBookingHorizon(local('2026-08-21T00:00:00'), local('2026-08-21T03:00:00'), now)
  assert.equal(check.ok, true)
})

test('дневная смена НЕ может бронировать на завтрашний вечер', () => {
  const now = local('2026-08-20T15:00:00')
  const check = checkBookingHorizon(local('2026-08-21T19:00:00'), local('2026-08-21T21:00:00'), now)
  assert.equal(check.ok, false)
  if (!check.ok) assert.equal(check.reason, 'beyond-horizon')
})

test('ночная смена НЕ может бронировать на следующий день', () => {
  // Главный случай из требования владельца.
  const now = local('2026-08-21T01:00:00')
  const check = checkBookingHorizon(local('2026-08-21T14:00:00'), local('2026-08-21T16:00:00'), now)
  assert.equal(check.ok, false)
  if (!check.ok) assert.equal(check.reason, 'beyond-horizon')
})

test('ночная смена бронирует внутри своей смены — разрешено', () => {
  const now = local('2026-08-21T01:00:00')
  const check = checkBookingHorizon(local('2026-08-21T03:00:00'), local('2026-08-21T05:00:00'), now)
  assert.equal(check.ok, true)
})

test('бронь, упирающаяся ровно в границу суток, проходит', () => {
  const now = local('2026-08-21T01:00:00')
  const check = checkBookingHorizon(local('2026-08-21T04:00:00'), local('2026-08-21T06:00:00'), now)
  assert.equal(check.ok, true)
})

test('бронь на минуту дольше границы уже не проходит', () => {
  const now = local('2026-08-21T01:00:00')
  const check = checkBookingHorizon(local('2026-08-21T04:00:00'), local('2026-08-21T06:01:00'), now)
  assert.equal(check.ok, false)
})

test('бронь в прошлое отклоняется', () => {
  const now = local('2026-08-20T15:00:00')
  const check = checkBookingHorizon(local('2026-08-20T10:00:00'), local('2026-08-20T12:00:00'), now)
  assert.equal(check.ok, false)
  if (!check.ok) assert.equal(check.reason, 'past')
})

test('бронь «на сейчас» проходит', () => {
  // Клиент стоит у двери и просит место через пять минут — это нормальная
  // работа, а не ошибка.
  const now = local('2026-08-20T15:00:00')
  const check = checkBookingHorizon(local('2026-08-20T15:05:00'), local('2026-08-20T17:00:00'), now)
  assert.equal(check.ok, true)
})
