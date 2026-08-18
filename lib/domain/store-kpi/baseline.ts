/**
 * Историческая база: чего вообще стоило ждать от такой смены.
 *
 * Ожидание считается не «в среднем по магазину», а по сопоставимым условиям:
 * сезон, месяц, день недели, дневная или ночная смена. Суббота в учебный
 * сезон и вторник в июле — разные миры, и один KPI на них обоих был бы
 * несправедлив к обоим.
 *
 * Истории на самый точный сегмент обычно не хватает, поэтому работает лестница
 * fallback: не нашлось нужного числа наблюдений — спускаемся на уровень грубее.
 * Строить оценку человека на выборке из одной-двух смен нельзя, и порог
 * `min_sample_size` это запрещает явно.
 *
 * Статистика робастная — перцентили, а не среднее: один рекордный день не
 * должен задирать планку всем остальным.
 */

import type { Season, SegmentLevel, ShiftFact } from './types'

/** Лестница fallback, от точного к грубому. Порядок важен. */
export const SEGMENT_LEVELS: SegmentLevel[] = [
  'season_month_weekday_shift',
  'season_weekday_shift',
  'season_weekday_group_shift',
  'season_shift',
  'all',
]

/**
 * Насколько ожидание с этого уровня достойно доверия. Чем грубее сегмент, тем
 * больше в нём смешано разных условий.
 */
export const LEVEL_CONFIDENCE: Record<SegmentLevel, number> = {
  season_month_weekday_shift: 1,
  season_weekday_shift: 0.95,
  season_weekday_group_shift: 0.85,
  season_shift: 0.75,
  all: 0.6,
}

/** День недели по ISO-дате без часовых поясов: 0 — воскресенье. */
export function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1).getDay()
}

export function monthOf(iso: string): number {
  const [, m] = iso.split('-').map(Number)
  return m || 1
}

export function isWeekend(dow: number): boolean {
  return dow === 0 || dow === 6
}

export function seasonOf(iso: string, summerMonths: number[]): Season {
  return summerMonths.includes(monthOf(iso)) ? 'summer' : 'academic'
}

