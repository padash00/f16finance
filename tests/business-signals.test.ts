import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aggregateRevisionShortages,
  coverageDays,
  findRevenueOutliers,
  shiftISODate,
  type DailyRevenue,
  type RevisionActInput,
} from '@/lib/analysis/business-signals'

// 8 недель клуба: будни 100к, пятница 180к, выходные 250к, небольшой шум
function clubWeeks(start: string, weeks: number): DailyRevenue[] {
  const out: DailyRevenue[] = []
  for (let i = 0; i < weeks * 7; i++) {
    const date = shiftISODate(start, i)
    const wd = new Date(`${date}T00:00:00Z`).getUTCDay()
    const base = wd === 0 || wd === 6 ? 250_000 : wd === 5 ? 180_000 : 100_000
    out.push({ date, revenue: base * (1 + ((i % 5) - 2) * 0.02) })
  }
  return out
}

test('выходные клуба не считаются странными: норма — тот же день недели', () => {
  const days = clubWeeks('2026-07-06', 8)
  const result = findRevenueOutliers(days, { from: '2026-08-03' })
  assert.equal(result.outliers.length, 0)
})

test('провал в субботу виден, хотя он всё ещё выше будней', () => {
  const days = clubWeeks('2026-07-06', 8)
  const saturday = days.find((d) => d.date === '2026-08-22')!
  saturday.revenue = 120_000 // обычно ~250к, но больше любого будня
  const result = findRevenueOutliers(days, { from: '2026-08-03' })
  assert.equal(result.outliers.length, 1)
  assert.equal(result.outliers[0].date, '2026-08-22')
  assert.equal(result.outliers[0].direction, 'below')
  assert.ok(result.outliers[0].expected > 240_000 && result.outliers[0].expected < 260_000)
  assert.ok(result.outliers[0].deviation < -0.5)
})

test('всплеск до начала периода не показывается, но пустые дни не ломают норму', () => {
  const days = clubWeeks('2026-07-06', 8)
  days.find((d) => d.date === '2026-07-08')!.revenue = 400_000 // до from
  days.find((d) => d.date === '2026-08-12')!.revenue = 0 // отчёт не внесён
  const result = findRevenueOutliers(days, { from: '2026-08-03' })
  assert.equal(result.outliers.length, 0)
})

test('мало данных — ничего не выдумываем', () => {
  const result = findRevenueOutliers([{ date: '2026-09-01', revenue: 10 }, { date: '2026-09-02', revenue: 1_000_000 }], { from: '2026-09-01' })
  assert.equal(result.outliers.length, 0)
})

function act(partial: Partial<RevisionActInput> & Pick<RevisionActInput, 'actId'>): RevisionActInput {
  return {
    closedAt: '2026-09-01T10:00:00Z',
    expected: new Map(),
    counts: [],
    moves: [],
    unitCost: new Map(),
    ...partial,
  }
}

test('недостача относится к тому, кто считал, и в деньгах по закупу', () => {
  const rows = aggregateRevisionShortages([
    act({
      actId: 'a1',
      expected: new Map([['cola', 10], ['chips', 5]]),
      unitCost: new Map([['cola', 300], ['chips', 200]]),
      counts: [
        { itemId: 'cola', counted: 8, by: 'ivan', at: '2026-09-01T09:00:00Z' },
        { itemId: 'chips', counted: 5, by: 'olga', at: '2026-09-01T09:05:00Z' },
      ],
    }),
  ])
  const ivan = rows.find((r) => r.operatorId === 'ivan')!
  const olga = rows.find((r) => r.operatorId === 'olga')!
  assert.equal(ivan.shortageAmount, 600)
  assert.equal(ivan.actsWithShortage, 1)
  assert.equal(olga.shortageAmount, 0)
  assert.equal(olga.actsWithShortage, 0)
  assert.equal(rows[0].operatorId, 'ivan')
})

test('продажа во время ревизии до подсчёта — не недостача', () => {
  const rows = aggregateRevisionShortages([
    act({
      actId: 'a1',
      expected: new Map([['cola', 10]]),
      unitCost: new Map([['cola', 300]]),
      moves: [
        { itemId: 'cola', delta: -2, at: '2026-09-01T08:30:00Z' }, // продали до подсчёта
        { itemId: 'cola', delta: -1, at: '2026-09-01T09:30:00Z' }, // после — не влияет
      ],
      counts: [{ itemId: 'cola', counted: 8, by: 'ivan', at: '2026-09-01T09:00:00Z' }],
    }),
  ])
  assert.equal(rows[0].shortageAmount, 0)
  assert.equal(rows[0].actsWithShortage, 0)
})

test('риск сглажен: одна недостача из одной ревизии не равна 100%', () => {
  const one = aggregateRevisionShortages([
    act({
      actId: 'a1',
      expected: new Map([['cola', 1]]),
      counts: [{ itemId: 'cola', counted: 0, by: 'ivan', at: '2026-09-01T09:00:00Z' }],
    }),
  ])[0]
  assert.equal(one.posterior, 2 / 6)

  // Считать списания одного сотрудника «событиями» всех — старая ошибка:
  // у каждого сотрудника свои ревизии, чужие не попадают в знаменатель
  const two = aggregateRevisionShortages([
    act({ actId: 'a1', expected: new Map([['x', 1]]), counts: [{ itemId: 'x', counted: 1, by: 'olga', at: 't1' }] }),
    act({ actId: 'a2', expected: new Map([['x', 1]]), counts: [{ itemId: 'x', counted: 1, by: 'olga', at: 't2' }] }),
    act({ actId: 'a3', expected: new Map([['x', 1]]), counts: [{ itemId: 'x', counted: 0, by: 'ivan', at: 't3' }] }),
  ])
  assert.equal(two.find((r) => r.operatorId === 'olga')!.acts, 2)
  assert.equal(two.find((r) => r.operatorId === 'ivan')!.acts, 1)
})

test('дни запаса: пустой остаток — 0, иначе недели × 7', () => {
  assert.equal(coverageDays(1.5, 10), 11)
  assert.equal(coverageDays(0, 0), 0)
  assert.equal(coverageDays(99, -3), 0)
})
