/**
 * Бэктест: правда ли новая модель лучше старой.
 *
 * Это главный файл всей затеи. Без него вероятностный движок — набор красивых
 * формул, про которые неизвестно, помогают они или мешают. Здесь обе модели
 * проверяются на одной и той же истории по одним и тем же правилам.
 *
 * Как устроено. Идём по сменам в хронологическом порядке и на каждой делаем
 * прогноз, зная ровно то, что было известно к её началу. Сама смена в свою
 * базу не попадает — она добавляется в историю только ПОСЛЕ того, как прогноз
 * сделан и сравнён с фактом. Иначе модель подглядывала бы в ответ и на бумаге
 * выглядела бы великолепно, а в жизни промахивалась.
 *
 * Что считаем и почему именно это:
 *
 *   MAE   — на сколько чеков в среднем промахиваемся. Понятно человеку.
 *   WAPE  — тот же промах в процентах от оборота. Позволяет сравнивать точки
 *           с разным потоком.
 *   bias  — систематическая ошибка. MAE может быть мал, а модель при этом
 *           стабильно занижает — и тогда планы будут вечно недобираться.
 *   охват — доля смен, попавших в объявленный интервал. Если модель говорит
 *           «80% диапазон», а факт попадает в него в 55% случаев, то это не
 *           диапазон, а самообман.
 *   ширина— интервал в пол-экрана всегда накроет факт. Охват без ширины
 *           ничего не значит: их читают только вместе.
 *   Брайер— для вероятностей планов. Если модель раз за разом обещает 70%,
 *           события обязаны случаться примерно в 70% случаев.
 */

import { clamp01 } from './math'
import type { DemandForecast } from './types'

export type BacktestPoint = {
  /** Прогноз старой модели — медиана сопоставимых смен. */
  v1Expected: number | null
  /** Интервал старой модели: P25–P75, как она его и показывает. */
  v1Interval: { low: number; high: number } | null
  /** Прогноз новой модели. */
  v2: DemandForecast | null
  /** Что случилось на самом деле. */
  actual: number
}

export type ModelMetrics = {
  /** Средний промах в штуках. */
  mae: number | null
  /** Средний промах в процентах от суммарного факта. */
  wape: number | null
  /** Систематический сдвиг: плюс — модель завышает. */
  bias: number | null
  /** Доля фактов, попавших в интервал 50%. */
  coverage50: number | null
  /** Доля фактов, попавших в интервал 80%. */
  coverage80: number | null
  /** Средняя ширина интервала 80% — цена этого охвата. */
  intervalWidth: number | null
  observations: number
}

export type BacktestComparison = {
  v1: ModelMetrics
  v2: ModelMetrics
  /** Какая модель точнее по WAPE и насколько (в процентных пунктах). */
  verdict: {
    winner: 'v1' | 'v2' | 'tie'
    wapeDelta: number | null
    /** Читаемое объяснение — его же показываем человеку. */
    summary: string
  }
}

/** Одно предсказание вероятности и то, случилось ли событие. */
export type CalibrationPoint = { probability: number; happened: boolean }

export type CalibrationResult = {
  /** Брайер: средний квадрат ошибки вероятности. Меньше — лучше. 0.25 — угадайка. */
  brierScore: number | null
  /**
   * Разбивка по корзинам вероятности. Именно здесь видно, врёт ли модель:
   * в корзине «около 70%» доля сбывшихся обязана быть около 70%.
   */
  buckets: Array<{
    from: number
    to: number
    predicted: number
    observed: number
    count: number
  }>
  observations: number
}

function metricsFor(
  pairs: Array<{ expected: number; low: number | null; high: number | null; p25: number | null; p75: number | null; actual: number }>,
): ModelMetrics {
  if (pairs.length === 0) {
    return {
      mae: null,
      wape: null,
      bias: null,
      coverage50: null,
      coverage80: null,
      intervalWidth: null,
      observations: 0,
    }
  }

  let absError = 0
  let signedError = 0
  let actualSum = 0
  let in50 = 0
  let in50Total = 0
  let in80 = 0
  let in80Total = 0
  let widthSum = 0

  for (const pair of pairs) {
    absError += Math.abs(pair.expected - pair.actual)
    signedError += pair.expected - pair.actual
    actualSum += Math.abs(pair.actual)

    if (pair.p25 !== null && pair.p75 !== null) {
      in50Total += 1
      if (pair.actual >= pair.p25 && pair.actual <= pair.p75) in50 += 1
    }
    if (pair.low !== null && pair.high !== null) {
      in80Total += 1
      if (pair.actual >= pair.low && pair.actual <= pair.high) in80 += 1
      widthSum += pair.high - pair.low
    }
  }

  return {
    mae: round2(absError / pairs.length),
    wape: actualSum > 0 ? round4(absError / actualSum) : null,
    bias: round2(signedError / pairs.length),
    coverage50: in50Total > 0 ? round4(in50 / in50Total) : null,
    coverage80: in80Total > 0 ? round4(in80 / in80Total) : null,
    intervalWidth: in80Total > 0 ? round2(widthSum / in80Total) : null,
    observations: pairs.length,
  }
}

/**
 * Сравнивает две модели на общем наборе смен.
 *
 * Считает только по тем сменам, где ОБЕ модели дали прогноз: иначе победа
 * могла бы достаться той, что просто чаще отказывалась отвечать.
 */
