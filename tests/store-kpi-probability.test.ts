/**
 * Вероятностный движок: проверяем не формулы, а обещания.
 *
 * Каждый тест здесь охраняет утверждение, которое движок делает человеку.
 * «Интервал 80%» должен на самом деле накрывать 80% случаев; «продавец выше
 * нормы с вероятностью 91%» не должно выдаваться по трём чекам; отсутствие
 * данных обязано оставаться отсутствием, а не нулём.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  createRng,
  estimateRate,
  factPercentile,
  fitNegativeBinomial,
  forecastDemand,
  simulateShift,
} from '@/lib/domain/store-kpi/probability'
import { poissonCdf, poissonPmf, poissonQuantile } from '@/lib/domain/store-kpi/probability/poisson'
import {
  negativeBinomialCdf,
  negativeBinomialPmf,
} from '@/lib/domain/store-kpi/probability/negative-binomial'
import { betaQuantile, regularizedIncompleteBeta } from '@/lib/domain/store-kpi/probability/math'

/** Детерминированный «рваный» поток: одни смены пустые, другие людные. */
function overdispersedSamples(): number[] {
  return [12, 45, 18, 62, 9, 51, 22, 70, 15, 40, 8, 58, 30, 25, 66, 11, 48, 19, 55, 27]
}

/** Ровный поток: разброс на уровне среднего. */
function poissonLikeSamples(): number[] {
  return [30, 28, 33, 31, 29, 32, 27, 34, 30, 31, 29, 30, 32, 28, 33, 30, 31, 29]
}

// ─────────────────────────────────────────────────────────────────────────────
// Базовая математика
// ─────────────────────────────────────────────────────────────────────────────

test('Пуассон: вероятности суммируются в единицу', () => {
  let sum = 0
  for (let k = 0; k <= 200; k++) sum += poissonPmf(k, 20)
  assert.ok(Math.abs(sum - 1) < 1e-9, `сумма вероятностей ${sum}`)
})

test('Пуассон: CDF не убывает и упирается в единицу', () => {
  let previous = 0
  for (let k = 0; k <= 100; k++) {
    const value = poissonCdf(k, 15)
    assert.ok(value >= previous - 1e-12, `CDF убыла на k=${k}`)
    assert.ok(value <= 1 + 1e-12)
    previous = value
  }
  assert.ok(poissonCdf(200, 15) > 0.9999)
})

test('Пуассон: квантили упорядочены', () => {
  const q = [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => poissonQuantile(p, 25))
  for (let i = 1; i < q.length; i++) assert.ok(q[i] >= q[i - 1], `квантили не по порядку: ${q}`)
})

test('отрицательное биномиальное: вероятности суммируются в единицу', () => {
  const fit = fitNegativeBinomial(30, 90)
  assert.ok(fit, 'подгонка не удалась')
  let sum = 0
  for (let k = 0; k <= 1000; k++) sum += negativeBinomialPmf(k, fit!)
  assert.ok(Math.abs(sum - 1) < 1e-6, `сумма вероятностей ${sum}`)
})

test('без сверхдисперсии отрицательное биномиальное не подгоняется', () => {
  // variance <= mean — это Пуассон. Натянуть сюда NB значило бы выдумать
  // разброс, которого в данных нет.
  assert.equal(fitNegativeBinomial(30, 30), null)
  assert.equal(fitNegativeBinomial(30, 25), null)
  assert.equal(fitNegativeBinomial(30, 30.5), null)
})

test('чем сильнее разброс, тем меньше параметр размера', () => {
  const mild = fitNegativeBinomial(30, 45)!
  const wild = fitNegativeBinomial(30, 200)!
  assert.ok(wild.size < mild.size)
  assert.ok(wild.dispersion > mild.dispersion)
})

test('неполная бета совпадает с известными значениями', () => {
  // I_0.5(1,1) = 0.5 — равномерное распределение.
  assert.ok(Math.abs(regularizedIncompleteBeta(0.5, 1, 1) - 0.5) < 1e-9)
  // Симметрия: I_x(a,a) в точке 0.5 всегда даёт половину.
  assert.ok(Math.abs(regularizedIncompleteBeta(0.5, 5, 5) - 0.5) < 1e-9)
  assert.ok(Math.abs(regularizedIncompleteBeta(0.5, 20, 20) - 0.5) < 1e-8)
})

