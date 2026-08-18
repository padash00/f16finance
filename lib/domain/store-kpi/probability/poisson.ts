/**
 * Пуассон — простейшая модель счётного спроса.
 *
 * Предполагает, что покупатели заходят независимо друг от друга с постоянной
 * интенсивностью. У него одно свойство, из-за которого он часто не подходит
 * магазину: дисперсия равна среднему. В жизни бывает иначе — в один вечер
 * толпа после турнира, в другой пусто, — и тогда нужен отрицательный биномиальный.
 *
 * Держим Пуассона отдельно и всерьёз: когда разброс действительно небольшой,
 * он даёт более узкий и более честный интервал, чем NB с выдуманной
 * сверхдисперсией.
 */

import { clamp01, logGamma, sampleNormal } from './math'

export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isFinite(k) || !Number.isFinite(lambda) || k < 0 || lambda <= 0) return 0
  const n = Math.round(k)
  return Math.exp(n * Math.log(lambda) - lambda - logGamma(n + 1))
}

export function poissonCdf(k: number, lambda: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0
  if (k < 0) return 0
  const n = Math.floor(k)
  let sum = 0
  let term = Math.exp(-lambda)
  sum += term
  for (let i = 1; i <= n; i++) {
    term *= lambda / i
    sum += term
    if (sum >= 1) return 1
  }
  return clamp01(sum)
}

/**
 * Квантиль: наименьшее k, при котором CDF(k) >= p.
 *
 * Считаем накопительно за один проход — вызывать CDF в цикле означало бы
 * пересчитывать одну и ту же сумму десятки раз.
 */
export function poissonQuantile(p: number, lambda: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0
  const target = clamp01(p)
  let sum = 0
  let term = Math.exp(-lambda)
  sum += term
  let k = 0
  // Потолок с большим запасом: при разумной интенсивности сюда не доходит,
  // но бесконечный цикл в отчёте недопустим.
  const limit = Math.max(1000, Math.ceil(lambda * 10 + 100))
  while (sum < target && k < limit) {
    k += 1
    term *= lambda / k
    sum += term
  }
  return k
}

/**
 * Розыгрыш значения.
 *
 * Малая интенсивность — метод Кнута (перемножаем равномерные, пока не уйдём
 * под e^−λ). Большая — нормальное приближение: при λ в сотни метод Кнута
 * делает сотни итераций на одну симуляцию, а Monte Carlo зовёт его десять
 * тысяч раз.
 */
export function samplePoisson(rng: () => number, lambda: number): number {
  if (!Number.isFinite(lambda) || lambda <= 0) return 0
  if (lambda < 30) {
    const threshold = Math.exp(-lambda)
    let product = rng()
    let k = 0
    while (product > threshold) {
      k += 1
      product *= rng()
      if (k > 1000) break
    }
    return k
  }
  const value = Math.round(lambda + Math.sqrt(lambda) * sampleNormal(rng))
  return value < 0 ? 0 : value
}
