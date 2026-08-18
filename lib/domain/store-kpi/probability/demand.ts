/**
 * Прогноз спроса: сколько чеков ждать в смене.
 *
 * Здесь же живёт выбор модели. Он не задан заранее и не «отрицательное
 * биномиальное всегда»: на каждом сегменте данные сами решают, что применимо.
 *
 *   отрицательное биномиальное   ← разброс заметно больше среднего
 *            ↓ разброса нет или выборка мала
 *   Пуассон                      ← разброс на уровне среднего
 *            ↓ данных совсем мало
 *   эмпирические перцентили      ← то, что модуль считает сегодня
 *
 * Последняя ступень — нынешняя рабочая модель. Она обязана оставаться
 * последним безопасным вариантом: новая математика имеет право улучшать
 * прогноз, но не имеет права его ломать там, где старая работала.
 *
 * Спрос — это поток, а не работа кассира. Ничего отсюда не попадает в его
 * оценку: слабый поток не делает продавца плохим.
 */

import { clamp01, finiteOrNull, mean, quantile, variance } from './math'
import { fitNegativeBinomial, negativeBinomialCdf, negativeBinomialQuantile } from './negative-binomial'
import { poissonCdf, poissonQuantile } from './poisson'
import type { DemandForecast } from './types'

export type DemandOptions = {
  /**
   * Длительность каждой прошлой смены в минутах и длительность оцениваемой.
   *
   * Без этого шестичасовая смена читается как провал спроса: покупателей в ней
   * меньше не потому, что поток слабый, а потому, что она вдвое короче.
   * Наблюдения приводятся к длительности целевой смены — то есть отвечают на
   * вопрос «сколько чеков было бы в тот день, работай он столько же».
   *
   * Неизвестная длительность означает «как обычно» и ничего не меняет.
   */
  exposures?: Array<number | null>
  targetExposure?: number | null

  /**
   * Минимум наблюдений для параметрической модели.
   *
   * Отличается от min_sample_size модуля намеренно: чтобы взять медиану,
   * хватает нескольких смен, а чтобы оценить ещё и разброс — нужно заметно
   * больше. Оценка дисперсии по пяти точкам сама по себе почти случайна.
   */
  minSampleForModel?: number
  /**
   * Границы «обычного дня». По умолчанию — те же 25-й и 75-й перцентили,
   * которыми модуль уже описывает норму. Заводить для вероятностей отдельный
   * порог значило бы, что на экране рядом живут два разных понятия нормы.
   */
  lowQuantile?: number
  highQuantile?: number
}

const DEFAULTS = {
  minSampleForModel: 12,
  lowQuantile: 0.25,
  highQuantile: 0.75,
}

/**
 * Насколько сильно разрешено растягивать наблюдение по длительности.
 *
 * Смену вчетверо короче нельзя честно пересчитать в полную: за четыре часа
 * работы в обед поток идёт иначе, чем ровно четверть суточного. Поэтому
 * поправка ограничена — и это лучше, чем уверенно домножать на четыре.
 */
const EXPOSURE_CLAMP = { min: 0.5, max: 2 }

/**
 * Приводит наблюдения к длительности оцениваемой смены.
 *
 * Возвращает исходные значения, если длительностей нет: выдумывать поправку
 * там, где нечего поправлять, — худший из вариантов.
 */
function applyExposure(
  values: number[],
  exposures: Array<number | null> | undefined,
  targetExposure: number | null | undefined,
): number[] {
  if (!exposures || !targetExposure || targetExposure <= 0) return values
  return values.map((value, i) => {
    const exposure = exposures[i]
    if (!exposure || exposure <= 0) return value
    const ratio = Math.min(EXPOSURE_CLAMP.max, Math.max(EXPOSURE_CLAMP.min, targetExposure / exposure))
    return value * ratio
  })
}


/**
 * Уверенность в прогнозе спроса.
 *
 * Растёт с объёмом выборки и падает с разбросом. Считается одинаково для всех
 * трёх моделей, иначе переход между ними менял бы уверенность скачком без
 * всякой причины со стороны данных.
 */
function demandConfidence(sampleSize: number, dispersion: number | null): number {
  const bySample = clamp01(sampleSize / 30)
  if (dispersion === null) return clamp01(bySample * 0.8)
  // Разброс вдвое выше пуассоновского — ещё рабочая ситуация; вдесятеро —
  // сегмент разнородный, и доверять точечному прогнозу не стоит.
  const byDispersion = clamp01(1 / Math.max(1, dispersion / 2))
  return clamp01(bySample * (0.5 + 0.5 * byDispersion))
}

/**
 * Строит прогноз по историческим числам чеков сопоставимых смен.
 *
 * `samples` обязан приходить уже отфильтрованным по времени: только смены
 * строго ДО прогнозируемой. Утечка будущего здесь не проверяется — это
 * ответственность вызывающей стороны, и в тестах она проверяется отдельно.
 */
