import 'server-only'

/**
 * Вероятностный слой поверх разбора смен — сборка данных для него.
 *
 * Здесь только доставка и подготовка: вся математика живёт в
 * lib/domain/store-kpi/probability и о базе ничего не знает.
 *
 * Слой работает в теневом режиме. Он считается рядом с существующим разбором и
 * ничего в нём не меняет: ни балла продавца, ни планов, ни выплат. Право
 * что-то менять он получит только после бэктеста, который покажет, что новая
 * модель лучше старой, — а не просто сложнее.
 */

import {
  addFactToBaselineIndex,
  emptyBaselineIndex,
  lookupBaseline,
  lookupBaselineSamples,
} from '@/lib/domain/store-kpi/baseline'
import { deflate, priceIndexFor, type PriceIndex } from '@/lib/domain/store-kpi/price-index'
import type { StoreKpiSettings } from '@/lib/domain/store-kpi/settings'
import type { ShiftFact } from '@/lib/domain/store-kpi/types'
import {
  estimateRate,
  factPercentile,
  forecastDemand,
  seedFromString,
  simulateShift,
  type DemandForecast,
  type MonteCarloForecast,
  type RateEstimate,
} from '@/lib/domain/store-kpi/probability'
import { fetchAllPages } from '@/lib/server/point-sales-core'

type AnyClient = any

/** Сумма одного чека, приведённая к сегодняшним ценам. */
export type ReceiptSample = { date: string; shift: string; amount: number }

/**
 * Отдельные чеки за период.
 *
 * Нужны затем, чтобы разыгрывать настоящие суммы вместо подгонки под кривую.
 * Берутся отдельным запросом, а не через RPC смен: тащить тысячи строк чеков
 * в расчёт, которому нужны агрегаты, — верный способ сделать медленным всё
 * сразу.
 *
 * Постранично: PostgREST молча режет ответ до 1000 строк, а чеков за три
 * месяца заметно больше — обрезанная выборка тихо исказила бы распределение.
 */
