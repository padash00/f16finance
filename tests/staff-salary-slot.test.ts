import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildStaffSalarySummary,
  calcStaffToPay,
  filterStaffAdjustmentsForSlot,
  getSalarySlotRange,
  slotForDate,
} from '@/lib/domain/staff-salary-slot'

const staff = (over: Partial<any> = {}) => ({
  id: 's1',
  full_name: 'Айгуль',
  monthly_salary: 300_000,
  ...over,
})

const adj = (over: Partial<any> = {}) => ({
  id: 'a1',
  staff_id: 's1',
  kind: 'fine',
  amount: 5_000,
  date: '2026-08-10',
  status: 'active',
  created_at: '2026-08-10T10:00:00Z',
  ...over,
})

const pay = (over: Partial<any> = {}) => ({
  id: 'p1',
  staff_id: 's1',
  pay_date: '2026-08-05',
  slot: 'first',
  amount: 150_000,
  created_at: '2026-08-05T10:00:00Z',
  ...over,
})

// ─── Границы половин месяца ──────────────────────────────────────────────────

test('слот: первая половина — с 1-го по 15-е', () => {
  assert.deepEqual(getSalarySlotRange('2026-08-07', 'first'), { from: '2026-08-01', to: '2026-08-15' })
})

test('слот: вторая половина кончается последним днём месяца', () => {
  assert.deepEqual(getSalarySlotRange('2026-02-20', 'second'), { from: '2026-02-16', to: '2026-02-28' })
})

test('слот определяется по числу: 15-е — ещё первая половина', () => {
  assert.equal(slotForDate('2026-08-15'), 'first')
  assert.equal(slotForDate('2026-08-16'), 'second')
})

// ─── Корректировки не удерживаются дважды ────────────────────────────────────

test('позиции до последней выплаты уже закрыты и в слот не попадают', () => {
  const before = adj({ id: 'old', date: '2026-08-02' })
  const after = adj({ id: 'new', date: '2026-08-09' })
  const rows = filterStaffAdjustmentsForSlot([before, after], 's1', [pay()], getSalarySlotRange('2026-08-10', 'first'))
  assert.deepEqual(rows.map((r) => r.id), ['new'])
})

test('в тот же день, что и выплата, считает время создания', () => {
  const earlier = adj({ id: 'earlier', date: '2026-08-05', created_at: '2026-08-05T09:00:00Z' })
  const later = adj({ id: 'later', date: '2026-08-05', created_at: '2026-08-05T11:00:00Z' })
  const rows = filterStaffAdjustmentsForSlot([earlier, later], 's1', [pay()], getSalarySlotRange('2026-08-10', 'first'))
  assert.deepEqual(rows.map((r) => r.id), ['later'])
})

test('погашенные корректировки не удерживаются', () => {
  const rows = filterStaffAdjustmentsForSlot([adj({ status: 'closed' })], 's1', [], null)
  assert.equal(rows.length, 0)
})

// ─── Сумма на руки ───────────────────────────────────────────────────────────

test('к выплате: половина оклада плюс бонусы минус удержания', () => {
  const calc = calcStaffToPay(
    staff(),
    [
      adj({ id: 'b', kind: 'bonus', amount: 20_000 }),
      adj({ id: 'f', kind: 'fine', amount: 5_000 }),
      adj({ id: 'd', kind: 'debt', amount: 3_000 }),
      adj({ id: 'v', kind: 'advance', amount: 30_000 }),
    ],
    [],
    null,
  )
  assert.equal(calc.half, 150_000)
  assert.equal(calc.toPay, 150_000 + 20_000 - 5_000 - 3_000 - 30_000)
})

test('строка из операторов без оклада даёт ноль, а не отрицание', () => {
  const calc = calcStaffToPay(staff({ monthly_salary: 0, source_type: 'operator' }), [], [], null)
  assert.equal(calc.toPay, 0)
})

// ─── Сводка для телефона ─────────────────────────────────────────────────────

test('сводка помечает свою строку и считает выплаченное за месяц', () => {
  const summary = buildStaffSalarySummary({
    staff: [staff(), staff({ id: 's2', full_name: 'Данияр', monthly_salary: 200_000 })],
    adjustments: [],
    payments: [pay(), pay({ id: 'p2', staff_id: 's2', amount: 100_000 })],
    today: '2026-08-20',
    meStaffId: 's2',
  })
  assert.equal(summary.slot, 'second')
  assert.equal(summary.rows.length, 2)
  assert.equal(summary.rows.find((r) => r.id === 's2')?.is_me, true)
  assert.equal(summary.rows.find((r) => r.id === 's1')?.is_me, false)
  assert.equal(summary.rows.find((r) => r.id === 's2')?.paid_this_month, 100_000)
  assert.equal(summary.totals.toPay, 150_000 + 100_000)
})

test('месяц закрыт, когда проведены обе выплаты', () => {
  const summary = buildStaffSalarySummary({
    staff: [staff()],
    adjustments: [],
    payments: [pay(), pay({ id: 'p2', slot: 'second', pay_date: '2026-08-20' })],
    today: '2026-08-25',
    meStaffId: null,
  })
  assert.equal(summary.rows[0].month_closed, true)
  assert.equal(summary.rows[0].paid_this_month, 300_000)
})

