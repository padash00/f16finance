/**
 * Развёрнутое объяснение смены.
 *
 * Вывод «виноват поток» или «вопрос к продавцу» сам по себе бесполезен: с ним
 * нельзя ни согласиться, ни поспорить. Поэтому здесь собирается полный разбор —
 * что произошло с потоком, что с кассой, что именно сделал продавец, из чего
 * следует вывод и чего в данных не хватило.
 *
 * Объяснение детерминированное: оно строится из тех же чисел, что и балл, и
 * не требует языковой модели. ИИ потом добавляет связный текст поверх, но
 * если ИИ недоступен или отключён, объяснение всё равно есть и оно полное.
 *
 * Формулировки намеренно осторожные. Модуль видит корреляции, а не причины:
 * он знает, что средний чек был выше нормы, но не знает, почему — продавец
 * добирал крупные чеки или просто пришли другие люди. Поэтому «это то, на что
 * продавец влияет напрямую», а не «продавец молодец».
 */

import { METRIC_LABELS } from './metrics'
import type { StoreKpiSettings } from './settings'
import type { MetricKey, MetricRatio, ShiftAnalysis, ShiftVerdict } from './types'

export type MetricReading = {
  metric: MetricKey
  label: string
  actual: number | null
  expected: number | null
  delta_pct: number | null
  /** Как это читать человеку. */
  reading: string
  /** Насколько это надёжно: сколько смен было в сегменте сравнения. */
  sample: number
}

export type ShiftExplanation = {
  /** Одно предложение — главный вывод смены. */
  headline: string
  /** Что произошло: поток, касса, работа продавца. */
  paragraphs: string[]
  metrics: MetricReading[]
  /** Что из этого следует. */
  conclusion: string
  /** Что делать. Рекомендация управляющему, не решение за него. */
  action: string
  /** Где выводу нельзя доверять и почему. */
  caveats: string[]
}

const VERDICT_HEADLINE: Record<ShiftVerdict, string> = {
  LOW_DEMAND: 'Покупателей пришло мало — касса просела из-за спроса, а не из-за продавца.',
  POSSIBLE_CASHIER_ISSUE:
    'Покупатели были, но работа с ними просела — есть о чём поговорить с продавцом.',
  HIGH_DEMAND: 'Касса выросла в основном за счёт количества покупателей.',
  STRONG_CASHIER: 'Из того же числа покупателей выжали заметно больше обычного.',
  NORMAL: 'Смена прошла в пределах обычного разброса.',
  INSUFFICIENT_DATA: 'Данных не хватило, чтобы делать выводы об этой смене.',
}

const VERDICT_ACTION: Record<ShiftVerdict, string> = {
  LOW_DEMAND:
    'Претензий к продавцу нет. Если такие смены повторяются, вопрос не к нему, а к тому, почему приходит меньше людей: сезон, день недели, ассортимент, соседи.',
  POSSIBLE_CASHIER_ISSUE:
    'Стоит разобрать смену с продавцом: посмотреть, что мешало предлагать сопутствующее и добирать чек. Это повод для обучения, а не для наказания.',
  HIGH_DEMAND:
    'Записывать смену продавцу в заслугу автоматически не стоит: выручку сделал поток покупателей. Посмотрите, можно ли было выжать из него больше.',
  STRONG_CASHIER: 'Есть что отметить и есть чему поучиться остальным — разберите, что сработало.',
  NORMAL: 'Отдельных действий не требуется.',
  INSUFFICIENT_DATA:
    'Сначала стоит закрыть дыры в данных — иначе любые выводы по этой смене будут гаданием.',
}

function pct(ratio: number | null): string {
  if (ratio == null) return '—'
  const delta = Math.round((ratio - 1) * 100)
  if (delta === 0) return 'на уровне нормы'
  return delta > 0 ? `выше нормы на ${delta}%` : `ниже нормы на ${Math.abs(delta)}%`
}

function money(value: number | null): string {
  if (value == null) return '—'
  return `${Math.round(value).toLocaleString('ru-RU')} ₸`
}