export async function loadReceiptSamples(
  supabase: AnyClient,
  args: { companyId: string; from: string; to: string; priceIndex: PriceIndex },
): Promise<ReceiptSample[]> {
  const rows = await fetchAllPages((from, to) =>
    supabase
      .from('point_sales')
      .select('sale_date, shift, total_amount')
      .eq('company_id', args.companyId)
      .gte('sale_date', args.from)
      .lte('sale_date', args.to)
      .gt('total_amount', 0)
      .order('sale_date', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )

  const out: ReceiptSample[] = []
  for (const row of rows || []) {
    const date = String((row as any).sale_date)
    const amount = Number((row as any).total_amount)
    if (!Number.isFinite(amount) || amount <= 0) continue
    // Дефляция обязательна: без неё подорожание меню читалось бы как рост
    // спроса, а прогноз выручки уезжал бы вверх сам по себе.
    out.push({
      date,
      shift: String((row as any).shift || 'day'),
      amount: deflate(amount, priceIndexFor(args.priceIndex, date)),
    })
  }
  return out
}

export type ShiftProbability = {
  date: string
  shift: string
  /** Прогноз потока. К оценке продавца отношения не имеет. */
  demand: DemandForecast | null
  /** Где в ожидаемом распределении оказался факт: 0.14 — «нижние 14%». */
  fact_percentile: number | null
  /** Допродажи с поправкой на объём выборки. */
  attach: RateEstimate | null
  /** Вероятности планов. null, если план на смену не публиковался. */
  simulation: MonteCarloForecast | null
  segment_level: string | null
}

export type ProbabilisticLayer = {
  model_version: 'probabilistic-v1'
  shifts: ShiftProbability[]
  /** Сколько раз распределение подгонялось и сколько раз взято из кэша. */
  performance: { fits: number; cache_hits: number; ms: number }
}

export type PlanThresholdMap = Map<
  string,
  { control: number | null; b1: number | null; b2: number | null; b3: number | null; record: number | null }
>

/**
 * Считает вероятностный слой для смен периода.
 *
 * История наращивается по ходу: прогнозируя смену, модель видит только то, что
 * было известно до её начала. Смена добавляется в базу ПОСЛЕ того, как по ней
 * сделан прогноз, — за счёт этого утечка будущего невозможна не потому, что мы
 * её проверяем, а потому, что для неё нет пути.
 */
export function buildProbabilisticLayer(args: {
  baselineFacts: ShiftFact[]
  targetFacts: ShiftFact[]
  settings: StoreKpiSettings
  receipts: ReceiptSample[]
  /** Опубликованные планы: ключ «дата|смена». Меняться от прогноза не могут. */
  plans: PlanThresholdMap
  iterations?: number
}): ProbabilisticLayer {
  const started = Date.now()
  const summerMonths = args.settings.summer_months
  const minSample = args.settings.min_sample_size

  const receiptsIndex = emptyBaselineIndex()
  const avgTicketIndex = emptyBaselineIndex()
  const attachIndex = emptyBaselineIndex()

  // Чеки по сменам: нужны, чтобы собрать выборку сумм для сопоставимых смен.
  const receiptsByShift = new Map<string, number[]>()
  for (const sample of args.receipts) {
    const key = sample.date + '|' + sample.shift
    const list = receiptsByShift.get(key)
    if (list) list.push(sample.amount)
    else receiptsByShift.set(key, [sample.amount])
  }

  const remember = (fact: ShiftFact) => {
    const receipts = Number.isFinite(fact.receipts) ? fact.receipts : null
    // В базу — в ценах базового месяца, ровно как это делает рабочий модуль.
    // Иначе подорожание меню накапливалось бы в норме и выглядело ростом.
    const revenue = Number.isFinite(fact.revenue) ? fact.revenue / priceOf(fact) : null
    addFactToBaselineIndex(receiptsIndex, fact, receipts, { summerMonths })
    addFactToBaselineIndex(
      avgTicketIndex,
      fact,
      receipts !== null && receipts > 0 && revenue !== null ? revenue / receipts : null,
      { summerMonths },
    )
    addFactToBaselineIndex(
      attachIndex,
      fact,
      receipts !== null && receipts > 0 ? fact.receipts_2plus / receipts : null,
      { summerMonths },
    )
  }

  for (const fact of args.baselineFacts) remember(fact)

  const ordered = [...args.targetFacts].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1
    if (a.shift === b.shift) return 0
    return a.shift === 'day' ? -1 : 1
  })

  const demandCache = new Map<string, DemandForecast | null>()
  let fits = 0
  let cacheHits = 0

  const shifts: ShiftProbability[] = []

  for (const fact of ordered) {
    const lookupOpts = { minSample, summerMonths }
    const samples = lookupBaselineSamples(receiptsIndex, fact, lookupOpts)

    let demand: DemandForecast | null = null
    if (samples) {
      // Длительность целевой смены — часть ключа: тот же сегмент, но смена
      // вдвое короче, даёт другой прогноз, и отдать ей кэш полной смены
      // значило бы вернуть заведомо завышенное ожидание.
      const key = sampleKey(samples.level, samples.values) + '|' + (fact.duration_minutes ?? 'x')
      if (demandCache.has(key)) {
        demand = demandCache.get(key) ?? null
        cacheHits += 1
      } else {
        demand = forecastDemand(samples.values, {
          // Поправка на длительность: сравнивать полную смену с укороченной
          // как равные — значит записать короткую в провал спроса.
          exposures: samples.durations,
          targetExposure: fact.duration_minutes ?? null,
        })
        demandCache.set(key, demand)
        fits += 1
      }
    }

    // ── Допродажи ────────────────────────────────────────────────────────
    // Считаем по ЧЕКАМ, а не по attach_opportunities: последние — сумма весов
    // правил, один чек может дать несколько попыток, и биномиальной моделью
    // такие псевдо-счётчики описывать нельзя, интервал вышел бы уже, чем мы
    // имеем право утверждать. «Чек с двумя и более позициями» — честное
    // испытание с исходом да или нет, и это ровно то, что владелец называет
    // допродажей: рамен и напиток в одном чеке.
    const attachHit = lookupBaseline(attachIndex, fact, {
      ...lookupOpts,
      percentile: 0.5,
      // Норму формируют остальные: у того, кто отработал большинство смен,
      // она подстроилась бы под него самого, и отличиться от себя он не смог
      // бы ни в плюс, ни в минус.
      excludeCashierId: fact.cashier_id,
    })
    const attach =
      Number.isFinite(fact.receipts) && fact.receipts > 0
        ? estimateRate({
            successes: Math.round(fact.receipts_2plus),
            opportunities: Math.round(fact.receipts),
            baselineRate: attachHit?.value ?? null,
          })
        : null

    // ── Вероятности планов ───────────────────────────────────────────────
    const plan = args.plans.get(fact.date + '|' + fact.shift) || null
    let simulation: MonteCarloForecast | null = null
    if (demand && plan) {
      // Всё, что пришло из истории, лежит в ценах базового месяца, а пороги
      // плана объявлены в сегодняшних деньгах. Без обратного пересчёта
      // симуляция сравнивала бы прошлогодние чеки с нынешними порогами и
      // систематически занижала вероятность взять уровень.
      const prices = priceOf(fact)
      const ticketSamples = comparableReceiptAmounts(receiptsByShift, args.baselineFacts, fact).map(
        (amount) => amount * prices,
      )
      const avgTickets = lookupBaselineSamples(avgTicketIndex, fact, lookupOpts)
      const avgTicketHit = lookupBaseline(avgTicketIndex, fact, { ...lookupOpts, percentile: 0.5 })

      simulation = simulateShift({
        demand,
        ticketSamples,
        shiftAvgTicketSamples: (avgTickets?.values || []).map((v) => v * prices),
        shiftPairs: pairsFromSegment(avgTickets, prices),
        fallbackAvgTicket: avgTicketHit ? avgTicketHit.value * prices : null,
        thresholds: plan,
        iterations: args.iterations ?? 10_000,
        seed: seedFromString(fact.company_id + '|' + fact.date + '|' + fact.shift),
      })
      fits += 1
    }

    shifts.push({
      date: fact.date,
      shift: fact.shift,
      demand,
      fact_percentile: demand ? factPercentile(demand, fact.receipts) : null,
      attach,
      simulation,
      segment_level: samples?.level ?? null,
    })

    // И только теперь смена становится историей.
    remember(fact)
  }

  return {
    model_version: 'probabilistic-v1',
    shifts,
    performance: { fits, cache_hits: cacheHits, ms: Date.now() - started },
  }
}