export function forecastDemand(samples: number[], options: DemandOptions = {}): DemandForecast | null {
  const opts = { ...DEFAULTS, ...options }
  const raw = samples.filter((value) => Number.isFinite(value) && value >= 0)
  if (raw.length === 0) return null

  // Поправка на длительность идёт ПЕРВОЙ и единственный раз: дальше по всему
  // конвейеру наблюдения считаются уже сопоставимыми по времени работы.
  const clean = applyExposure(raw, options.exposures, options.targetExposure)

  const sampleMean = mean(clean)
  if (sampleMean === null || sampleMean <= 0) return null

  const sampleVariance = variance(clean)
  const dispersion = sampleVariance !== null && sampleMean > 0 ? finiteOrNull(sampleVariance / sampleMean) : null

  const empiricalLow = quantile(clean, opts.lowQuantile) ?? sampleMean
  const empiricalHigh = quantile(clean, opts.highQuantile) ?? sampleMean

  // Ступень 1: хватает ли данных вообще на параметрическую модель.
  if (clean.length < opts.minSampleForModel || sampleVariance === null) {
    return empiricalForecast(clean, sampleMean, dispersion, empiricalLow, empiricalHigh, 'мало наблюдений в сегменте')
  }

  // Ступень 2: есть ли сверхдисперсия, ради которой стоит брать NB.
  const nb = fitNegativeBinomial(sampleMean, sampleVariance)
  if (nb) {
    // Квантили берутся аналитически из подгонки.
    //
    // Пробовали заодно учитывать неточность самой оценки параметров через
    // пересборку истории — на замерах это не дало ничего: интервал выходил
    // даже чуть уже, а покрытие не улучшалось. Оставлять сложность, которая
    // не окупается, незачем.
    //
    // Неточность оценки при этом реальна и видна: на пятнадцати сменах
    // диапазон накрывает факт в 77% случаев вместо 80%, на шестидесяти — в
    // 80%. Лечится это накоплением истории, а не усложнением формулы.
    const q = (p: number) => negativeBinomialQuantile(p, nb)
    const low = q(0.1)
    const high = q(0.9)
    return {
      model: 'negative_binomial',
      expectedReceipts: round1(nb.mu),
      medianReceipts: q(0.5),
      p10: low,
      p25: q(0.25),
      p50: q(0.5),
      p75: q(0.75),
      p90: high,
      interval80: { low, high },
      probabilityBelowExpected: clamp01(negativeBinomialCdf(Math.floor(nb.mu), nb)),
      probabilityLowDemand: clamp01(negativeBinomialCdf(Math.floor(empiricalLow), nb)),
      probabilityHighDemand: clamp01(1 - negativeBinomialCdf(Math.floor(empiricalHigh), nb)),
      dispersion: round2(nb.dispersion),
      sampleSize: clean.length,
      confidence: demandConfidence(clean.length, nb.dispersion),
      fallbackReason: null,
    }
  }

  // Ступень 3: разброса нет — Пуассон честнее и даёт более узкий интервал.
  const lambda = sampleMean
  const low = poissonQuantile(0.1, lambda)
  const high = poissonQuantile(0.9, lambda)
  return {
    model: 'poisson',
    expectedReceipts: round1(lambda),
    medianReceipts: poissonQuantile(0.5, lambda),
    p10: low,
    p25: poissonQuantile(0.25, lambda),
    p50: poissonQuantile(0.5, lambda),
    p75: poissonQuantile(0.75, lambda),
    p90: high,
    interval80: { low, high },
    probabilityBelowExpected: clamp01(poissonCdf(Math.floor(lambda), lambda)),
    probabilityLowDemand: clamp01(poissonCdf(Math.floor(empiricalLow), lambda)),
    probabilityHighDemand: clamp01(1 - poissonCdf(Math.floor(empiricalHigh), lambda)),
    dispersion: dispersion === null ? null : round2(dispersion),
    sampleSize: clean.length,
    confidence: demandConfidence(clean.length, dispersion),
    fallbackReason: 'разброс не превышает среднего — параметров сверхдисперсии нет',
  }
}

/** Нынешняя модель модуля: перцентили наблюдений как есть. */
function empiricalForecast(
  clean: number[],
  sampleMean: number,
  dispersion: number | null,
  empiricalLow: number,
  empiricalHigh: number,
  reason: string,
): DemandForecast {
  const q = (p: number) => quantile(clean, p) ?? sampleMean
  const low = q(0.1)
  const high = q(0.9)
  const below = clean.filter((v) => v < sampleMean).length / clean.length
  return {
    model: 'empirical',
    expectedReceipts: round1(sampleMean),
    medianReceipts: q(0.5),
    p10: low,
    p25: q(0.25),
    p50: q(0.5),
    p75: q(0.75),
    p90: high,
    interval80: { low, high },
    probabilityBelowExpected: clamp01(below),
    probabilityLowDemand: clamp01(clean.filter((v) => v <= empiricalLow).length / clean.length),
    probabilityHighDemand: clamp01(clean.filter((v) => v >= empiricalHigh).length / clean.length),
    dispersion: dispersion === null ? null : round2(dispersion),
    sampleSize: clean.length,
    confidence: demandConfidence(clean.length, dispersion),
    fallbackReason: reason,
  }
}

/**
 * Где в наблюдаемом распределении оказался факт.
 *
 * Это то, ради чего вся модель и нужна человеку: не «мало» и не «много», а
 * «поток был в нижних 14% ожидаемого» — с этим уже можно разговаривать.
 */
export function factPercentile(forecast: DemandForecast, actual: number): number | null {
  if (!Number.isFinite(actual)) return null
  const points: Array<[number, number]> = [
    [forecast.p10, 0.1],
    [forecast.p25, 0.25],
    [forecast.p50, 0.5],
    [forecast.p75, 0.75],
    [forecast.p90, 0.9],
  ]
  if (actual <= points[0][0]) return 0.1
  if (actual >= points[points.length - 1][0]) return 0.9
  for (let i = 1; i < points.length; i++) {
    const [x1, p1] = points[i - 1]
    const [x2, p2] = points[i]
    if (actual <= x2) {
      if (x2 === x1) return p2
      return clamp01(p1 + ((actual - x1) / (x2 - x1)) * (p2 - p1))
    }
  }
  return 0.9
}

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}
