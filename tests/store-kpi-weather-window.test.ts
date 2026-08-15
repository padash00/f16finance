/**
 * Погода в окне смены.
 *
 * Проверяется одно утверждение, ради которого всё и делалось: две смены
 * одного дня живут в разной погоде, и приписывать ночной кассиру дневную жару
 * нельзя. Иначе его слабая касса объясняется тем, чего он не видел.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  observationForWindow,
  shiftWindow,
  weatherBucket,
  weatherForShift,
  type HourlySeries,
  type WeatherObservation,
} from '@/lib/domain/store-kpi'

/** Ряд суток: жарко днём, прохладно ночью, гроза в 16:00. */
function summerDay(): HourlySeries {
  const t = Array.from({ length: 24 }, (_, h) => (h >= 10 && h <= 19 ? 33 : 18))
  const p = Array<number | null>(24).fill(0)
  p[16] = 6
  const c = Array<number | null>(24).fill(0)
  c[16] = 95 // гроза
  return {
    t,
    a: t,
    p,
    s: Array<number | null>(24).fill(0),
    w: Array<number | null>(24).fill(5),
    c,
  }
}

test('дневная смена видит жару и грозу, ночная — нет', () => {
  const hourly = new Map<string, HourlySeries>([['2026-07-12', summerDay()]])

  const day = observationForWindow('2026-07-12', { start: 9, hours: 12 }, hourly)
  const night = observationForWindow('2026-07-12', { start: 21, hours: 3 }, hourly)

  assert.equal(weatherBucket(day), 'rain', 'гроза в 16:00 попадает в дневную смену')
  assert.equal(day?.temperature_max, 33)

  assert.equal(weatherBucket(night), 'normal', 'ночью ни жары, ни дождя не было')
  assert.equal(night?.temperature_max, 18)
  assert.equal(night?.precipitation_mm, 0)
})

test('ночное окно переходит на следующие сутки', () => {
  const warm = summerDay()
  const snowy: HourlySeries = {
    t: Array<number | null>(24).fill(-15),
    a: Array<number | null>(24).fill(-20),
    p: Array<number | null>(24).fill(0.5),
    s: Array<number | null>(24).fill(2),
    w: Array<number | null>(24).fill(3),
    c: Array<number | null>(24).fill(73),
  }
  const hourly = new Map<string, HourlySeries>([
    ['2026-07-12', warm],
    ['2026-07-13', snowy],
  ])

  // Смена с 22:00 до 06:00 захватывает шесть часов следующих суток.
  const night = observationForWindow('2026-07-12', { start: 22, hours: 8 }, hourly)

  assert.equal(weatherBucket(night), 'snow', 'снег после полуночи обязан попасть в смену')
  assert.equal(night?.temperature_min, -15)
})

test('окно берётся из фактического времени смены, а не из типового', () => {
  const short = shiftWindow({
    shift: 'day',
    opened_at: '2026-07-12T14:00:00',
    closed_at: '2026-07-12T18:00:00',
    duration_minutes: 240,
  })
  assert.deepEqual(short, { start: 14, hours: 4 })

  const overnight = shiftWindow({
    shift: 'night',
    opened_at: '2026-07-12T21:00:00',
    closed_at: '2026-07-13T05:00:00',
    duration_minutes: null,
  })
  assert.deepEqual(overnight, { start: 21, hours: 8 }, 'переход через полночь считается верно')
})

test('без времени открытия окно типовое для смены', () => {
  assert.deepEqual(shiftWindow({ shift: 'day' }), { start: 9, hours: 12 })
  assert.deepEqual(shiftWindow({ shift: 'night' }), { start: 21, hours: 12 })
})

test('без почасового ряда берутся суточные значения, и это видно', () => {
  const daily = new Map<string, WeatherObservation>([
    [
      '2026-07-12',
      {
        day: '2026-07-12',
        temperature_max: 33,
        temperature_min: 18,
        precipitation_mm: 6,
        rain: true,
        snow: false,
      },
    ],
  ])

  const result = weatherForShift(
    { date: '2026-07-12', shift: 'night' },
    new Map(),
    daily,
  )

  assert.equal(result.windowed, false, 'откат к суткам обязан быть видимым')
  assert.equal(result.observation?.temperature_max, 33)
})

test('пустой ряд не выдаётся за известную погоду', () => {
  const empty: HourlySeries = {
    t: Array<number | null>(24).fill(null),
    a: Array<number | null>(24).fill(null),
    p: Array<number | null>(24).fill(null),
    s: Array<number | null>(24).fill(null),
    w: Array<number | null>(24).fill(null),
    c: Array<number | null>(24).fill(null),
  }
  const hourly = new Map<string, HourlySeries>([['2026-07-12', empty]])

  // Ноль осадков и «данных нет» — разные вещи. Второе обязано вернуть null,
  // иначе день молча станет «обычной погодой».
  assert.equal(observationForWindow('2026-07-12', { start: 9, hours: 12 }, hourly), null)
})

test('снег не считается дождём', () => {
  const snowy: HourlySeries = {
    t: Array<number | null>(24).fill(-8),
    a: Array<number | null>(24).fill(-12),
    p: Array<number | null>(24).fill(0.4),
    s: Array<number | null>(24).fill(1.5),
    w: Array<number | null>(24).fill(4),
    c: Array<number | null>(24).fill(75),
  }
  const observation = observationForWindow(
    '2026-01-20',
    { start: 9, hours: 12 },
    new Map([['2026-01-20', snowy]]),
  )

  assert.equal(observation?.snow, true)
  assert.equal(observation?.rain, false, 'мокрый снег не должен уезжать в корзину дождя')
  assert.equal(weatherBucket(observation), 'snow')
})
