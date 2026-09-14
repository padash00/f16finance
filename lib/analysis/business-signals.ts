/**
 * Сигналы для /business-intelligence — чистые расчёты без базы, чтобы их можно
 * было проверить тестами.
 *
 *  1. Странные дни выручки. Сравниваем день не со средним за период, а с
 *     обычной выручкой в тот же день недели: иначе каждая суббота клуба
 *     «аномально высокая», а каждый понедельник — «аномально низкий».
 *  2. Недостачи по ревизиям. Та же логика, что при закрытии аудит-акта
 *     (app/api/admin/store/audit): недостача = (ожидалось при открытии +
 *     движения до подсчёта) − посчитано, и относится к тому, кто считал.
 *     Продажи во время ревизии в недостачу не попадают.
 */

const DAY_MS = 86_400_000

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay()

// ── 1. Странные дни выручки ─────────────────────────────────────────────────

export type DailyRevenue = { date: string; revenue: number }

export type RevenueOutlier = {
  date: string
  revenue: number
  /** Обычная выручка в этот день недели */
  expected: number
  /** Отклонение от обычного, доля: 0.4 = на 40% выше */
  deviation: number
  /** Насколько отклонение необычно для этой точки (в её собственных «разбросах») */
  z: number
  direction: 'above' | 'below'
}

export type RevenueOutlierResult = {
  outliers: RevenueOutlier[]
  /** Обычный день точки (медиана) — для подписи */
  typicalDay: number
  daysAnalyzed: number
}

/** Минимальное отклонение, которое вообще стоит показывать владельцу */
export const OUTLIER_MIN_DEVIATION = 0.25
/** Во сколько раз отклонение больше обычного разброса точки */
export const OUTLIER_Z = 3
/** Нижняя граница разброса: у очень ровной точки ±5% — ещё не повод */
const MIN_SCALE = 0.05

/**
 * days — дневная выручка точки, включая историю для нормы (дни до `from`).
 * Показываются только дни с `from` включительно. Дни без выручки не
 * оцениваются: пустой день — это недовнесённый отчёт, его ловит проверка
 * полноты данных, а не детектор.
 */
export function findRevenueOutliers(days: DailyRevenue[], params: { from: string }): RevenueOutlierResult {
  const worked = days.filter((d) => d.revenue > 0)
  if (worked.length < 7) {
    return { outliers: [], typicalDay: Math.round(median(worked.map((d) => d.revenue))), daysAnalyzed: worked.length }
  }

  const byWeekday = new Map<number, DailyRevenue[]>()
  for (const d of worked) {
    const list = byWeekday.get(weekdayOf(d.date)) || []
    list.push(d)
    byWeekday.set(weekdayOf(d.date), list)
  }

  // Норма дня — медиана того же дня недели без самого дня; мало таких дней —
  // медиана всех остальных дней
  const scored = worked.map((d) => {
    const peers = (byWeekday.get(weekdayOf(d.date)) || []).filter((p) => p.date !== d.date)
    const pool = peers.length >= 3 ? peers : worked.filter((p) => p.date !== d.date)
    const expected = median(pool.map((p) => p.revenue))
    const deviation = expected > 0 ? (d.revenue - expected) / expected : 0
    return { ...d, expected, deviation }
  })

  // Обычный разброс точки — медианное абсолютное отклонение (к выбросам нечувствительно)
  const deviations = scored.map((s) => s.deviation)
  const center = median(deviations)
  const scale = Math.max(MIN_SCALE, 1.4826 * median(deviations.map((v) => Math.abs(v - center))))

  const outliers: RevenueOutlier[] = []
  for (const s of scored) {
    if (s.date < params.from) continue
    const z = s.deviation / scale
    if (Math.abs(z) < OUTLIER_Z || Math.abs(s.deviation) < OUTLIER_MIN_DEVIATION) continue
    outliers.push({
      date: s.date,
      revenue: Math.round(s.revenue),
      expected: Math.round(s.expected),
      deviation: Math.round(s.deviation * 1000) / 1000,
      z: Math.round(z * 100) / 100,
      direction: s.deviation > 0 ? 'above' : 'below',
    })
  }
  outliers.sort((a, b) => Math.abs(b.z) - Math.abs(a.z))

  return {
    outliers,
    typicalDay: Math.round(median(worked.filter((d) => d.date >= params.from).map((d) => d.revenue))),
    daysAnalyzed: worked.filter((d) => d.date >= params.from).length,
  }
}

