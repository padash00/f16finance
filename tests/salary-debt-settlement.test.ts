import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateOperatorWeekSummary, isDebtDeductedFromSalary } from '@/lib/domain/salary'

// Долг вычитается из суммы к выплате. Значит в момент выплаты клуб эти деньги
// уже удержал — и закрытие долга не имеет права поднимать сумму к выплате
// задним числом. Иначе полностью выплаченная неделя оживает и показывает
// остаток ровно размером в долг: «Частично» вместо «Выплачено».
//
// Прод, 27.08.2026: начислено 44 000, долг 500, выдали 43 500 — ровно сколько
// причиталось. Долг закрылся, выпал из формулы, к выплате стало 44 000, и
// неделя показала остаток 500.

// ─── правило: какой долг остаётся в расчёте ───

test('долг активен — вычитается', () => {
  assert.equal(isDebtDeductedFromSalary({ status: 'active' }), true)
})

test('статус не проставлен — считаем активным (историческая строка)', () => {
  assert.equal(isDebtDeductedFromSalary({ status: null }), true)
  assert.equal(isDebtDeductedFromSalary({}), true)
})

test('удержан из зарплаты — продолжает вычитаться после закрытия', () => {
  assert.equal(isDebtDeductedFromSalary({ status: 'paid', settled_via: 'salary' }), true)
})

test('занесли деньгами мимо зарплаты — вычитаться перестаёт', () => {
  assert.equal(isDebtDeductedFromSalary({ status: 'paid', settled_via: 'cash' }), false)
})

test('закрыт до появления метки — ведёт себя как раньше, историю не трогаем', () => {
  assert.equal(isDebtDeductedFromSalary({ status: 'paid', settled_via: null }), false)
  assert.equal(isDebtDeductedFromSalary({ status: 'paid' }), false)
})

// ─── расчёт недели: сумма к выплате не скачет ───

const COMPANY = { id: 'c1', code: 'ARENA', name: 'Arena' }
const OPERATOR_ID = 'op-1'

const weekSummary = (debts: Array<{ amount: number; status: string; settled_via?: string | null }>) =>
  calculateOperatorWeekSummary({
    operatorId: OPERATOR_ID,
    companies: [COMPANY] as any,
    rules: [],
    incomes: [],
    adjustments: [
      // Начисление через премию: смены здесь не нужны, проверяем арифметику
      // «к выплате», а не расчёт ставки.
      { operator_id: OPERATOR_ID, amount: 44000, kind: 'bonus', company_id: COMPANY.id, status: 'active' },
    ] as any,
    debts: debts.map((debt) => ({
      operator_id: OPERATOR_ID,
      amount: debt.amount,
      company_id: COMPANY.id,
      status: debt.status,
      settled_via: debt.settled_via ?? null,
    })) as any,
  })

test('к выплате: начислено 44 000 минус активный долг 500 = 43 500', () => {
  const summary = weekSummary([{ amount: 500, status: 'active' }])
  assert.equal(summary.debtAmount, 500)
  assert.equal(summary.netAmount, 43500)
})

test('ИНВАРИАНТ: закрытие долга удержанием не меняет сумму к выплате', () => {
  const before = weekSummary([{ amount: 500, status: 'active' }])
  const after = weekSummary([{ amount: 500, status: 'paid', settled_via: 'salary' }])

  assert.equal(after.netAmount, before.netAmount)
  assert.equal(after.debtAmount, before.debtAmount)
  // Выплатили 43 500 — остаток обязан остаться нулём, а не стать 500.
  assert.equal(after.netAmount - 43500, 0)
})

test('долг, занесённый деньгами, из суммы к выплате уходит', () => {
  const after = weekSummary([{ amount: 500, status: 'paid', settled_via: 'cash' }])
  assert.equal(after.debtAmount, 0)
  assert.equal(after.netAmount, 44000)
})

test('«ещё открыт» отделён от «вычитается»: удержанный долг закрывать нечем', () => {
  const withheld = weekSummary([{ amount: 500, status: 'paid', settled_via: 'salary' }])
  assert.equal(withheld.debtAmount, 500, 'из зарплаты вычтен')
  assert.equal(withheld.debtActiveAmount, 0, 'но закрывать его второй раз нельзя')

  const open = weekSummary([{ amount: 500, status: 'active' }])
  assert.equal(open.debtActiveAmount, 500)
})

test('смесь: удержанный 500 и открытый 1 600 — вычитаются оба, закрыть можно один', () => {
  const summary = weekSummary([
    { amount: 500, status: 'paid', settled_via: 'salary' },
    { amount: 1600, status: 'active' },
  ])
  assert.equal(summary.debtAmount, 2100)
  assert.equal(summary.debtActiveAmount, 1600)
  assert.equal(summary.netAmount, 44000 - 2100)
})