/** Как читать конкретную метрику: что она означает и на что указывает. */
function readMetric(m: MetricRatio): string {
  if (m.actual == null) return 'Посчитать не из чего.'
  if (m.expected == null) return 'Не с чем сравнить: в сегменте не набралось истории.'

  const direction = m.raw_ratio == null ? 'на уровне нормы' : pct(m.raw_ratio)

  switch (m.metric) {
    case 'avg_ticket':
      return `Средний чек ${direction}. Это то, на что продавец влияет напрямую: что предложил и до чего добрал.`
    case 'items_per_receipt':
      return `Товаров на чек ${direction}. Прямой признак того, предлагалось ли что-то сверх заказанного.`
    case 'attach_rate':
      return `Допродажи ${direction}. Считается по вашим правилам «взяли одно — предложи другое».`
    case 'revenue_efficiency':
      return `Отдача с покупателя ${direction}. По формуле это выручка, делённая на число чеков и ожидаемый средний чек, — то есть ровно то же измерение, что и строка «средний чек» выше. Обе метрики оставлены в баллах намеренно, чтобы средний чек весил больше остальных.`
    case 'plan_attainment':
      return `Касса смены ${direction} к норме для таких условий. Зависит и от продавца, и от числа покупателей, поэтому вес у неё самый маленький.`
    case 'product_knowledge':
      return 'Тест на знание товара за смену не учитывался.'
  }
}

