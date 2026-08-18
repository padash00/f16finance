/**
 * Диагностика вероятностной модели: почему ей стоит или не стоит верить.
 *
 * Модель, которая молча выдаёт числа, опаснее модели, которая честно говорит
 * «здесь я работаю вслепую». Человек всё равно будет принимать решения по
 * этим числам, и он обязан знать, на чём они стоят.
 *
 * Каждая проверка отвечает на один вопрос и написана так, чтобы её понял
 * владелец точки, а не статистик.
 */

import type { DemandForecast, MonteCarloForecast, RateEstimate } from './types'

export type ModelCheck = {
  key: string
  label: string
  /** 0..1 — насколько хорошо обстоит дело на этом участке. */
  value: number
  ok: boolean
  hint: string
}

export type ModelDiagnostics = {
  score: number
  checks: ModelCheck[]
  worst: ModelCheck | null
  /** Какими моделями считали и сколько раз. */
  models: { demand: Record<string, number>; ticket: Record<string, number> }
}

export type DiagnosticInput = {
  shifts: Array<{
    demand: DemandForecast | null
    attach: RateEstimate | null
    simulation: MonteCarloForecast | null
  }>
  /** Доля фактов, попавших в объявленный диапазон 80%. null — не мерили. */
  coverage80?: number | null
  /** Средняя ширина диапазона относительно ожидания. */
  relativeWidth?: number | null
}

export function probabilityDiagnostics(input: DiagnosticInput): ModelDiagnostics {
  const shifts = input.shifts
  const total = shifts.length
  const share = (n: number) => (total > 0 ? n / total : 0)

  const demandModels: Record<string, number> = {}
  const ticketModels: Record<string, number> = {}
  for (const shift of shifts) {
    if (shift.demand) demandModels[shift.demand.model] = (demandModels[shift.demand.model] || 0) + 1
    if (shift.simulation) {
      ticketModels[shift.simulation.ticketModel] = (ticketModels[shift.simulation.ticketModel] || 0) + 1
    }
  }

  const withDemand = shifts.filter((s) => s.demand).length
  const parametric = shifts.filter(
    (s) => s.demand && (s.demand.model === 'negative_binomial' || s.demand.model === 'poisson'),
  ).length
  const overdispersed = shifts.filter((s) => s.demand?.model === 'negative_binomial').length
  const receiptLevel = shifts.filter((s) => s.simulation?.ticketModel === 'bootstrap').length
  const withSimulation = shifts.filter((s) => s.simulation).length
  const thinAttach = shifts.filter((s) => s.attach && s.attach.opportunities < 15).length

  const checks: ModelCheck[] = [
    {
      key: 'forecast_coverage',
      label: 'Прогноз вообще посчитан',
      value: share(withDemand),
      ok: share(withDemand) >= 0.8,
      hint:
        withDemand === total
          ? 'На все смены периода хватило сопоставимой истории.'
          : 'На части смен истории не хватило: сопоставимых смен в сегменте меньше минимума. Это не поломка, а честный отказ считать по двум наблюдениям.',
    },
    {
      key: 'parametric_share',
      label: 'Хватает данных на полноценную модель',
      value: withDemand > 0 ? parametric / withDemand : 0,
      ok: withDemand > 0 && parametric / withDemand >= 0.5,
      hint:
        parametric === 0
          ? 'Везде работает прежняя модель на перцентилях: наблюдений в сегментах слишком мало, чтобы оценивать разброс. Это нормально в первые месяцы работы точки.'
          : 'Там, где наблюдений достаточно, поток описывается распределением, а не только перцентилями — интервалы получаются точнее.',
    },
    {
      key: 'receipt_level',
      label: 'Есть суммы отдельных чеков',
      value: withSimulation > 0 ? receiptLevel / withSimulation : 0,
      ok: withSimulation === 0 || receiptLevel / withSimulation >= 0.5,
      hint:
        receiptLevel === 0
          ? 'Прогноз выручки строится по среднему чеку смен, а не по отдельным чекам. Это грубее: разброс внутри смены не учитывается, и вероятности планов выходят увереннее, чем данные позволяют.'
          : 'Прогноз выручки разыгрывает настоящие суммы чеков — самый точный из доступных способов.',
    },
    {
      key: 'attach_sample',
      label: 'Хватает чеков для вывода о допродажах',
      value: 1 - share(thinAttach),
      ok: share(thinAttach) <= 0.3,
      hint:
        thinAttach > 0
          ? `В ${thinAttach} сменах было меньше пятнадцати чеков. На таком объёме отличить работу продавца от везения нельзя, и модель об этом прямо говорит вместо того, чтобы делать вид, что может.`
          : 'Во всех сменах чеков достаточно, чтобы вывод о допродажах что-то значил.',
    },
  ]

  if (input.coverage80 != null) {
    // Главная проверка честности: обещали 80% — обязаны накрывать около 80%.
    const miss = Math.abs(input.coverage80 - 0.8)
    checks.push({
      key: 'interval_coverage',
      label: 'Обещанный диапазон сбывается',
      value: Math.max(0, 1 - miss * 3),
      ok: miss <= 0.08,
      hint:
        input.coverage80 < 0.72
          ? `Диапазон «80%» накрывает факт лишь в ${Math.round(input.coverage80 * 100)}% смен — он слишком узкий, и модель выглядит увереннее, чем есть.`
          : input.coverage80 > 0.88
            ? `Диапазон накрывает ${Math.round(input.coverage80 * 100)}% смен — он шире необходимого и потому мало что говорит.`
            : 'Диапазон сбывается примерно так, как обещает.',
    })
  }

  if (input.relativeWidth != null) {
    checks.push({
      key: 'interval_width',
      label: 'Диапазон не бесполезно широкий',
      value: Math.max(0, 1 - Math.max(0, input.relativeWidth - 0.5)),
      ok: input.relativeWidth <= 1,
      hint:
        input.relativeWidth > 1
          ? 'Диапазон шире самого прогноза: он накроет почти любой исход и потому ничего не подсказывает. Так бывает, когда поток на точке действительно непредсказуем.'
          : 'Ширина диапазона соразмерна ожиданию — им можно пользоваться.',
    })
  }

  const score = checks.length > 0 ? checks.reduce((sum, c) => sum + c.value, 0) / checks.length : 0
  const worst = [...checks].sort((a, b) => a.value - b.value)[0] ?? null

  return {
    score: Math.round(score * 100) / 100,
    checks,
    worst,
    models: { demand: demandModels, ticket: ticketModels },
  }
}

/** Сколько сверхдисперсии в потоке — для вкладки качества, а не для экрана смен. */
export function dispersionSummary(shifts: Array<{ demand: DemandForecast | null }>): {
  median: number | null
  max: number | null
} {
  const values = shifts
    .map((s) => s.demand?.dispersion ?? null)
    .filter((v): v is number => v !== null && Number.isFinite(v))
  if (values.length === 0) return { median: null, max: null }
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
  return { median: Math.round(median * 100) / 100, max: Math.round(sorted[sorted.length - 1] * 100) / 100 }
}