// ── 2. Недостачи по ревизиям ────────────────────────────────────────────────

export type RevisionActInput = {
  actId: string
  closedAt: string | null
  /** Ожидаемый остаток на открытии акта */
  expected: Map<string, number>
  counts: Array<{ itemId: string; counted: number; by: string | null; at: string }>
  /** Движения по складу акта за время ревизии: + пришло, − ушло */
  moves: Array<{ itemId: string; delta: number; at: string }>
  unitCost: Map<string, number>
}

export type OperatorShortage = {
  operatorId: string
  /** Ревизий, где сотрудник что-то считал */
  acts: number
  /** Из них — с недостачей на его позициях */
  actsWithShortage: number
  positions: number
  shortagePositions: number
  shortageAmount: number
  lastShortageAt: string | null
  /** Сглаженная доля ревизий с недостачей: (1 + с недостачей) / (5 + ревизий) */
  posterior: number
}

const PRIOR_SHORTAGE = 1
const PRIOR_CLEAN = 4
const EPS = 1e-9

export function aggregateRevisionShortages(acts: RevisionActInput[]): OperatorShortage[] {
  const byOperator = new Map<string, OperatorShortage>()

  for (const act of acts) {
    const movesByItem = new Map<string, Array<{ delta: number; at: string }>>()
    for (const m of act.moves) {
      const list = movesByItem.get(m.itemId) || []
      list.push(m)
      movesByItem.set(m.itemId, list)
    }

    // Последний подсчёт позиции — тот, что пошёл в остаток
    const latestByItem = new Map<string, RevisionActInput['counts'][number]>()
    for (const c of act.counts) {
      const prev = latestByItem.get(c.itemId)
      if (!prev || c.at > prev.at) latestByItem.set(c.itemId, c)
    }

    const touched = new Map<string, { positions: number; shortagePositions: number; amount: number }>()
    for (const count of latestByItem.values()) {
      if (!count.by) continue
      const movedBefore = (movesByItem.get(count.itemId) || [])
        .filter((m) => m.at <= count.at)
        .reduce((s, m) => s + m.delta, 0)
      const expectedAtCount = (act.expected.get(count.itemId) ?? 0) + movedBefore
      const shortage = Math.max(0, expectedAtCount - count.counted)
      const entry = touched.get(count.by) || { positions: 0, shortagePositions: 0, amount: 0 }
      entry.positions += 1
      if (shortage > EPS) {
        entry.shortagePositions += 1
        entry.amount += shortage * (act.unitCost.get(count.itemId) || 0)
      }
      touched.set(count.by, entry)
    }

    for (const [operatorId, entry] of touched) {
      const row = byOperator.get(operatorId) || {
        operatorId,
        acts: 0,
        actsWithShortage: 0,
        positions: 0,
        shortagePositions: 0,
        shortageAmount: 0,
        lastShortageAt: null,
        posterior: 0,
      }
      row.acts += 1
      row.positions += entry.positions
      row.shortagePositions += entry.shortagePositions
      row.shortageAmount += entry.amount
      if (entry.shortagePositions > 0) {
        row.actsWithShortage += 1
        if (act.closedAt && (!row.lastShortageAt || act.closedAt > row.lastShortageAt)) row.lastShortageAt = act.closedAt
      }
      byOperator.set(operatorId, row)
    }
  }

  return Array.from(byOperator.values())
    .map((r) => ({
      ...r,
      shortageAmount: Math.round(r.shortageAmount),
      posterior: (PRIOR_SHORTAGE + r.actsWithShortage) / (PRIOR_SHORTAGE + PRIOR_CLEAN + r.acts),
    }))
    .sort((a, b) => b.shortageAmount - a.shortageAmount || b.posterior - a.posterior)
}

// ── 3. Сколько дней хватит остатка ─────────────────────────────────────────

/** Недели запаса из плана закупа → дни для подписи; 0 при пустом остатке */
export function coverageDays(coverageWeeks: number, stock: number): number {
  if (!(stock > 0)) return 0
  return Math.max(0, Math.round(coverageWeeks * 7))
}

export function shiftISODate(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}
