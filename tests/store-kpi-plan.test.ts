import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_STORE_KPI_SETTINGS,
  buildRevenueBaseline,
  computeMonthlyIndex,
  computeShiftPlan,
  resolveBonus,
  roundUpTo,
  type ShiftFact,
} from '@/lib/domain/store-kpi'

// ─── Подготовка ─────────────────────────────────────────────────────────────

function weekly(start: string, count: number): string[] {
  const [y, m, d] = start.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const dt = new Date(y, m - 1, d + i * 7)
    out.push(
      `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`,
    )
  }
  return out
}

function fact(date: string, revenue: number, patch: Partial<ShiftFact> = {}): ShiftFact {
  return {
    company_id: 'shop',
    date,
    shift: 'day',
    cashier_id: 'hist',
    revenue,
    gross_revenue: revenue,
    refunds: 0,
    receipts: 40,
    items: 80,
    lines: 80,
    receipts_2plus: 20,
    receipts_3plus: 8,
    attach_opportunities: 16,
    attach_success: 10,
    cogs: 30_000,
    discount_amount: 0,
    discounted_receipts: 0,
    unique_skus: 18,
    ...patch,
  }
}

// Десять понедельничных смен: 60k…105k с шагом 5k.
const REVENUES = [60_000, 65_000, 70_000, 75_000, 80_000, 85_000, 90_000, 95_000, 100_000, 105_000]
const HISTORY: ShiftFact[] = weekly('2026-01-05', 10).map((d, i) => fact(d, REVENUES[i]))

const REVENUE_BASE = buildRevenueBaseline(HISTORY, DEFAULT_STORE_KPI_SETTINGS)
const TARGET = { company_id: 'shop', date: '2026-03-16', shift: 'day' as const }

function planAt(monthlyIndex = 1) {
  return computeShiftPlan(REVENUE_BASE, TARGET, monthlyIndex, DEFAULT_STORE_KPI_SETTINGS)
}

// ─── Округление ─────────────────────────────────────────────────────────────

test('порог округляется вверх до шага — план должен запоминаться', () => {
  assert.equal(roundUpTo(81_200, 5_000), 85_000)
  assert.equal(roundUpTo(80_000, 5_000), 80_000)
  assert.equal(roundUpTo(0, 5_000), 0)
})

// ─── Пороги смены ───────────────────────────────────────────────────────────

test('уровни растут строго и берутся из распределения сегмента', () => {
  const plan = planAt()
  assert.ok(plan, 'план должен построиться на десяти сменах')
  assert.ok(plan!.control < plan!.b1)
  assert.ok(plan!.b1 < plan!.b2)
  assert.ok(plan!.b2 < plan!.b3)
  assert.equal(plan!.sample, 10)
})

test('на короткой истории план не назначается вовсе', () => {
  const thin = buildRevenueBaseline(
    weekly('2026-01-05', 3).map((d) => fact(d, 80_000)),
    DEFAULT_STORE_KPI_SETTINGS,
  )
  // План по трём сменам был бы случайным числом, за которое платят деньги.
  assert.equal(computeShiftPlan(thin, TARGET, 1, DEFAULT_STORE_KPI_SETTINGS), null)
})

test('слипшиеся после округления уровни разводятся на шаг', () => {
  // Все смены одинаковые: все перцентили дают одно и то же число.
  const flat = buildRevenueBaseline(
    weekly('2026-01-05', 10).map((d) => fact(d, 80_000)),
    DEFAULT_STORE_KPI_SETTINGS,
  )
  const plan = computeShiftPlan(flat, TARGET, 1, DEFAULT_STORE_KPI_SETTINGS)
  assert.ok(plan)
  // Иначе B2 брался бы ровно тогда же, когда B1 — то есть одного бонуса не
  // существует. Разводится и CONTROL с B1: отметка «разобраться» обязана быть
  // ниже первого оплачиваемого уровня.
  assert.equal(plan!.control, 80_000)
  assert.equal(plan!.b1, 85_000)
  assert.equal(plan!.b2, 90_000)
  assert.equal(plan!.b3, 95_000)
})

test('месячный индекс двигает всю лестницу целиком', () => {
  const base = planAt(1)
  const raised = planAt(1.1)
  assert.ok(base && raised)
  assert.ok(raised!.b1 >= base!.b1)
  assert.ok(raised!.b3 >= base!.b3)
})

test('планка рекорда не подкручивается месячным индексом', () => {
  const base = planAt(1)
  const raised = planAt(1.2)
  // Рекорд должен быть настоящим: иначе его «назначают», а не ставят.
  assert.equal(raised!.record_threshold, base!.record_threshold)
})

// ─── Выплата ────────────────────────────────────────────────────────────────

test('платится максимальный уровень, а не сумма уровней', () => {
  const plan = planAt()!
  const outcome = resolveBonus(plan.b3, plan, DEFAULT_STORE_KPI_SETTINGS)
  assert.equal(outcome.level, 'b3')
  // 5 000, а не 2 000 + 3 000 + 5 000.
  assert.equal(outcome.amount, DEFAULT_STORE_KPI_SETTINGS.b3_amount)
})

test('рекорд заменяет B3, а не добавляется к нему', () => {
  const plan = planAt()!
  const outcome = resolveBonus(plan.record_threshold! + 1_000, plan, DEFAULT_STORE_KPI_SETTINGS)
  assert.equal(outcome.level, 'record')
  assert.equal(outcome.amount, DEFAULT_STORE_KPI_SETTINGS.record_amount)
})