/**
 * Перцентиль с линейной интерполяцией. `p` — доля от 0 до 1.
 * Пустая выборка даёт null, а не ноль: «нет данных» и «ноль» — разные вещи.
 */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  if (sorted.length === 1) return sorted[0]
  const clamped = Math.max(0, Math.min(1, p))
  const pos = clamped * (sorted.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  if (lo === hi) return sorted[lo]
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

export function median(values: number[]): number | null {
  return percentile(values, 0.5)
}

/**
 * Одно наблюдение в сегменте.
 *
 * Кассир нужен, чтобы исключать его же смены. Длительность — чтобы шестичасовая
 * смена не читалась как провал спроса: покупателей в ней меньше не потому, что
 * поток слабый, а потому, что она вдвое короче.
 */
export type BaselineEntry = {
  cashier_id: string | null
  value: number
  duration_minutes?: number | null
}

export type BaselineIndex = Map<SegmentLevel, Map<string, BaselineEntry[]>>

function segmentKey(level: SegmentLevel, fact: ShiftFact, summerMonths: number[]): string {
  const season = seasonOf(fact.date, summerMonths)
  const dow = weekdayOf(fact.date)
  switch (level) {
    case 'season_month_weekday_shift':
      return `${fact.company_id}|${season}|${monthOf(fact.date)}|${dow}|${fact.shift}`
    case 'season_weekday_shift':
      return `${fact.company_id}|${season}|${dow}|${fact.shift}`
    case 'season_weekday_group_shift':
      return `${fact.company_id}|${season}|${isWeekend(dow) ? 'weekend' : 'weekday'}|${fact.shift}`
    case 'season_shift':
      return `${fact.company_id}|${season}|${fact.shift}`
    case 'all':
      return `${fact.company_id}`
  }
}

/**
 * Раскладывает историю по всем уровням сегментации сразу.
 * `valueOf` возвращает null, если метрику из этой смены получить нельзя —
 * такие смены в базу метрики не попадают (а не попадают нулями, что занизило
 * бы ожидание всем).
 */
export function buildBaselineIndex(
  facts: ShiftFact[],
  valueOf: (fact: ShiftFact) => number | null,
  opts: { summerMonths: number[] },
): BaselineIndex {
  const index = emptyBaselineIndex()
  for (const fact of facts) {
    addFactToBaselineIndex(index, fact, valueOf(fact), opts)
  }
  return index
}

export function emptyBaselineIndex(): BaselineIndex {
  const index: BaselineIndex = new Map()
  for (const level of SEGMENT_LEVELS) index.set(level, new Map())
  return index
}

/**
 * Добавляет одно наблюдение во все уровни сегментации.
 *
 * Нужно для честного бэктеста: там история наращивается по дням, и на каждый
 * день модель обязана видеть ровно то, что было известно к его началу.
 */
export function addFactToBaselineIndex(
  index: BaselineIndex,
  fact: ShiftFact,
  value: number | null,
  opts: { summerMonths: number[] },
): void {
  if (value == null || !Number.isFinite(value)) return
  const entry: BaselineEntry = {
    cashier_id: fact.cashier_id,
    value,
    duration_minutes: fact.duration_minutes ?? null,
  }
  for (const level of SEGMENT_LEVELS) {
    const buckets = index.get(level)!
    const key = segmentKey(level, fact, opts.summerMonths)
    const list = buckets.get(key)
    if (list) list.push(entry)
    else buckets.set(key, [entry])
  }
}

export type BaselineHit = {
  value: number
  level: SegmentLevel
  sample: number
}

/**
 * Ищет ожидание для смены, спускаясь по лестнице fallback.
 *
 * `excludeCashierId` — оценка продавца не должна сравниваться с базой, которую
 * он сам же и сформировал: у того, кто отработал большинство смен сегмента,
 * ожидание иначе подстраивается под него самого, и отличиться от себя он не
 * сможет ни в плюс, ни в минус.
 */
export function lookupBaseline(
  index: BaselineIndex,
  fact: ShiftFact,
  opts: {
    minSample: number
    summerMonths: number[]
    /** Доля для перцентиля: 0.5 — медиана. */
    percentile?: number
    excludeCashierId?: string | null
  },
): BaselineHit | null {
  const p = opts.percentile ?? 0.5

  for (const level of SEGMENT_LEVELS) {
    const buckets = index.get(level)
    if (!buckets) continue
    const entries = buckets.get(segmentKey(level, fact, opts.summerMonths))
    if (!entries || entries.length === 0) continue

    const usable = opts.excludeCashierId
      ? entries.filter((e) => e.cashier_id !== opts.excludeCashierId)
      : entries
    if (usable.length < opts.minSample) continue

    const value = percentile(usable.map((e) => e.value), p)
    if (value == null) continue
    return { value, level, sample: usable.length }
  }

  return null
}

/**
 * Сами наблюдения сегмента, а не одно число из них.
 *
 * Нужно вероятностным моделям: чтобы оценить разброс потока, недостаточно
 * медианы — требуется вся выборка. Лестница fallback и правило исключения
 * кассира здесь ровно те же, что и в lookupBaseline, и это принципиально:
 * если новая модель начнёт брать другой сегмент, сравнение её со старой
 * перестанет что-либо означать.
 */
export function lookupBaselineSamples(
  index: BaselineIndex,
  fact: ShiftFact,
  opts: {
    minSample: number
    summerMonths: number[]
    excludeCashierId?: string | null
  },
): { values: number[]; durations: Array<number | null>; level: SegmentLevel; sample: number } | null {
  for (const level of SEGMENT_LEVELS) {
    const buckets = index.get(level)
    if (!buckets) continue
    const entries = buckets.get(segmentKey(level, fact, opts.summerMonths))
    if (!entries || entries.length === 0) continue

    const usable = opts.excludeCashierId
      ? entries.filter((e) => e.cashier_id !== opts.excludeCashierId)
      : entries
    if (usable.length < opts.minSample) continue

    return {
      values: usable.map((e) => e.value),
      durations: usable.map((e) => e.duration_minutes ?? null),
      level,
      sample: usable.length,
    }
  }

  return null
}

/**
 * Пороги выручки по перцентилям сегмента — основа бонусных уровней.
 * Возвращает null, если наблюдений меньше минимума: назначать план по двум
 * сменам нельзя.
 */
export function revenueThresholds(
  index: BaselineIndex,
  fact: ShiftFact,
  opts: { minSample: number; summerMonths: number[]; percentiles: number[] },
): { level: SegmentLevel; sample: number; values: number[] } | null {
  for (const level of SEGMENT_LEVELS) {
    const buckets = index.get(level)
    if (!buckets) continue
    const entries = buckets.get(segmentKey(level, fact, opts.summerMonths))
    if (!entries || entries.length < opts.minSample) continue
    const values = entries.map((e) => e.value)
    const out = opts.percentiles.map((p) => percentile(values, p))
    if (out.some((v) => v == null)) continue
    return { level, sample: entries.length, values: out as number[] }
  }
  return null
}