export function explainShift(analysis: ShiftAnalysis, settings: StoreKpiSettings): ShiftExplanation {
  const { fact } = analysis
  const revenueRatio =
    analysis.expected_revenue && analysis.expected_revenue > 0 ? fact.revenue / analysis.expected_revenue : null
  const demandRatio =
    analysis.expected_receipts && analysis.expected_receipts > 0
      ? fact.receipts / analysis.expected_receipts
      : null

  const paragraphs: string[] = []

  // 1. Спрос.
  if (demandRatio != null) {
    paragraphs.push(
      `Спрос. Покупателей за смену — ${fact.receipts} чеков при обычных ${analysis.expected_receipts} для таких условий, то есть ${pct(demandRatio)}. Отдельного счётчика посетителей у магазина нет, но чек оставляет каждый купивший, а привести людей в помещение продавец не может — поэтому число чеков мы считаем мерой спроса, а не качества работы.`,
    )
  } else {
    paragraphs.push(
      `Спрос. За смену пробито ${fact.receipts} чеков, но сравнить не с чем: сопоставимых смен в истории меньше ${settings.min_sample_size}. Значит, отличить «пришло мало людей» от «людей было достаточно» по этой смене нельзя, и вывод опирается только на то, что происходило внутри чеков.`,
    )
  }

  // 2. Касса.
  if (revenueRatio != null) {
    paragraphs.push(
      `Касса. Магазин сделал ${money(fact.revenue)} при ожидаемых ${money(
        analysis.expected_revenue,
      )} для такой смены — ${pct(revenueRatio)}. Ожидание берётся по сопоставимым сменам: тот же сезон, тот же день недели, та же дневная или ночная смена.`,
    )
  } else {
    paragraphs.push(
      `Касса. Магазин сделал ${money(fact.revenue)}, но сравнить не с чем: сопоставимых смен в истории меньше ${settings.min_sample_size}.`,
    )
  }

  // 3. Работа продавца.
  const usable = analysis.metrics.filter((m) => m.ratio != null)
  if (usable.length > 0) {
    const strong = usable.filter((m) => (m.raw_ratio ?? 1) >= 1.05)
    const weak = usable.filter((m) => (m.raw_ratio ?? 1) <= 0.95)
    const parts: string[] = [
      `Работа продавца. Считается по ${usable.length} из ${analysis.metrics.length} метрик — остальные посчитать не из чего.`,
    ]
    if (strong.length) {
      parts.push(`Выше нормы: ${strong.map((m) => METRIC_LABELS[m.metric].toLowerCase()).join(', ')}.`)
    }
    if (weak.length) {
      parts.push(`Ниже нормы: ${weak.map((m) => METRIC_LABELS[m.metric].toLowerCase()).join(', ')}.`)
    }
    if (!strong.length && !weak.length) {
      parts.push('Все метрики держатся около нормы.')
    }
    parts.push(
      `Итоговый балл ${analysis.score?.toFixed(2) ?? '—'}: это отношение к норме, а не доля от плана. 1.00 означает «как обычно в таких условиях».`,
    )
    paragraphs.push(parts.join(' '))
  } else {
    paragraphs.push(
      'Работа продавца. Ни одну метрику посчитать не удалось, поэтому балл не выставляется. Это не «плохо отработал», это «не из чего считать».',
    )
  }

  // 4. Чеки и объём.
  paragraphs.push(
    `Объём. За смену пробито ${fact.receipts} чеков${
      fact.items > 0 ? ` и ${Math.round(fact.items)} товаров` : ' (позиции в чеках не расписаны)'
    }${fact.refunds > 0 ? `, возвраты — ${money(fact.refunds)}` : ''}. Порог, ниже которого выводы делаются осторожнее, — ${settings.min_receipts_for_full_score} чеков за смену.`,
  )

  const metrics: MetricReading[] = analysis.metrics.map((m) => ({
    metric: m.metric,
    label: METRIC_LABELS[m.metric],
    actual: m.actual,
    expected: m.expected,
    delta_pct: m.raw_ratio == null ? null : Math.round((m.raw_ratio - 1) * 100),
    reading: readMetric(m),
    sample: m.sample,
  }))

  // 4.5. Длительность смены.
  if (fact.duration_minutes != null && fact.duration_minutes > 0) {
    const hours = Math.round((fact.duration_minutes / 60) * 10) / 10
    paragraphs.push(
      `Длительность. Смена шла ${hours} ч.${
        fact.duration_minutes < 300
          ? ' Это заметно короче обычной смены, поэтому и покупателей закономерно меньше — сравнивать число чеков с полной сменой напрямую нельзя.'
          : ''
      }`,
    )
  }

  // 5. Что мешало работать.
  const events = fact.events || []
  if (events.length > 0) {
    paragraphs.push(
      `Обстоятельства. В смене отмечено: ${events
        .map((e) => e.title)
        .join('; ')}. Это не вина продавца, поэтому балл от этого не меняется — но доверия к выводу меньше.`,
    )
  }

  const caveats = [...analysis.missing]
  for (const e of events) {
    caveats.push(`Смена шла в особых условиях: ${e.title}.`)
  }
  if (fact.is_anomaly) {
    caveats.push(
      `Смена помечена как аномальная${fact.anomaly_reason ? ` (${fact.anomaly_reason})` : ''} — выводы по ней делать не стоит.`,
    )
  }
  if (analysis.confidence < 0.5) {
    caveats.push(
      `Общая уверенность в разборе — ${Math.round(analysis.confidence * 100)}%. На таком уровне вывод стоит считать поводом присмотреться, а не основанием для решений.`,
    )
  }
  if (fact.duration_minutes != null && fact.duration_minutes > 0 && fact.duration_minutes < 300) {
    caveats.push(
      'Смена была короткой — низкое число чеков объясняется этим, а не спросом или работой продавца.',
    )
  }
  if (fact.receipts < settings.min_receipts_for_full_score) {
    caveats.push(
      `Чеков в смене меньше ${settings.min_receipts_for_full_score} — на маленькой выборке метрики скачут сами по себе. Это снижает уверенность, но не балл продавца.`,
    )
  }

  const conclusion =
    analysis.verdict === 'INSUFFICIENT_DATA'
      ? 'Вывод по смене не делается: слишком многого не хватает в данных.'
      : demandRatio == null
        ? `${VERDICT_HEADLINE[analysis.verdict]} Оговорка: сравнить спрос было не с чем, поэтому вывод построен только на метриках внутри чеков.`
        : VERDICT_HEADLINE[analysis.verdict]

  return {
    headline: VERDICT_HEADLINE[analysis.verdict],
    paragraphs,
    metrics,
    conclusion,
    action: VERDICT_ACTION[analysis.verdict],
    caveats,
  }
}
