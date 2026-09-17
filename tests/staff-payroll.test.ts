import { test } from 'node:test'
import assert from 'node:assert/strict'
import { calculateStaffAccrualForMonth } from '@/lib/domain/staff-payroll'

const person = (id: string, created: string | null, dismissed: string | null = null) => ({
  id,
  created_at: created,
  dismissed_at: dismissed,
})

test('полный месяц — весь оклад', () => {
  const res = calculateStaffAccrualForMonth({
    staff: [person('s1', '2026-01-10')],
    periods: [{ staff_id: 's1', effective_from: '2026-01-10', monthly_salary: 300_000 }],
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
  })
  assert.equal(res.total, 300_000)
  assert.equal(res.perStaff[0].segments.length, 1)
  assert.equal(res.perStaff[0].segments[0].days, 30)
})

test('пришёл в середине месяца — только отработанные дни', () => {
  // 16 дней из 30 (с 15-го по 30-е включительно)
  const res = calculateStaffAccrualForMonth({
    staff: [person('s1', '2026-09-15')],
    periods: [{ staff_id: 's1', effective_from: '2026-09-15', monthly_salary: 300_000 }],
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
  })
  assert.equal(res.perStaff[0].segments[0].days, 16)
  assert.equal(res.total, Math.round((16 * 300_000) / 30))
})

test('день увольнения оплачивается, следующий — нет', () => {
  const res = calculateStaffAccrualForMonth({
    staff: [person('s1', '2026-01-01', '2026-09-10T18:00:00Z')],
    periods: [{ staff_id: 's1', effective_from: '2026-01-01', monthly_salary: 300_000 }],
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
  })
  assert.equal(res.perStaff[0].segments[0].days, 10)
  assert.equal(res.total, Math.round((10 * 300_000) / 30))
})

test('оклад менялся в середине месяца — два отрезка', () => {
  const res = calculateStaffAccrualForMonth({
    staff: [person('s1', '2026-01-01')],
    periods: [
      { staff_id: 's1', effective_from: '2026-01-01', monthly_salary: 300_000 },
      { staff_id: 's1', effective_from: '2026-09-16', monthly_salary: 360_000 },
    ],
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
  })
  const segments = res.perStaff[0].segments
  assert.equal(segments.length, 2)
  assert.equal(segments[0].days, 15)
  assert.equal(segments[1].days, 15)
  assert.equal(res.total, Math.round((15 * 300_000) / 30 + (15 * 360_000) / 30))
})

test('уволенный до начала месяца не начисляется', () => {
  const res = calculateStaffAccrualForMonth({
    staff: [person('s1', '2026-01-01', '2026-08-20')],
    periods: [{ staff_id: 's1', effective_from: '2026-01-01', monthly_salary: 300_000 }],
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
  })
  assert.equal(res.total, 0)
  assert.equal(res.perStaff.length, 0)
})

test('без истории окладов сотрудник пропускается, а не считается по нулю', () => {
  const res = calculateStaffAccrualForMonth({
    staff: [person('s1', '2026-01-01'), person('s2', '2026-01-01')],
    periods: [{ staff_id: 's2', effective_from: '2026-01-01', monthly_salary: 200_000 }],
    monthStart: '2026-09-01',
    monthEnd: '2026-09-30',
  })
  assert.equal(res.perStaff.length, 1)
  assert.equal(res.perStaff[0].staff_id, 's2')
})
