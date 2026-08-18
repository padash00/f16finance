/**
 * Типы вероятностного слоя.
 *
 * Главный принцип тот же, что и во всём модуле: отсутствие данных остаётся
 * null. Прогноз, которого нет, не должен приходить нулём — ноль означал бы
 * «ожидаем ноль чеков», а это совсем другое утверждение.
 */

/** Какой моделью в итоге посчитали спрос. */
export type DemandModel = 'negative_binomial' | 'poisson' | 'empirical'

/**
 * Какой моделью считали сумму чека. Порядок — от лучшего к худшему:
 *
 * `bootstrap`      — разыгрываем настоящие отдельные чеки. Точнее всего.
 * `shift_average`  — разыгрываем средний чек целой смены из истории. Отдельных
 *                    чеков нет, но день-в-день средний чек всё равно гуляет, и
 *                    этот разброс мы знаем — значит, обязаны его учесть.
 * `lognormal`      — подгонка кривой. Только если форма распределения её терпит.
 * `empirical`      — средний чек константой. Худший вариант: занижает разброс
 *                    выручки, а значит делает вероятности планов самоувереннее,
 *                    чем позволяют данные.
 */
export type TicketModel = 'bootstrap' | 'shift_average' | 'lognormal' | 'empirical'

export type Interval = { low: number; high: number }

/**
 * Прогноз спроса на смену.
 *
 * Спрос — это поток, а не работа продавца. Ни одно число отсюда не имеет
 * права попасть в оценку кассира: слабый поток не делает человека плохим, а
 * сильный — хорошим.
 */
export type DemandForecast = {
  model: DemandModel
  expectedReceipts: number
  medianReceipts: number

  p10: number
  p25: number
  p50: number
  p75: number
  p90: number

  interval80: Interval

  /** Вероятность, что факт окажется ниже ожидания. */
  probabilityBelowExpected: number
  /** Вероятность слабого потока — ниже нижней границы обычного дня. */
  probabilityLowDemand: number
  /** Вероятность сильного потока — выше верхней границы обычного дня. */
  probabilityHighDemand: number

  /**
   * Отношение дисперсии к среднему. Больше единицы — поток «рваный»,
   * и Пуассона недостаточно. null, если считать не на чем.
   */
  dispersion: number | null

  sampleSize: number
  confidence: number
  /** Почему не взяли модель посильнее. null — взяли ту, что хотели. */
  fallbackReason: string | null
}

/**
 * Оценка доли (attach-rate и подобные конверсии).
 *
 * Ради этой структуры всё и затевалось: 7 из 10 и 700 из 1000 дают одну и ту
 * же долю, но совершенно разную уверенность, а сейчас модуль сравнивает их
 * как равные.
 */
export type RateEstimate = {
  successes: number
  opportunities: number

  /** Наблюдённая доля. null, если попыток не было вовсе. */
  observedRate: number | null

  /** Среднее апостериорного распределения — доля с поправкой на объём. */
  posteriorMean: number

  credibleInterval80: Interval

  probabilityAboveBaseline: number
  probabilityBelowBaseline: number

  confidence: number
}

/** Распределение суммы одного чека. */
export type TicketForecast = {
  model: TicketModel
  medianTicket: number
  expectedTicket: number

  p10: number
  p25: number
  p50: number
  p75: number
  p90: number

  /** Сигма логарифма — только для логнормали, иначе null. */
  sigmaLog: number | null

  sampleSize: number
  confidence: number
  unavailableReason: string | null
}

/** Пороги плана, против которых считаются вероятности. */
export type PlanThresholds = {
  control: number | null
  b1: number | null
  b2: number | null
  b3: number | null
  record: number | null
}

/**
 * Итог симуляции.
 *
 * Это прогноз, а не пересчёт плана. Опубликованные B1/B2/B3 остаются какими
 * были: модель говорит, с какой вероятностью их возьмут, и молчит о том,
 * какими они должны быть.
 */
export type MonteCarloForecast = {
  iterations: number

  expectedRevenue: number
  medianRevenue: number

  revenueP10: number
  revenueP25: number
  revenueP50: number
  revenueP75: number
  revenueP90: number

  interval80: Interval

  probabilityB1: number | null
  probabilityB2: number | null
  probabilityB3: number | null
  probabilityRecord: number | null
  probabilityBelowB1: number | null

  demandModel: DemandModel
  ticketModel: TicketModel
  confidence: number
}

/** Паспорт прогноза: чем считали и на чём. Без него бэктест бесполезен. */
export type ForecastProvenance = {
  modelVersion: 'probabilistic-v1'
  demandModel: DemandModel
  ticketModel: TicketModel
  sampleSize: number
  segmentLevel: string
  fallbackReason: string | null
}
