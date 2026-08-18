/**
 * Отрицательное биномиальное распределение — модель «рваного» потока.
 *
 * Смысл простой. Пуассон говорит: интенсивность потока всегда одна и та же.
 * Отрицательное биномиальное говорит: интенсивность сама по себе гуляет ото
 * дня ко дню (турнир, дождь, стипендия), и мы наблюдаем смесь пуассоновских
 * дней с разной интенсивностью. Из-за этой смеси разброс получается больше,
 * чем у Пуассона, — то самое «variance > mean».
 *
 * Параметризация через среднее μ и размер r:
 *   variance = μ + μ² / r
 * Чем меньше r, тем сильнее разброс. При r → ∞ получается ровно Пуассон.
 *
 * Оценка параметров — методом моментов. Не потому что он самый точный, а
 * потому что он устойчив на маленьких выборках: у нас сегмент — это полтора
 * десятка смен, и итеративное максимальное правдоподобие там регулярно
 * убегает в бесконечность, что хуже, чем чуть менее точный, но живой ответ.
 */

import { clamp01, logGamma, sampleGamma } from './math'
import { samplePoisson } from './poisson'

export type NegativeBinomialFit = {
  /** Среднее. */
  mu: number
  /** Параметр размера r: чем меньше, тем сильнее разброс. */
  size: number
  /** Вероятность «успеха» в стандартной параметризации. */
  prob: number
  /** variance / mean — во сколько раз поток разбросаннее пуассоновского. */
  dispersion: number
}

/**
 * Подгонка по среднему и дисперсии.
 *
 * Возвращает null, когда распределение не отрицательное биномиальное по сути
 * дела: разброс не превышает среднего. Это не ошибка и не сбой — это ответ
 * «здесь достаточно Пуассона», и подменять его натянутым NB нельзя.
 */
export function fitNegativeBinomial(sampleMean: number, sampleVariance: number): NegativeBinomialFit | null {
  if (!Number.isFinite(sampleMean) || !Number.isFinite(sampleVariance)) return null
  if (sampleMean <= 0) return null

  // Требуем ощутимого превышения, а не любого. При variance/mean = 1.02
  // «сверхдисперсия» — это шум выборки, а r улетит в тысячи и распределение
  // всё равно станет пуассоновским, только через кривой обходной путь.
  if (sampleVariance <= sampleMean * 1.05) return null

  const size = (sampleMean * sampleMean) / (sampleVariance - sampleMean)
  if (!Number.isFinite(size) || size <= 0) return null

  const prob = size / (size + sampleMean)
  if (!Number.isFinite(prob) || prob <= 0 || prob >= 1) return null

  return {
    mu: sampleMean,
    size,
    prob,
    dispersion: sampleVariance / sampleMean,
  }
}

export function negativeBinomialPmf(k: number, fit: NegativeBinomialFit): number {
  if (!Number.isFinite(k) || k < 0) return 0
  const n = Math.round(k)
  const { size, prob } = fit
  const logP =
    logGamma(n + size) -
    logGamma(size) -
    logGamma(n + 1) +
    size * Math.log(prob) +
    n * Math.log(1 - prob)
  const value = Math.exp(logP)
  return Number.isFinite(value) ? value : 0
}

export function negativeBinomialCdf(k: number, fit: NegativeBinomialFit): number {
  if (k < 0) return 0
  const n = Math.floor(k)
  let sum = 0
  for (let i = 0; i <= n; i++) {
    sum += negativeBinomialPmf(i, fit)
    if (sum >= 1) return 1
  }
  return clamp01(sum)
}

export function negativeBinomialQuantile(p: number, fit: NegativeBinomialFit): number {
  const target = clamp01(p)
  let sum = 0
  let k = 0
  // Хвост у NB тяжелее пуассоновского, поэтому потолок берём с запасом от
  // среднего и разброса, а не фиксированный.
  const limit = Math.max(1000, Math.ceil(fit.mu * 10 + fit.dispersion * 100 + 100))
  while (sum < target && k <= limit) {
    sum += negativeBinomialPmf(k, fit)
    if (sum >= target) return k
    k += 1
  }
  return k
}

/**
 * Розыгрыш через смесь: сначала выбираем интенсивность этого конкретного дня,
 * потом считаем по ней чеки. Это не трюк ради скорости, а буквальная запись
 * того, что модель утверждает про мир.
 */
export function sampleNegativeBinomial(rng: () => number, fit: NegativeBinomialFit): number {
  const scale = (1 - fit.prob) / fit.prob
  const lambda = sampleGamma(rng, fit.size, scale)
  if (!Number.isFinite(lambda) || lambda <= 0) return 0
  return samplePoisson(rng, lambda)
}