test('выплата прошлого месяца не считается выплаченной в этом', () => {
  const summary = buildStaffSalarySummary({
    staff: [staff()],
    adjustments: [],
    payments: [pay({ pay_date: '2026-07-05' })],
    today: '2026-08-10',
    meStaffId: null,
  })
  assert.equal(summary.rows[0].paid_this_month, 0)
  assert.equal(summary.rows[0].month_closed, false)
})

test('уволенный остаётся в сводке: с ним и остаётся незакрытый расчёт', () => {
  const summary = buildStaffSalarySummary({
    staff: [staff({ is_active: false, dismissal_date: '2026-08-04' })],
    adjustments: [],
    payments: [],
    today: '2026-08-10',
    meStaffId: null,
  })
  assert.equal(summary.rows.length, 1)
  assert.equal(summary.rows[0].is_active, false)
  assert.equal(summary.rows[0].dismissal_date, '2026-08-04')
})

// ─── Уволенный не начисляет себе половину оклада вечно ───────────────────────

test('уволенный до начала половины месяца ничего не начисляет', () => {
  const calc = calcStaffToPay(
    staff({ dismissal_date: '2026-07-20' }),
    [],
    [],
    getSalarySlotRange('2026-08-10', 'first'),
  )
  assert.equal(calc.half, 0)
  assert.equal(calc.toPay, 0)
})

test('уволенный посреди половины получает за отработанные дни', () => {
  // Ушёл 5-го: отработал 1–5 августа, пять дней из 31 при окладе 300 000.
  const calc = calcStaffToPay(
    staff({ dismissal_date: '2026-08-05' }),
    [],
    [],
    getSalarySlotRange('2026-08-12', 'first'),
  )
  assert.equal(calc.half, Math.round((300_000 * 5) / 31))
})

test('уволенный последним днём половины получает её целиком', () => {
  const calc = calcStaffToPay(
    staff({ dismissal_date: '2026-08-15' }),
    [],
    [],
    getSalarySlotRange('2026-08-12', 'first'),
  )
  assert.equal(calc.half, 150_000)
})

test('за уволенным остаётся долг, даже когда начислять нечего', () => {
  const calc = calcStaffToPay(
    staff({ dismissal_date: '2026-07-20' }),
    [adj({ kind: 'debt', amount: 12_000, date: '2026-07-18' })],
    [],
    getSalarySlotRange('2026-08-10', 'first'),
  )
  assert.equal(calc.toPay, -12_000)
})

test('в сводке уволенные идут после работающих', () => {
  const summary = buildStaffSalarySummary({
    staff: [
      staff({ id: 'gone', full_name: 'Ушедший', is_active: false, dismissal_date: '2026-08-02' }),
      staff({ id: 'here', full_name: 'Работающий' }),
    ],
    adjustments: [],
    payments: [],
    today: '2026-08-20',
    meStaffId: null,
  })
  assert.deepEqual(summary.rows.map((r) => r.id), ['here', 'gone'])
  // Вторая половина месяца начинается после увольнения — начислять нечего.
  assert.equal(summary.rows[1].toPay, 0)
})

test('сводка называет выплаченные половины, чтобы не платить дважды', () => {
  const summary = buildStaffSalarySummary({
    staff: [staff()],
    adjustments: [],
    payments: [pay({ slot: 'first' })],
    today: '2026-08-20',
    meStaffId: null,
  })
  assert.deepEqual(summary.rows[0].paid_slots, ['first'])
  assert.equal(summary.rows[0].month_closed, false)
})

// ─── Доп. выходы: единственный «график» окладного сотрудника ─────────────────

test('доп. выходы месяца собираются по подписи и попадают в строку', () => {
  const summary = buildStaffSalarySummary({
    staff: [staff()],
    adjustments: [
      adj({ id: 'e1', kind: 'bonus', amount: 9_000, date: '2026-08-19', comment: 'Доп. выход' }),
      adj({ id: 'e2', kind: 'bonus', amount: 9_000, date: '2026-08-12', comment: 'Доп. выход' }),
      // Обычная премия — не выход, и в список попадать не должна.
      adj({ id: 'b1', kind: 'bonus', amount: 5_000, date: '2026-08-14', comment: 'За выручку' }),
      // Прошлый месяц — свой счёт.
      adj({ id: 'e0', kind: 'bonus', amount: 9_000, date: '2026-07-30', comment: 'Доп. выход' }),
    ],
    payments: [],
    today: '2026-08-20',
    meStaffId: null,
  })
  assert.deepEqual(
    summary.rows[0].extra_days.map((d) => d.date),
    ['2026-08-12', '2026-08-19'],
  )
})

test('снятая корректировка не считается выходом', () => {
  const summary = buildStaffSalarySummary({
    staff: [staff()],
    adjustments: [adj({ kind: 'bonus', date: '2026-08-19', comment: 'Доп. выход', status: 'closed' })],
    payments: [],
    today: '2026-08-20',
    meStaffId: null,
  })
  assert.equal(summary.rows[0].extra_days.length, 0)
})