/**
 * Суммы чеков из сопоставимых прошлых смен.
 *
 * Берём тот же день недели и ту же смену — иначе в выборку попадут субботние
 * чеки для оценки вторника. Ограничиваем последними двенадцатью сменами:
 * полугодовой давности чек о сегодняшнем меню говорит мало.
 */
function comparableReceiptAmounts(
  receiptsByShift: Map<string, number[]>,
  baselineFacts: ShiftFact[],
  fact: ShiftFact,
): number[] {
  const targetDow = new Date(fact.date + 'T00:00:00Z').getUTCDay()
  const comparable = baselineFacts
    .filter((f) => f.date < fact.date && f.shift === fact.shift)
    .filter((f) => new Date(f.date + 'T00:00:00Z').getUTCDay() === targetDow)
    .slice(-12)

  const out: number[] = []
  for (const other of comparable) {
    const list = receiptsByShift.get(other.date + '|' + other.shift)
    if (list) out.push(...list)
  }
  return out
}

/**
 * Пары «поток — средний чек» ИЗ ТОГО ЖЕ СЕГМЕНТА.
 *
 * Именно из того же: чек субботнего вечера ничего не говорит о вторнике, и
 * собирать пары со всех смен подряд значит подменить чеки сегмента чеками
 * откуда угодно. На боевых данных такая подмена заметно испортила калибровку.
 */
function pairsFromSegment(
  samples: { values: number[]; receipts: Array<number | null> } | null,
  prices: number,
): Array<{ receipts: number; avgTicket: number }> {
  if (!samples) return []
  const out: Array<{ receipts: number; avgTicket: number }> = []
  for (let i = 0; i < samples.values.length; i++) {
    const receipts = samples.receipts[i]
    const ticket = samples.values[i]
    if (receipts === null || !Number.isFinite(receipts) || receipts <= 0) continue
    if (!Number.isFinite(ticket) || ticket <= 0) continue
    out.push({ receipts, avgTicket: ticket * prices })
  }
  return out
}

/** Множитель цен смены: 1, если индекса нет. */
function priceOf(fact: ShiftFact): number {
  const value = Number(fact.price_index)
  return Number.isFinite(value) && value > 0 ? value : 1
}

function sampleKey(level: string, values: number[]): string {
  let sum = 0
  for (const value of values) sum += value
  return level + '|' + values.length + '|' + sum
}