test('выручка ниже CONTROL — это повод разобраться, а не штраф', () => {
  const plan = planAt()!
  const outcome = resolveBonus(plan.control - 10_000, plan, DEFAULT_STORE_KPI_SETTINGS)
  assert.equal(outcome.review, true)
  assert.equal(outcome.level, 'none')
  // Отрицательных сумм в модуле нет вообще.
  assert.equal(outcome.amount, 0)
})

test('продавцу видно, сколько осталось до следующего уровня', () => {
  const plan = planAt()!
  const outcome = resolveBonus(plan.b1 + 1_000, plan, DEFAULT_STORE_KPI_SETTINGS)
  assert.equal(outcome.level, 'b1')
  assert.equal(outcome.next_level, 'b2')
  assert.equal(outcome.to_next, plan.b2 - (plan.b1 + 1_000))
})

test('на пороге уровень засчитывается, а не «почти взят»', () => {
  const plan = planAt()!
  assert.equal(resolveBonus(plan.b2, plan, DEFAULT_STORE_KPI_SETTINGS).level, 'b2')
})

// ─── Месячный индекс ────────────────────────────────────────────────────────

const MONTHLY_BASE = {
  asOf: '2026-08-25',
  history: HISTORY,
  trend: [] as { date: string; actual: number; expected: number }[],
  academicPeriods: [],
  specialDays: [],
  previousIndex: null,
  settings: DEFAULT_STORE_KPI_SETTINGS,
}

test('без данных индекс остаётся нейтральным, а не выдумывается', () => {
  const result = computeMonthlyIndex({
    ...MONTHLY_BASE,
    targetMonth: '2026-09',
    history: [],
  })
  assert.equal(result.value, 1)
  assert.ok(result.confidence <= 0.3, `уверенность должна быть низкой: ${result.confidence}`)
  assert.ok(result.notes.length > 0)
})

test('индекс не выходит за границы и требует подтверждения, если упёрся', () => {
  const settings = { ...DEFAULT_STORE_KPI_SETTINGS, monthly_index_max: 1.05 }
  const result = computeMonthlyIndex({
    ...MONTHLY_BASE,
    settings,
    targetMonth: '2026-03',
    trend: weekly('2026-07-27', 5).map((d) => ({ date: d, actual: 200_000, expected: 100_000 })),
    asOf: '2026-08-25',
  })
  assert.ok(result.value <= 1.05)
  assert.equal(result.approval_required, true)
  assert.ok(result.approval_reason)
})

test('большой скачок относительно прошлого месяца не применяется автоматически', () => {
  const result = computeMonthlyIndex({
    ...MONTHLY_BASE,
    targetMonth: '2026-09',
    previousIndex: 0.9,
  })
  // Разница 1.00 против 0.90 больше допустимых 0.05.
  assert.equal(result.approval_required, true)
})

test('небольшая правка применяется без подтверждения', () => {
  const result = computeMonthlyIndex({
    ...MONTHLY_BASE,
    targetMonth: '2026-09',
    previousIndex: 0.98,
  })
  assert.equal(result.approval_required, false)
})

test('тренд считается против ожидания, а не по абсолютной выручке', () => {
  const trend = [
    { date: '2026-08-20', actual: 120_000, expected: 100_000 },
    { date: '2026-08-21', actual: 110_000, expected: 100_000 },
    { date: '2026-08-22', actual: 130_000, expected: 100_000 },
  ]
  const result = computeMonthlyIndex({ ...MONTHLY_BASE, targetMonth: '2026-09', trend })
  const component = result.components.find((c) => c.key === 'recent_trend')!
  assert.equal(component.available, true)
  assert.ok(component.value > 1, `тренд должен быть выше нормы: ${component.value}`)
})

test('данные после расчётной даты в тренд не попадают', () => {
  const trend = [
    { date: '2026-08-20', actual: 100_000, expected: 100_000 },
    { date: '2026-08-21', actual: 100_000, expected: 100_000 },
    { date: '2026-08-22', actual: 100_000, expected: 100_000 },
    // Это будущее относительно asOf: знать его на 25-е мы не могли.
    { date: '2026-08-28', actual: 900_000, expected: 100_000 },
  ]
  const result = computeMonthlyIndex({ ...MONTHLY_BASE, targetMonth: '2026-09', trend })
  const component = result.components.find((c) => c.key === 'recent_trend')!
  assert.equal(component.value, 1)
})

test('учебный период поднимает свою часть индекса', () => {
  const result = computeMonthlyIndex({
    ...MONTHLY_BASE,
    targetMonth: '2026-09',
    academicPeriods: [{ start_date: '2026-09-01', end_date: '2026-09-30', index: 1.2 }],
  })
  const component = result.components.find((c) => c.key === 'academic_context')!
  assert.equal(component.available, true)
  assert.equal(component.value, 1.2)
  assert.ok(result.value > 1)
})

test('каждый компонент объясняет свой вклад — без «модель так решила»', () => {
  const result = computeMonthlyIndex({
    ...MONTHLY_BASE,
    targetMonth: '2026-09',
    academicPeriods: [{ start_date: '2026-09-01', end_date: '2026-09-30', index: 1.2 }],
  })
  for (const c of result.components) {
    assert.ok(c.explanation.length > 0, `${c.key} без объяснения`)
  }
  assert.ok(result.drivers_positive.length > 0)
})