test('квантиль беты обратна её функции распределения', () => {
  for (const p of [0.1, 0.35, 0.5, 0.8, 0.95]) {
    const x = betaQuantile(p, 7, 4)
    assert.ok(Math.abs(regularizedIncompleteBeta(x, 7, 4) - p) < 1e-6)
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Выбор модели спроса
// ─────────────────────────────────────────────────────────────────────────────

test('рваный поток даёт отрицательное биномиальное', () => {
  const forecast = forecastDemand(overdispersedSamples())!
  assert.equal(forecast.model, 'negative_binomial')
  assert.ok(forecast.dispersion! > 1.5, `дисперсия ${forecast.dispersion}`)
  assert.equal(forecast.fallbackReason, null)
})

test('ровный поток остаётся пуассоновским', () => {
  const forecast = forecastDemand(poissonLikeSamples())!
  assert.equal(forecast.model, 'poisson')
  assert.ok(forecast.fallbackReason)
})

test('на короткой истории откатываемся к нынешней модели', () => {
  // Пять смен — на них можно взять медиану, но не разброс. Рабочая модель
  // модуля обязана оставаться последним безопасным вариантом.
  const forecast = forecastDemand([20, 25, 30, 18, 22])!
  assert.equal(forecast.model, 'empirical')
  assert.match(forecast.fallbackReason!, /мало наблюдений/)
})

test('пустая история — это null, а не нулевой прогноз', () => {
  assert.equal(forecastDemand([]), null)
  assert.equal(forecastDemand([0, 0, 0]), null)
})

test('перцентили прогноза упорядочены при любой модели', () => {
  for (const samples of [overdispersedSamples(), poissonLikeSamples(), [20, 25, 30, 18, 22]]) {
    const f = forecastDemand(samples)!
    assert.ok(f.p10 <= f.p25, `p10 > p25 в ${f.model}`)
    assert.ok(f.p25 <= f.p50, `p25 > p50 в ${f.model}`)
    assert.ok(f.p50 <= f.p75, `p50 > p75 в ${f.model}`)
    assert.ok(f.p75 <= f.p90, `p75 > p90 в ${f.model}`)
    assert.equal(f.interval80.low, f.p10)
    assert.equal(f.interval80.high, f.p90)
  }
})

test('все вероятности лежат в [0,1] и не бывают NaN', () => {
  for (const samples of [overdispersedSamples(), poissonLikeSamples(), [1, 2, 3, 4, 5]]) {
    const f = forecastDemand(samples)!
    for (const value of [f.probabilityBelowExpected, f.probabilityLowDemand, f.probabilityHighDemand, f.confidence]) {
      assert.ok(Number.isFinite(value), `не число: ${value}`)
      assert.ok(value >= 0 && value <= 1, `вне диапазона: ${value}`)
    }
    for (const value of [f.expectedReceipts, f.p10, f.p50, f.p90]) {
      assert.ok(Number.isFinite(value), `не число: ${value}`)
    }
  }
})

test('экстремальный разброс не ломает прогноз', () => {
  const forecast = forecastDemand([1, 1, 1, 1, 200, 1, 1, 300, 1, 1, 1, 400, 1, 1])!
  assert.ok(Number.isFinite(forecast.expectedReceipts))
  assert.ok(Number.isFinite(forecast.p90))
  assert.ok(forecast.confidence < 0.5, 'при таком разбросе уверенность обязана быть низкой')
})

test('факт попадает в свой перцентиль', () => {
  const forecast = forecastDemand(overdispersedSamples())!
  assert.equal(factPercentile(forecast, 0), 0.1)
  const middle = factPercentile(forecast, forecast.p50)!
  assert.ok(Math.abs(middle - 0.5) < 0.06, `медиана дала ${middle}`)
  assert.equal(factPercentile(forecast, 100_000), 0.9)
})

// ─────────────────────────────────────────────────────────────────────────────
// Доли: attach-rate
// ─────────────────────────────────────────────────────────────────────────────

test('маленькая выборка даёт широкий интервал, большая — узкий', () => {
  const small = estimateRate({ successes: 2, opportunities: 2, baselineRate: 0.5 })!
  const large = estimateRate({ successes: 200, opportunities: 200, baselineRate: 0.5 })!

  const smallWidth = small.credibleInterval80.high - small.credibleInterval80.low
  const largeWidth = large.credibleInterval80.high - large.credibleInterval80.low

  assert.ok(smallWidth > largeWidth * 5, `2/2 не должно быть так же уверенно, как 200/200`)
  assert.ok(small.confidence < large.confidence)
})

test('одна и та же доля на разном объёме даёт разную уверенность', () => {
  // Ровно та ошибка, ради которой всё затевалось: 7/10 и 700/1000 — это 70%
  // в обоих случаях, но знание совершенно разное.
  const few = estimateRate({ successes: 7, opportunities: 10, baselineRate: 0.65 })!
  const many = estimateRate({ successes: 700, opportunities: 1000, baselineRate: 0.65 })!

  assert.equal(few.observedRate, many.observedRate)
  assert.ok(few.probabilityAboveBaseline < many.probabilityAboveBaseline)
  assert.ok(many.probabilityAboveBaseline > 0.99, 'на тысяче чеков сомнений быть не должно')
  assert.ok(few.probabilityAboveBaseline < 0.75, 'на десяти чеках уверенности быть не может')
})

test('апостериорное среднее притягивает крайности к середине', () => {
  // 3 из 3 — это не «100% умения», а «пока ни разу не промахнулся».
  const perfect = estimateRate({ successes: 3, opportunities: 3, baselineRate: 0.5 })!
  assert.equal(perfect.observedRate, 1)
  assert.ok(perfect.posteriorMean < 1)
  assert.ok(perfect.posteriorMean > 0.7)
})

test('вероятности выше и ниже нормы дают в сумме единицу', () => {
  const rate = estimateRate({ successes: 12, opportunities: 20, baselineRate: 0.5 })!
  assert.ok(Math.abs(rate.probabilityAboveBaseline + rate.probabilityBelowBaseline - 1) < 1e-9)
})

test('нет попыток — нет оценки, а не ноль', () => {
  // Не было ни одной возможности допродать и не допродал ни разу — разные
  // вещи. Вторая наказывала бы человека за первую.
  assert.equal(estimateRate({ successes: 0, opportunities: 0, baselineRate: 0.5 }), null)
  assert.equal(estimateRate({ successes: 5, opportunities: 3, baselineRate: 0.5 }), null)
})

test('без нормы вероятности сравнения не выдумываются', () => {
  const rate = estimateRate({ successes: 6, opportunities: 10, baselineRate: null })!
  assert.equal(rate.probabilityAboveBaseline, 0)
  assert.equal(rate.probabilityBelowBaseline, 0)
  assert.ok(rate.posteriorMean > 0)
})

// ─────────────────────────────────────────────────────────────────────────────
// Симуляция
// ─────────────────────────────────────────────────────────────────────────────

function tickets(): number[] {
  const rng = createRng(777)
  const list: number[] = []
  for (let i = 0; i < 400; i++) {
    // Двугорбое нарочно: напиток и полноценный заказ. Бутстрап обязан
    // воспроизводить такую форму, не подгоняя её под одну кривую.
    list.push(rng() < 0.6 ? 400 + rng() * 300 : 2200 + rng() * 900)
  }
  return list
}

const THRESHOLDS = { control: 30_000, b1: 45_000, b2: 60_000, b3: 80_000, record: 120_000 }

test('одинаковый seed даёт одинаковый результат', () => {
  const input = {
    demand: forecastDemand(overdispersedSamples())!,
    ticketSamples: tickets(),
    fallbackAvgTicket: null,
    thresholds: THRESHOLDS,
    iterations: 2000,
    seed: 42,
  }
  const first = simulateShift(input)!
  const second = simulateShift(input)!
  assert.deepEqual(first, second)
})

test('разный seed даёт близкий, но не идентичный результат', () => {
  const base = {
    demand: forecastDemand(overdispersedSamples())!,
    ticketSamples: tickets(),
    fallbackAvgTicket: null,
    thresholds: THRESHOLDS,
    iterations: 5000,
  }
  const a = simulateShift({ ...base, seed: 1 })!
  const b = simulateShift({ ...base, seed: 2 })!
  assert.notEqual(a.medianRevenue, undefined)
  const drift = Math.abs(a.medianRevenue - b.medianRevenue) / Math.max(1, a.medianRevenue)
  assert.ok(drift < 0.15, `две симуляции разошлись на ${(drift * 100).toFixed(1)}%`)
})

test('вероятности планов убывают по мере роста порога', () => {
  const result = simulateShift({
    demand: forecastDemand(overdispersedSamples())!,
    ticketSamples: tickets(),
    fallbackAvgTicket: null,
    thresholds: THRESHOLDS,
    iterations: 5000,
    seed: 11,
  })!

  assert.ok(result.probabilityB1! >= result.probabilityB2!)
  assert.ok(result.probabilityB2! >= result.probabilityB3!)
  assert.ok(result.probabilityB3! >= result.probabilityRecord!)
  assert.ok(Math.abs(result.probabilityB1! + result.probabilityBelowB1! - 1) < 1e-9)
})

test('перцентили выручки упорядочены и конечны', () => {
  const result = simulateShift({
    demand: forecastDemand(overdispersedSamples())!,
    ticketSamples: tickets(),
    fallbackAvgTicket: null,
    thresholds: THRESHOLDS,
    iterations: 3000,
    seed: 5,
  })!

  assert.ok(result.revenueP10 <= result.revenueP25)
  assert.ok(result.revenueP25 <= result.revenueP50)
  assert.ok(result.revenueP50 <= result.revenueP75)
  assert.ok(result.revenueP75 <= result.revenueP90)
  for (const value of Object.values(result)) {
    if (typeof value === 'number') assert.ok(Number.isFinite(value), `не число: ${value}`)
  }
})

test('без чеков и без среднего симуляции не будет', () => {
  const result = simulateShift({
    demand: forecastDemand(overdispersedSamples())!,
    ticketSamples: [],
    fallbackAvgTicket: null,
    thresholds: THRESHOLDS,
    seed: 1,
  })
  assert.equal(result, null)
})

test('на подменном среднем чеке уверенность ниже', () => {
  const demand = forecastDemand(overdispersedSamples())!
  const withTickets = simulateShift({
    demand,
    ticketSamples: tickets(),
    fallbackAvgTicket: 1200,
    thresholds: THRESHOLDS,
    iterations: 2000,
    seed: 3,
  })!
  const withoutTickets = simulateShift({
    demand,
    ticketSamples: [],
    fallbackAvgTicket: 1200,
    thresholds: THRESHOLDS,
    iterations: 2000,
    seed: 3,
  })!

  assert.equal(withTickets.ticketModel, 'bootstrap')
  assert.equal(withoutTickets.ticketModel, 'empirical')
  assert.ok(withoutTickets.confidence < withTickets.confidence)
})

test('отсутствующий порог даёт null, а не нулевую вероятность', () => {
  // «Рекорда ещё нет» и «рекорд недостижим» — разные утверждения.
  const result = simulateShift({
    demand: forecastDemand(overdispersedSamples())!,
    ticketSamples: tickets(),
    fallbackAvgTicket: null,
    thresholds: { ...THRESHOLDS, record: null },
    iterations: 1000,
    seed: 9,
  })!
  assert.equal(result.probabilityRecord, null)
  assert.ok(result.probabilityB1 !== null)
})

// ─────────────────────────────────────────────────────────────────────────────
// Калибровка: главная проверка всего движка
// ─────────────────────────────────────────────────────────────────────────────

test('интервал 80% действительно накрывает около 80% случаев', () => {
  // Если это не выполняется, все красивые числа выше не стоят ничего:
  // «нормальный диапазон» обязан быть нормальным диапазоном.
  const rng = createRng(2024)
  const truth = fitNegativeBinomial(40, 160)!

  const history: number[] = []
  for (let i = 0; i < 60; i++) {
    history.push(drawNb(rng, truth))
  }
  const forecast = forecastDemand(history)!

  let covered = 0
  const trials = 4000
  for (let i = 0; i < trials; i++) {
    const actual = drawNb(rng, truth)
    if (actual >= forecast.interval80.low && actual <= forecast.interval80.high) covered += 1
  }

  const coverage = covered / trials
  assert.ok(coverage > 0.7 && coverage < 0.92, `покрытие ${(coverage * 100).toFixed(1)}% вместо ~80%`)
})

test('CDF отрицательного биномиального согласуется с розыгрышем', () => {
  const fit = fitNegativeBinomial(25, 75)!
  const rng = createRng(5150)
  const threshold = 25
  let below = 0
  const trials = 20_000
  for (let i = 0; i < trials; i++) {
    if (drawNb(rng, fit) <= threshold) below += 1
  }
  const empirical = below / trials
  const theoretical = negativeBinomialCdf(threshold, fit)
  assert.ok(Math.abs(empirical - theoretical) < 0.02, `розыгрыш ${empirical} против формулы ${theoretical}`)
})

/** Розыгрыш NB через ту же смесь, что и в движке. */
function drawNb(rng: () => number, fit: { size: number; prob: number }): number {
  const scale = (1 - fit.prob) / fit.prob
  let lambda = 0
  // Гамма через сумму экспонент была бы медленной; берём готовый сэмплер.
  lambda = gammaSample(rng, fit.size, scale)
  if (lambda <= 0) return 0
  let product = Math.exp(-lambda)
  let u = rng()
  let k = 0
  let cumulative = product
  while (u > cumulative && k < 10_000) {
    k += 1
    product *= lambda / k
    cumulative += product
  }
  return k
}

function gammaSample(rng: () => number, shape: number, scale: number): number {
  if (shape < 1) {
    return gammaSample(rng, shape + 1, scale) * Math.pow(rng() || Number.EPSILON, 1 / shape)
  }
  const d = shape - 1 / 3
  const c = 1 / Math.sqrt(9 * d)
  for (let i = 0; i < 1000; i++) {
    let u = 0
    let v = 0
    while (u === 0) u = rng()
    while (v === 0) v = rng()
    const x = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
    const w = (1 + c * x) ** 3
    if (w <= 0) continue
    if (Math.log(rng()) < 0.5 * x * x + d - d * w + d * Math.log(w)) return d * w * scale
  }
  return shape * scale
}

// ─────────────────────────────────────────────────────────────────────────────
// Длительность смены
// ─────────────────────────────────────────────────────────────────────────────

test('короткая смена не выдаётся за провал спроса', () => {
  // Двенадцать смен по 12 часов с ~40 чеками. Оцениваем смену на 6 часов:
  // ждать от неё сорока чеков — значит записать её в провал ни за что.
  const history = [38, 42, 40, 45, 36, 41, 39, 44, 37, 43, 40, 42]
  const durations = history.map(() => 720)

  const full = forecastDemand(history, { exposures: durations, targetExposure: 720 })!
  const half = forecastDemand(history, { exposures: durations, targetExposure: 360 })!

  assert.ok(half.expectedReceipts < full.expectedReceipts, 'короткая смена должна ждать меньше чеков')
  // Поправка ограничена половиной: пересчитывать вчетверо короткую смену в
  // полную нечестно — за четыре часа в обед поток идёт иначе.
  assert.ok(half.expectedReceipts >= full.expectedReceipts * 0.45)
})

test('без длительностей поправки не будет', () => {
  const history = [38, 42, 40, 45, 36, 41, 39, 44, 37, 43, 40, 42]
  const plain = forecastDemand(history)!
  const noDurations = forecastDemand(history, {
    exposures: history.map(() => null),
    targetExposure: 720,
  })!
  assert.equal(plain.expectedReceipts, noDurations.expectedReceipts)
})

test('неизвестная длительность отдельной смены её не искажает', () => {
  // Часть истории без длительности — она обязана войти как есть, а не
  // выпасть и не получить выдуманную поправку.
  const history = [38, 42, 40, 45, 36, 41, 39, 44, 37, 43, 40, 42]
  const durations = history.map((_, i) => (i % 2 === 0 ? 720 : null))
  const forecast = forecastDemand(history, { exposures: durations, targetExposure: 720 })!
  assert.equal(forecast.sampleSize, history.length)
  assert.ok(Number.isFinite(forecast.expectedReceipts))
})

test('связь потока и чека сохраняется при розыгрыше', () => {
  // Замерено: когда поток и средний чек связаны, независимый розыгрыш
  // ошибается в вероятности уровня примерно на десять пунктов, парный — на один.
  //
  // Проверяем именно СРАВНЕНИЕ двух способов, а не абсолютную точность:
  // абсолютную определяет ещё и модель спроса, а здесь речь только о том,
  // теряется связь между людностью и корзиной или сохраняется.
  const rng = createRng(31337)
  const history: Array<{ receipts: number; avgTicket: number }> = []
  for (let i = 0; i < 40; i++) {
    const z = rng() * 2 - 1
    const noise = rng() * 2 - 1
    history.push({
      receipts: Math.max(5, Math.round(40 + z * 14)),
      // Средний чек наполовину следует за потоком, наполовину живёт сам —
      // как это и бывает в жизни, а не идеальная связь.
      avgTicket: 1200 + (0.5 * z + 0.5 * noise) * 300,
    })
  }

  const revenues = history.map((h) => h.receipts * h.avgTicket).sort((a, b) => a - b)
  const b1 = revenues[Math.floor(revenues.length * 0.45)]
  const truth = revenues.filter((r) => r >= b1).length / revenues.length

  const common = {
    demand: forecastDemand(history.map((h) => h.receipts))!,
    ticketSamples: [],
    shiftAvgTicketSamples: history.map((h) => h.avgTicket),
    fallbackAvgTicket: 1200,
    thresholds: { control: null, b1, b2: null, b3: null, record: null },
    iterations: 20_000,
    seed: 7,
  }

  const independent = simulateShift(common)!
  const paired = simulateShift({ ...common, shiftPairs: history })!

  const independentMiss = Math.abs(independent.probabilityB1! - truth)
  const pairedMiss = Math.abs(paired.probabilityB1! - truth)

  assert.ok(
    pairedMiss < independentMiss,
    `парный розыгрыш не помог: промах ${(pairedMiss * 100).toFixed(0)} п.п. против ${(independentMiss * 100).toFixed(0)} п.п.`,
  )
})