export function compareModels(points: BacktestPoint[]): BacktestComparison {
  const usable = points.filter(
    (p) => p.v1Expected !== null && p.v2 !== null && Number.isFinite(p.actual),
  )

  const v1 = metricsFor(
    usable.map((p) => ({
      expected: p.v1Expected as number,
      low: p.v1Interval?.low ?? null,
      high: p.v1Interval?.high ?? null,
      // У старой модели интервал один — P25–P75. Он же и есть её «50%».
      p25: p.v1Interval?.low ?? null,
      p75: p.v1Interval?.high ?? null,
      actual: p.actual,
    })),
  )

  const v2 = metricsFor(
    usable.map((p) => ({
      expected: (p.v2 as DemandForecast).expectedReceipts,
      low: (p.v2 as DemandForecast).interval80.low,
      high: (p.v2 as DemandForecast).interval80.high,
      p25: (p.v2 as DemandForecast).p25,
      p75: (p.v2 as DemandForecast).p75,
      actual: p.actual,
    })),
  )

  return { v1, v2, verdict: verdictOf(v1, v2) }
}

function verdictOf(v1: ModelMetrics, v2: ModelMetrics): BacktestComparison['verdict'] {
  if (v1.wape === null || v2.wape === null) {
    return { winner: 'tie', wapeDelta: null, summary: 'Сравнивать не на чем: слишком мало смен с прогнозом.' }
  }

  const delta = round4((v1.wape - v2.wape) * 100)
  // Полпроцентного пункта — это шум, а не улучшение. Объявлять по такой
  // разнице победителя значит менять рабочую модель на удачу выборки.
  if (Math.abs(delta) < 0.5) {
    return {
      winner: 'tie',
      wapeDelta: delta,
      summary:
        `Модели предсказывают одинаково точно (разница ${Math.abs(delta).toFixed(1)} п.п.).` +
        (v2.coverage80 !== null && v1.coverage80 !== null && v2.coverage80 - v1.coverage80 > 0.1
          ? ` Разница в другом: диапазон вероятностной накрывает факт в ${(v2.coverage80 * 100).toFixed(0)}% смен против ${(v1.coverage80 * 100).toFixed(0)}%.`
          : ' Менять рабочую незачем.'),
    }
  }

  if (delta > 0) {
    const coverage =
      v2.coverage80 !== null
        ? ` Диапазон 80% накрывает факт в ${(v2.coverage80 * 100).toFixed(0)}% смен.`
        : ''
    return {
      winner: 'v2',
      wapeDelta: delta,
      summary: `Вероятностная модель точнее на ${delta.toFixed(1)} п.п.${coverage}`,
    }
  }

  // Проигрыш в точке ещё не делает вероятностную модель бесполезной: её
  // ценность в диапазоне. Умолчать об этом значило бы дать половину ответа —
  // человек прочтёт «переходить не на что» и не узнает, что интервал у неё
  // втрое честнее.
  const intervalNote =
    v2.coverage80 !== null && v1.coverage80 !== null && v2.coverage80 - v1.coverage80 > 0.1
      ? ` Но её диапазон честнее: накрывает факт в ${(v2.coverage80 * 100).toFixed(0)}% смен против ${(v1.coverage80 * 100).toFixed(0)}%.`
      : ''

  return {
    winner: 'v1',
    wapeDelta: delta,
    summary: `Нынешняя модель точнее на ${Math.abs(delta).toFixed(1)} п.п. — как точечный прогноз менять её не на что.${intervalNote}`,
  }
}

/**
 * Калибровка вероятностей.
 *
 * Точность и калибровка — разные вещи, и вторая важнее для того, что мы
 * показываем человеку. Модель может редко ошибаться в среднем и при этом
 * систематически обещать 80% там, где случается 50%. Продавец, которому
 * пообещали «B2 берётся в восьми случаях из десяти», а он взял его в
 * половине, перестанет верить всей странице — и будет прав.
 */
export function calibration(points: CalibrationPoint[], buckets = 5): CalibrationResult {
  const clean = points.filter((p) => Number.isFinite(p.probability))
  if (clean.length === 0) {
    return { brierScore: null, buckets: [], observations: 0 }
  }

  let squared = 0
  for (const point of clean) {
    const p = clamp01(point.probability)
    squared += (p - (point.happened ? 1 : 0)) ** 2
  }

  const size = 1 / buckets
  const grouped: CalibrationResult['buckets'] = []
  for (let i = 0; i < buckets; i++) {
    const from = i * size
    const to = (i + 1) * size
    const inBucket = clean.filter((p) => {
      const value = clamp01(p.probability)
      return i === buckets - 1 ? value >= from && value <= to : value >= from && value < to
    })
    if (inBucket.length === 0) continue
    grouped.push({
      from: round2(from),
      to: round2(to),
      predicted: round4(inBucket.reduce((sum, p) => sum + clamp01(p.probability), 0) / inBucket.length),
      observed: round4(inBucket.filter((p) => p.happened).length / inBucket.length),
      count: inBucket.length,
    })
  }

  return {
    brierScore: round4(squared / clean.length),
    buckets: grouped,
    observations: clean.length,
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000
}
