/**
 * Бета-биномиальная оценка доли: attach-rate и любые конверсии «успех из попыток».
 *
 * Зачем это вообще нужно. Сейчас модуль сравнивает 70% и 65% как два числа. Но
 * 7 из 10 и 700 из 1000 — это одна и та же доля и совершенно разное знание.
 * За одну смену у продавца бывает десяток возможностей допродать, и на таком
 * объёме разница «выше нормы на 5 пунктов» неотличима от везения.
 *
 * Бета-распределение отвечает на правильный вопрос: не «какая доля вышла»,
 * а «насколько мы уверены, что истинное умение человека выше нормы».
 *
 * ВАЖНО ПРО ДАННЫЕ. Модель предполагает независимые попытки с исходом да/нет.
 * В store_kpi_shift_facts attach_opportunities — это сумма ВЕСОВ сработавших
 * правил, и один чек может дать несколько попыток. Такие псевдо-счётчики
 * биномиальными не являются: интервал по ним получится уже, чем имеем право.
 * Поэтому вход сюда обязан быть целыми попытками по чекам; за это отвечает
 * вызывающая сторона, а здесь мы дробные значения честно округляем вниз и
 * помечаем сниженной уверенностью.
 */

import { betaQuantile, clamp01, regularizedIncompleteBeta } from './math'
import type { RateEstimate } from './types'

/**
 * Априорное распределение.
 *
 * Beta(1,1) — равномерное: «до наблюдений про человека не знаем ничего».
 * Взято намеренно слабым. Более сильный априор (например, вокруг нормы точки)
 * притягивал бы новичка к средним значениям и мешал увидеть, что он реально
 * работает иначе, — а именно это модуль и должен показывать.
 */
export const DEFAULT_PRIOR = { alpha: 1, beta: 1 }

export type RateInput = {
  successes: number
  opportunities: number
  /**
   * Норма для сравнения — доля у остальных кассиров в сопоставимых сменах.
   * null означает «нормы нет», и тогда вероятности сравнения не считаются.
   */
  baselineRate: number | null
  prior?: { alpha: number; beta: number }
}

/**
 * Оценка доли с честным интервалом.
 *
 * Возвращает null, если попыток не было вовсе. Ноль здесь был бы враньём:
 * «не было ни одной возможности допродать» и «не допродал ни разу» — разные
 * вещи, и вторая наказывает человека за первую.
 */
export function estimateRate(input: RateInput): RateEstimate | null {
  const opportunities = Math.floor(Number(input.opportunities) || 0)
  const successes = Math.floor(Number(input.successes) || 0)

  if (!Number.isFinite(opportunities) || opportunities <= 0) return null
  // Успехов больше, чем попыток, быть не может: это сломанные входные данные,
  // и молча их «поправить» опаснее, чем отказаться считать.
  if (!Number.isFinite(successes) || successes < 0 || successes > opportunities) return null

  const prior = input.prior || DEFAULT_PRIOR
  const alpha = prior.alpha + successes
  const beta = prior.beta + (opportunities - successes)

  const posteriorMean = alpha / (alpha + beta)
  const low = betaQuantile(0.1, alpha, beta)
  const high = betaQuantile(0.9, alpha, beta)

  let probabilityAbove = 0
  let probabilityBelow = 0
  if (input.baselineRate !== null && Number.isFinite(input.baselineRate)) {
    const baseline = clamp01(input.baselineRate)
    // P(доля > нормы) = 1 − CDF(норма). Это и есть ответ на вопрос владельца
    // «он правда лучше или повезло».
    probabilityAbove = clamp01(1 - regularizedIncompleteBeta(baseline, alpha, beta))
    probabilityBelow = clamp01(1 - probabilityAbove)
  }

  return {
    successes,
    opportunities,
    observedRate: opportunities > 0 ? successes / opportunities : null,
    posteriorMean: clamp01(posteriorMean),
    credibleInterval80: { low: clamp01(low), high: clamp01(high) },
    probabilityAboveBaseline: probabilityAbove,
    probabilityBelowBaseline: probabilityBelow,
    confidence: confidenceFromWidth(high - low),
  }
}

/**
 * Уверенность из ширины интервала.
 *
 * Ширина — самая честная мера: она сама учитывает и объём выборки, и то,
 * насколько доля близка к краям. При 2 из 2 интервал почти во всю шкалу, и
 * уверенность выходит низкой — как и должно быть.
 */
function confidenceFromWidth(width: number): number {
  if (!Number.isFinite(width)) return 0
  return clamp01(1 - width)
}
