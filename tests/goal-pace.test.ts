import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cumulativeTargetCurve,
  datesBetween,
  goalPace,
  goalVerdict,
  suggestTargets,
  weekdayWeights,
  yearPlanSummary,
  type DayValue,
} from '@/lib/analysis/goal-pace'

// 8 недель клуба: будни 100к, выходные 300к
function club(start: string, days: number): DayValue[] {
  return datesBetween(start, new Date(Date.parse(`${start}T00:00:00Z`) + (days - 1) * 86_400_000).toISOString().slice(0, 10)).map((date) => {
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay()
    return { date, value: wd === 0 || wd === 6 ? 300_000 : 100_000 }
  })
}

test('ритм недели: выходные тяжелее будней, мало данных — ровно', () => {
  const w = weekdayWeights(club('2026-07-06', 56))
  assert.ok(w[6] > 2 * w[2])
  assert.ok(Math.abs(w.reduce((s, v) => s + v, 0) - 7) < 1e-9)
  assert.deepEqual(weekdayWeights(club('2026-07-06', 5)), [1, 1, 1, 1, 1, 1, 1])
})

test('цель по ритму: к пятнице набирается меньше половины недельного плана', () => {
  const w = weekdayWeights(club('2026-07-06', 56))
  const week = datesBetween('2026-09-07', '2026-09-13') // пн..вс
  const curve = cumulativeTargetCurve(week, 1_100_000, w)
  assert.equal(curve[curve.length - 1], 1_100_000)
  assert.equal(curve[4], 500_000) // пять будней по 100к из 1,1 млн
})

test('темп: в плане по ритму, хотя «ровная линия» показала бы отставание', () => {
  const w = weekdayWeights(club('2026-07-06', 56))
  const pace = goalPace({ target: 1_100_000, fact: 500_000, start: '2026-09-07', end: '2026-09-13', lastFactDate: '2026-09-11', weights: w })!
  assert.equal(pace.expectedByNow, 500_000)
  assert.equal(pace.gap, 0)
  assert.equal(pace.daysLeft, 2)
  assert.equal(pace.requiredPerDay, 300_000)
  assert.equal(pace.currentPerDay, 100_000)
})

test('темп: период ещё не начался и уже закончился', () => {
  const w = new Array(7).fill(1)
  const future = goalPace({ target: 300, fact: 0, start: '2026-10-01', end: '2026-10-03', lastFactDate: '2026-09-13', weights: w })!
  assert.equal(future.daysPassed, 0)
  assert.equal(future.requiredPerDay, 100)
  const past = goalPace({ target: 300, fact: 330, start: '2026-08-01', end: '2026-08-03', lastFactDate: '2026-09-13', weights: w })!
  assert.equal(past.daysLeft, 0)
  assert.equal(past.gap, 30)
  assert.equal(goalPace({ target: 0, fact: 1, start: '2026-08-01', end: '2026-08-03', lastFactDate: '2026-09-13', weights: w }), null)
})

test('вывод по прогнозу', () => {
  const o = { pessimistic: 9_000_000, realistic: 10_000_000, optimistic: 11_000_000 }
  assert.equal(goalVerdict(8_500_000, 1, o)!.status, 'safe')
  assert.equal(goalVerdict(9_500_000, 1, o)!.status, 'likely')
  const risk = goalVerdict(10_600_000, 1, o)!
  assert.equal(risk.status, 'at_risk')
  assert.equal(risk.shortfall, 600_000)
  assert.equal(goalVerdict(12_000_000, 1, o)!.status, 'unlikely')
  assert.equal(goalVerdict(5, 10, null)!.status, 'done')
  assert.equal(goalVerdict(5, 1, null), null)
})

test('итог года: только закрытые месяцы с планом', () => {
  const s = yearPlanSummary([
    { month: 1, target: 100, fact: 120, closed: true },
    { month: 2, target: 100, fact: 80, closed: true },
    { month: 3, target: null, fact: 90, closed: true },
    { month: 9, target: 100, fact: 10, closed: false },
  ])
  assert.equal(s.closedWithPlan, 2)
  assert.equal(s.hit, 1)
  assert.deepEqual(s.missed, [{ month: 2, target: 100, fact: 80, shortfall: 20, pct: 80 }])
})

test('подсказка цели: из прогноза, иначе из прошлого года с ростом', () => {
  const t = (income: number, expense: number) => ({ income, expense, profit: income - expense })
  const fromForecast = suggestTargets({
    scenarios: { pessimistic: t(9_012_345, 6_100_000), realistic: t(10_004_000, 6_000_000), optimistic: t(11_000_000, 5_900_000) },
    lastYear: null,
    growth: null,
  })
  assert.deepEqual(fromForecast.map((s) => s.revenue), [9_010_000, 10_000_000, 11_000_000])
  assert.ok(fromForecast.every((s) => s.expense === 6_000_000))

  const fromLastYear = suggestTargets({ scenarios: null, lastYear: { revenue: 8_000_000, expense: 5_000_000 }, growth: 1.1 })
  assert.equal(fromLastYear[1].revenue, 8_800_000)
  assert.equal(fromLastYear[1].source, 'last_year')
  assert.deepEqual(suggestTargets({ scenarios: null, lastYear: null, growth: null }), [])
})
