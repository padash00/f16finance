import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeSimulationProjection, tariffRatePerHour } from '@/lib/domain/simulation'

// Тариф «2+1 за 600»: три часа за 600 ₸ — 200 ₸/час.
const tariff21 = { id: 't1', name: '2+1', paid_hours: 2, bonus_hours: 1, price: 600 }
// Тариф «Ночь»: восемь часов за 3200 ₸ — 400 ₸/час.
const night = { id: 't2', name: 'Ночь', paid_hours: 8, bonus_hours: 0, price: 3200 }

// ─── Ставка тарифа ──────────────────────────────────────────────────────────

test('ставка часа делит цену на оплаченные и бонусные часы вместе', () => {
  assert.equal(tariffRatePerHour(tariff21), 200)
})

test('тариф без часов не даёт ставку, а не бесконечность', () => {
  assert.equal(tariffRatePerHour({ id: 'x', paid_hours: 0, bonus_hours: 0, price: 1000 }), 0)
})

test('дробное значение с запятой читается как число', () => {
  assert.equal(tariffRatePerHour({ id: 'x', paid_hours: '1,5', bonus_hours: 0, price: 300 }), 200)
})

test('тарифы возвращаются с посчитанной ставкой', () => {
  const result = computeSimulationProjection([], [tariff21, night])
  assert.deepEqual(result.tariffs.map((t) => [t.name, t.rate_per_hour]), [
    ['2+1', 200],
    ['Ночь', 400],
  ])
})

test('тариф без идентификатора отбрасывается', () => {
  // Такой не сослать из микса зоны, и в списке он только путал бы.
  const result = computeSimulationProjection([], [{ id: '', paid_hours: 1, price: 100 }])
  assert.equal(result.tariffs.length, 0)
})

// ─── Ставка зоны ────────────────────────────────────────────────────────────

test('ставка зоны — средневзвешенная по долям тарифов', () => {
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: 1, assumed_occupancy_hours: 1, tariff_mix: [
      { tariff_id: 't1', share_pct: 50 },
      { tariff_id: 't2', share_pct: 50 },
    ] }],
    [tariff21, night],
  )
  assert.equal(result.zones[0].blended_rate, 300)
  assert.equal(result.zones[0].share_sum, 100)
})

test('доля несуществующего тарифа не считается заполненной', () => {
  // Тариф удалили, а долю в зоне забыли — иначе микс выглядел бы полным на
  // 100 %, хотя половина устройств не приносит ничего.
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: 1, assumed_occupancy_hours: 1, tariff_mix: [
      { tariff_id: 't1', share_pct: 50 },
      { tariff_id: 'удалённый', share_pct: 50 },
    ] }],
    [tariff21],
  )
  assert.equal(result.zones[0].blended_rate, 100)
  assert.equal(result.zones[0].share_sum, 50)
})

test('зона без микса тарифов ничего не приносит', () => {
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: 30, assumed_occupancy_hours: 8, tariff_mix: [] }],
    [tariff21],
  )
  assert.equal(result.zones[0].potential_per_day, 0)
})

// ─── Потенциал ──────────────────────────────────────────────────────────────

test('потенциал зоны = устройства × часы × ставка, месяц — тридцать таких дней', () => {
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: 10, assumed_occupancy_hours: 5, tariff_mix: [
      { tariff_id: 't1', share_pct: 100 },
    ] }],
    [tariff21],
  )
  assert.equal(result.zones[0].per_device_per_day, 1_000)   // 5 ч × 200 ₸
  assert.equal(result.zones[0].potential_per_day, 10_000)
  assert.equal(result.zones[0].potential_per_month, 300_000)
  assert.equal(result.potential_per_month, 300_000)
})

test('зоны складываются в общий потенциал', () => {
  const result = computeSimulationProjection(
    [
      { id: 'z1', device_count: 10, assumed_occupancy_hours: 5, tariff_mix: [{ tariff_id: 't1', share_pct: 100 }] },
      { id: 'z2', device_count: 5, assumed_occupancy_hours: 4, tariff_mix: [{ tariff_id: 't2', share_pct: 100 }] },
    ],
    [tariff21, night],
  )
  assert.equal(result.total_devices, 15)
  assert.equal(result.potential_per_day, 18_000)            // 10 000 + 5 × 4 × 400
})

// ─── Сравнение с фактом ─────────────────────────────────────────────────────

test('разрыв — это потенциал минус факт за месяц', () => {
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: 10, assumed_occupancy_hours: 5, tariff_mix: [{ tariff_id: 't1', share_pct: 100 }] }],
    [tariff21],
    { revenue_per_day: 5_000, revenue_per_month: 150_000 },
  )
  assert.equal(result.fact_per_month, 150_000)
  assert.equal(result.gap_per_month, 150_000)
})

test('факт выше потенциала даёт отрицательный разрыв, а не ноль', () => {
  // Так и должно быть: в выручку входят бар и допуслуги, которых в модели нет.
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: 1, assumed_occupancy_hours: 1, tariff_mix: [{ tariff_id: 't1', share_pct: 100 }] }],
    [tariff21],
    { revenue_per_day: 1_000, revenue_per_month: 30_000 },
  )
  assert.equal(result.gap_per_month, 6_000 - 30_000)
})

// ─── Обратный расчёт загрузки ───────────────────────────────────────────────

test('обратный расчёт делит факт на выручку часа полной загрузки', () => {
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: 10, assumed_occupancy_hours: 8, tariff_mix: [{ tariff_id: 't1', share_pct: 100 }] }],
    [tariff21],
    { revenue_per_day: 6_000 },
  )
  assert.equal(result.capacity_rate_per_hour, 2_000)        // 10 устройств × 200 ₸/час
  assert.equal(result.implied_occupancy_hours, 3)
  assert.equal(result.assumed_occupancy_hours, 8)
  assert.equal(result.occupancy_gap_hours, -5)
})

test('без тарифов обратного расчёта нет, а не ноль часов', () => {
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: 10, assumed_occupancy_hours: 8, tariff_mix: [] }],
    [],
    { revenue_per_day: 6_000 },
  )
  assert.equal(result.implied_occupancy_hours, null)
  assert.equal(result.occupancy_gap_hours, null)
})

test('заложенная загрузка взвешена по устройствам, а не по зонам', () => {
  // Иначе зона из двух приставок весила бы столько же, сколько зал из тридцати ПК.
  const result = computeSimulationProjection(
    [
      { id: 'z1', device_count: 30, assumed_occupancy_hours: 10, tariff_mix: [] },
      { id: 'z2', device_count: 10, assumed_occupancy_hours: 2, tariff_mix: [] },
    ],
    [tariff21],
  )
  assert.equal(result.assumed_occupancy_hours, 8)           // (30×10 + 10×2) ÷ 40
})

test('пустая конфигурация не ломает расчёт', () => {
  const result = computeSimulationProjection([], [], null)
  assert.equal(result.potential_per_month, 0)
  assert.equal(result.total_devices, 0)
  assert.equal(result.assumed_occupancy_hours, null)
  assert.equal(result.implied_occupancy_hours, null)
})

test('отрицательное количество устройств считается нулём', () => {
  const result = computeSimulationProjection(
    [{ id: 'z1', device_count: -5, assumed_occupancy_hours: 8, tariff_mix: [{ tariff_id: 't1', share_pct: 100 }] }],
    [tariff21],
  )
  assert.equal(result.total_devices, 0)
  assert.equal(result.potential_per_day, 0)
})
