/**
 * Инварианты: чего вероятностный слой делать НЕ должен.
 *
 * Эти тесты не про точность и не про формулы. Они охраняют обещания, данные
 * людям: план объявляется заранее и не меняется, выплата считается не по
 * прогнозу, а норма для продавца не берётся из его же смен.
 *
 * Сломать такое легко и незаметно — одной строкой в модуле, который вроде бы
 * «только считает вероятности». Поэтому проверяем прямо.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { forecastDemand, simulateShift } from '@/lib/domain/store-kpi/probability'
import { compareRevenue } from '@/lib/domain/store-kpi/probability/backtest'
import { walkForward } from '@/lib/domain/store-kpi/probability/walk-forward'
import { buildBaselineIndex, lookupBaseline, lookupBaselineSamples } from '@/lib/domain/store-kpi/baseline'
import { DEFAULT_STORE_KPI_SETTINGS } from '@/lib/domain/store-kpi/settings'
import { resolveBonus } from '@/lib/domain/store-kpi'
import type { ShiftFact, ShiftPlan } from '@/lib/domain/store-kpi'

const SETTINGS = DEFAULT_STORE_KPI_SETTINGS
const HISTORY = [30, 45, 38, 52, 41, 33, 49, 36, 44, 39, 47, 42]
const AVG_TICKETS = [1100, 1250, 1180, 1320, 1090, 1210, 1150, 1270, 1130, 1240]

function fact(patch: Partial<ShiftFact>): ShiftFact {
  return {
    company_id: 'c1',
    date: '2026-06-01',
    shift: 'day',
    cashier_id: 'op1',
    revenue: 50_000,
    gross_revenue: 50_000,
    refunds: 0,
    receipts: 40,
    items: 60,
    lines: 60,
    receipts_2plus: 20,
    receipts_3plus: 5,
    attach_opportunities: 10,
    attach_success: 4,
    cogs: 20_000,
    discount_amount: 0,
    discounted_receipts: 0,
    unique_skus: 12,
    price_index: 1,
    ...patch,
  } as ShiftFact
}

const PLAN: ShiftPlan = {
  control: 30_000,
  b1: 45_000,
  b2: 60_000,
  b3: 80_000,
  record_threshold: 120_000,
  monthly_index: 1,
  level: 'season_weekday_shift',
  sample: 20,
}

test('симуляция не трогает опубликованный план', () => {
  // План — обещание, объявленное заранее. Если прогноз способен его подвинуть,
  // обещания не было.
  const thresholds = { control: 30_000, b1: 45_000, b2: 60_000, b3: 80_000, record: 120_000 }
  const before = JSON.stringify(thresholds)

  const demand = forecastDemand(HISTORY)!
  simulateShift({
    demand,
    ticketSamples: [],
    shiftAvgTicketSamples: AVG_TICKETS,
    fallbackAvgTicket: 1200,
    thresholds,
    iterations: 500,
    seed: 1,
  })

  assert.equal(JSON.stringify(thresholds), before, 'симуляция изменила пороги плана')
})

test('выплата не зависит от прогноза', () => {
  // Бонус считается по факту выручки и опубликованному плану. Прогноз в эту
  // формулу входить не имеет права: иначе смена с «неудачным прогнозом»
  // платила бы меньше при той же кассе.
  const revenue = 62_000
  const before = resolveBonus(revenue, PLAN, SETTINGS)

  const demand = forecastDemand(HISTORY)!
  simulateShift({
    demand,
    ticketSamples: [],
    shiftAvgTicketSamples: AVG_TICKETS,
    fallbackAvgTicket: 1200,
    thresholds: {
      control: PLAN.control,
      b1: PLAN.b1,
      b2: PLAN.b2,
      b3: PLAN.b3,
      record: PLAN.record_threshold,
    },
    iterations: 500,
    seed: 2,
  })

  const after = resolveBonus(revenue, PLAN, SETTINGS)
  assert.deepEqual(after, before)
})

test('норма продавца не берётся из его же смен', () => {
  // У того, кто отработал большинство смен сегмента, норма подстроилась бы под
  // него самого, и отличиться от себя он не смог бы ни в плюс, ни в минус.
  const facts: ShiftFact[] = []
  for (let i = 0; i < 10; i++) {
    facts.push(fact({ date: '2026-06-0' + ((i % 9) + 1), cashier_id: 'op1', receipts_2plus: 36, receipts: 40 }))
  }
  for (let i = 0; i < 10; i++) {
    facts.push(fact({ date: '2026-06-1' + i, cashier_id: 'op2', receipts_2plus: 12, receipts: 40 }))
  }

  const index = buildBaselineIndex(facts, (f) => f.receipts_2plus / f.receipts, {
    summerMonths: SETTINGS.summer_months,
  })
  const target = fact({ date: '2026-06-20', cashier_id: 'op1' })

  const withSelf = lookupBaseline(index, target, {
    minSample: 5,
    summerMonths: SETTINGS.summer_months,
    percentile: 0.5,
  })!
  const withoutSelf = lookupBaseline(index, target, {
    minSample: 5,
    summerMonths: SETTINGS.summer_months,
    percentile: 0.5,
    excludeCashierId: 'op1',
  })!

  assert.ok(withoutSelf.value < withSelf.value, 'исключение кассира ничего не изменило')
  assert.ok(Math.abs(withoutSelf.value - 0.3) < 1e-9, 'нормой должна остаться работа напарника')
})

test('выборка для распределения тоже исключает оцениваемого', () => {
  // Та же защита, но для вероятностной модели: она берёт не одно число, а всю
  // выборку, и если забыть исключение здесь, дыра вернётся с другой стороны.
  const facts: ShiftFact[] = []
  for (let i = 0; i < 8; i++) {
    facts.push(fact({ date: '2026-06-0' + (i + 1), cashier_id: 'op1', receipts: 90 }))
  }
  for (let i = 0; i < 8; i++) {
    facts.push(fact({ date: '2026-06-1' + i, cashier_id: 'op2', receipts: 30 }))
  }

  const index = buildBaselineIndex(facts, (f) => f.receipts, { summerMonths: SETTINGS.summer_months })
  const target = fact({ date: '2026-06-20', cashier_id: 'op1' })

  const all = lookupBaselineSamples(index, target, { minSample: 5, summerMonths: SETTINGS.summer_months })!
  const others = lookupBaselineSamples(index, target, {
    minSample: 5,
    summerMonths: SETTINGS.summer_months,
    excludeCashierId: 'op1',
  })!

  assert.equal(all.values.length, 16)
  assert.equal(others.values.length, 8)
  assert.ok(others.values.every((v) => v === 30), 'в выборке остались смены самого оцениваемого')
})

test('спрос не зависит от того, кто стоял на смене', () => {
  // Обратное правило: поток покупателей исключать по кассиру НЕ нужно и
  // нельзя. Сколько людей зашло — обстоятельство, а не заслуга продавца, и
  // урезать эту выборку значило бы выкинуть половину знания о спросе.
  const facts: ShiftFact[] = []
  for (let i = 0; i < 16; i++) {
    const day = String(i + 1).padStart(2, '0')
    facts.push(fact({ date: '2026-06-' + day, cashier_id: i % 2 === 0 ? 'op1' : 'op2', receipts: 40 + (i % 5) }))
  }

  const index = buildBaselineIndex(facts, (f) => f.receipts, { summerMonths: SETTINGS.summer_months })
  const opts = { minSample: 5, summerMonths: SETTINGS.summer_months }

  const forOp1 = lookupBaselineSamples(index, fact({ date: '2026-06-20', cashier_id: 'op1' }), opts)!
  const forOp2 = lookupBaselineSamples(index, fact({ date: '2026-06-20', cashier_id: 'op2' }), opts)!

  assert.deepEqual(forOp1.values, forOp2.values)
  assert.equal(
    forecastDemand(forOp1.values)!.expectedReceipts,
    forecastDemand(forOp2.values)!.expectedReceipts,
  )
})

test('возвраты и нулевые чеки не ломают распределение сумм', () => {
  // В боевых данных попадаются нулевые и отрицательные суммы. Они не должны
  // ни падать в бутстрап, ни ронять расчёт.
  const demand = forecastDemand(HISTORY)!
  const dirty = [
    1200, 0, -500, 980, NaN, 1500, 1100, 0, 1350, 1420, 1180, 990, 1250, 1310, 1050, 1190, 1240,
    1330, 1090, 1160, 1280, 1370, 1010, 1230, 1300, 1140, 1220, 1260, 1080, 1290, 1170,
  ]

  const result = simulateShift({
    demand,
    ticketSamples: dirty,
    fallbackAvgTicket: 1200,
    thresholds: { control: 30_000, b1: 45_000, b2: 60_000, b3: 80_000, record: 120_000 },
    iterations: 800,
    seed: 3,
  })!

  assert.ok(Number.isFinite(result.medianRevenue))
  assert.ok(result.medianRevenue > 0)
  assert.ok(result.revenueP10 <= result.revenueP90)
})

test('подорожание не превращается в рост выручки', () => {
  // Самая коварная ошибка в денежных сравнениях: цены выросли на 20%, касса
  // выросла на 20%, а работали ровно так же. Если базу не дефлировать,
  // прогноз будет вечно занижать, а каждая смена — выглядеть выдающейся.
  //
  // Проверяем прямо: два одинаковых по сути года, в одном цены стоят, в
  // другом растут. Систематический сдвиг обязан остаться примерно одинаковым.
  function series(withInflation: boolean): ShiftFact[] {
    const out: ShiftFact[] = []
    for (let i = 0; i < 120; i++) {
      const date = new Date('2026-03-01T00:00:00Z')
      date.setUTCDate(date.getUTCDate() + Math.floor(i / 2))
      const iso = date.toISOString().slice(0, 10)
      const receipts = 40 + (i % 7)
      // Реальный средний чек один и тот же; в инфляционном ряду он и касса
      // растут вместе с индексом цен, то есть в реальном выражении не меняются.
      const priceIndex = withInflation ? 1 + (i / 120) * 0.2 : 1
      const realTicket = 1200
      out.push(
        fact({
          date: iso,
          shift: i % 2 === 0 ? 'day' : 'night',
          cashier_id: i % 3 === 0 ? 'op1' : 'op2',
          receipts,
          revenue: Math.round(receipts * realTicket * priceIndex),
          gross_revenue: Math.round(receipts * realTicket * priceIndex),
          price_index: priceIndex,
        }),
      )
    }
    return out
  }

  const opts = { minSample: 8, summerMonths: SETTINGS.summer_months, iterations: 300 }
  const flat = compareRevenue(walkForward(series(false), opts).revenuePoints)
  const rising = compareRevenue(walkForward(series(true), opts).revenuePoints)

  assert.ok(flat.v1.bias !== null && rising.v1.bias !== null, 'нечего сравнивать')

  // Без дефляции сдвиг при росте цен уехал бы на десятки тысяч тенге.
  // С дефляцией разница между рядами обязана остаться небольшой.
  const drift = Math.abs(rising.v1.bias! - flat.v1.bias!)
  assert.ok(drift < 3000, `подорожание сдвинуло прогноз на ${Math.round(drift)} ₸ — индекс цен не работает`)
})
