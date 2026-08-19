import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildOperatorMoney } from '@/lib/domain/operator-analytics'

const income = (over: Partial<any> = {}) => ({
  date: '2026-08-10',
  company_id: 'c1',
  shift: 'day',
  operator_id: 'op1',
  cash_amount: 10_000,
  kaspi_amount: 5_000,
  online_amount: 0,
  card_amount: 0,
  ...over,
})

test('оборот, смены и дни считаются по оператору', () => {
  const { rows, totals } = buildOperatorMoney({
    incomes: [
      income(),
      // Та же дата и точка, но ночная смена — это вторая смена.
      income({ shift: 'night', cash_amount: 20_000, kaspi_amount: 0 }),
      // Другой день — и второй день в счётчике.
      income({ date: '2026-08-11', cash_amount: 5_000, kaspi_amount: 0 }),
    ],
    adjustments: [],
    debts: [],
    operatorIds: ['op1'],
  })

  assert.equal(rows.length, 1)
  assert.equal(rows[0].turnover, 40_000)
  assert.equal(rows[0].shifts, 3)
  assert.equal(rows[0].days, 2)
  assert.equal(rows[0].avg_per_shift, 40_000 / 3)
  assert.equal(rows[0].share, 1)
  assert.equal(totals.turnover, 40_000)
})

test('выручка без оператора уходит в «не распределено», а не на кого-то', () => {
  const { rows, totals } = buildOperatorMoney({
    incomes: [income({ operator_id: null }), income()],
    adjustments: [],
    debts: [],
    operatorIds: ['op1'],
  })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].turnover, 15_000)
  assert.equal(totals.unattributed_turnover, 15_000)
})

test('выручка чужого оператора не приписывается своим', () => {
  const { rows, totals } = buildOperatorMoney({
    incomes: [income({ operator_id: 'stranger' })],
    adjustments: [],
    debts: [],
    operatorIds: ['op1'],
  })
  assert.equal(rows.length, 0)
  assert.equal(totals.unattributed_turnover, 15_000)
  assert.equal(totals.turnover, 0)
})

test('премии, штрафы и долги складываются в чистый итог, аванс — нет', () => {
  const { rows } = buildOperatorMoney({
    incomes: [income()],
    adjustments: [
      { operator_id: 'op1', kind: 'bonus', amount: 8_000 },
      { operator_id: 'op1', kind: 'fine', amount: 3_000 },
      // Аванс — свои же деньги вперёд: он не награда и не наказание.
      { operator_id: 'op1', kind: 'advance', amount: 20_000 },
    ],
    debts: [{ operator_id: 'op1', amount: 2_000 }],
    operatorIds: ['op1'],
  })

  assert.equal(rows[0].manual_plus, 8_000)
  assert.equal(rows[0].manual_minus, 3_000)
  assert.equal(rows[0].auto_debts, 2_000)
  assert.equal(rows[0].advances, 20_000)
  assert.equal(rows[0].net_effect, 8_000 - 3_000 - 2_000)
})

test('нулевые и отрицательные суммы не создают строк', () => {
  const { rows, totals } = buildOperatorMoney({
    incomes: [income({ cash_amount: 0, kaspi_amount: 0 })],
    adjustments: [{ operator_id: 'op1', kind: 'bonus', amount: 0 }],
    debts: [{ operator_id: 'op1', amount: -5 }],
    operatorIds: ['op1'],
  })
  assert.equal(rows.length, 0)
  assert.equal(totals.turnover, 0)
})
