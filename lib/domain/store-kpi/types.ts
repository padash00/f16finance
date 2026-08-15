/**
 * Эффективность продавца магазина — типы предметной области.
 *
 * Отдельная система от `/performance` (там PI оператора клуба по выручке
 * смены). Здесь оценивается продавец магазина: как он распорядился тем
 * потоком, который до него дошёл.
 *
 * Главное правило модуля: низкая касса сама по себе НЕ доказывает, что
 * продавец плохой, а высокая — что хороший. Поэтому выручка смены и качество
 * работы продавца считаются раздельно и сравниваются с ожиданием для
 * сопоставимых условий, а не с одной глобальной цифрой.
 */

export type ShiftType = 'day' | 'night'

/**
 * Сезон. Учебный и летний разделены намеренно: летом студенты разъезжаются,
 * структура потока другая, и смешивать июль с ноябрём в одну базу нельзя.
 */
export type Season = 'academic' | 'summer'

/**
 * Факт одной смены магазина — то, что реально произошло.
 *
 * Собирается из `point_sales` / `point_sale_items` / `point_returns`, а
 * `club_revenue` — из `incomes` точки-клуба (см. ниже). Доменный слой БД не
 * знает: сюда приходят уже готовые числа.
 */
export type ShiftFact = {
  company_id: string
  /** Локальная дата смены, YYYY-MM-DD. */
  date: string
  shift: ShiftType
  /** Кассир (operators.id). null — чек без кассира, в оценку людей не идёт. */
  cashier_id: string | null

  /** Продажи минус возвраты, ₸. Это и есть «касса смены». */
  revenue: number
  /** Продажи до вычета возвратов, ₸. */
  gross_revenue: number
  /** Возвраты, ₸. */
  refunds: number

  /** Валидных чеков (без возвратных и технических). */
  receipts: number
  /** Штук товара суммарно (sum(quantity)). 0 = позиций нет в принципе. */
  items: number
  /** Строк в чеках. Отличается от items, если берут по несколько штук. */
  lines: number
  /** Чеков с двумя и более строками — прямой признак допродаж. */
  receipts_2plus: number

  /** Сколько раз возникала возможность допродажи по правилам cross-sell. */
  attach_opportunities: number
  /** Сколько из них закрыто. */
  attach_success: number

  /**
   * Прокси потока: выручка клуба за ту же смену, ₸.
   *
   * Клуб работает на SENET и числа посетителей нам не отдаёт, поэтому «поток»
   * измеряется деньгами клуба. Это честнее, чем выдумывать посетителей, но
   * слабее прямого счётчика — отсюда пониженная уверенность в метриках,
   * которые на него опираются. null = выручки клуба за эту смену нет.
   */
  club_revenue: number | null
}

/** Уровень, на котором нашлось ожидание. Чем ниже в списке — тем грубее. */
export type SegmentLevel =
  | 'season_month_weekday_shift'
  | 'season_weekday_shift'
  | 'season_weekday_group_shift'
  | 'season_shift'
  | 'all'

/** Правило допродажи: «взяли рамен — предложи напиток». */
export type CrossSellRule = {
  id: string
  source_category_id: string
  target_category_id: string
  /** Вес правила в attach rate. По умолчанию 1. */
  weight: number
  active: boolean
}

/** Разбор одной метрики: факт против ожидания для сопоставимых условий. */
export type MetricRatio = {
  metric: MetricKey
  /** Фактическое значение метрики. null — посчитать не из чего. */
  actual: number | null
  /** Ожидание для сопоставимых условий. null — истории не хватило. */
  expected: number | null
  /** actual / expected до ограничения. null, если одного из них нет. */
  raw_ratio: number | null
  /** То же после клипа — чтобы одна аномалия не съела весь балл. */
  ratio: number | null
  /** На каком уровне сегментации нашлось ожидание. */
  level: SegmentLevel | null
  /** Сколько смен было в сегменте. */
  sample: number
}

export type MetricKey =
  | 'revenue_per_club'
  | 'receipts_per_club'
  | 'avg_ticket'
  | 'items_per_receipt'
  | 'attach_rate'
  | 'product_knowledge'

/** Вывод по смене: поток или продавец. */
export type ShiftVerdict =
  /** Выручка просела из-за потока, продавец отработал нормально. */
  | 'TRAFFIC_DRIVEN'
  /** Поток был, но управляемые продавцом метрики слабые. */
  | 'POSSIBLE_CASHIER_ISSUE'
  /** Поток был, и продавец его использовал лучше обычного. */
  | 'CASHIER_DRIVEN'
  /** Всё около нормы. */
  | 'NORMAL'
  /** Данных не хватает для любого из выводов выше. */
  | 'INSUFFICIENT_DATA'

/** Статус продавца по накопленным сменам. */
export type CashierStatus = 'INSUFFICIENT_DATA' | 'NEEDS_TRAINING' | 'NORMAL' | 'STRONG' | 'TOP'

export type ShiftAnalysis = {
  fact: ShiftFact
  season: Season
  metrics: MetricRatio[]
  /** Взвешенный балл. null — нечего было взвешивать. */
  score: number | null
  /** 0..1. Насколько выводу вообще можно верить. */
  confidence: number
  verdict: ShiftVerdict
  /** Человеческие формулировки: почему такой вывод. */
  evidence: string[]
  /** Чего не хватило в данных — вход для AI и для честности перед продавцом. */
  missing: string[]
  /** Ожидаемая выручка смены (для «план vs факт»). */
  expected_revenue: number | null
  /** Ожидаемая выручка клуба — «был ли поток». */
  expected_club_revenue: number | null
}

export type CashierSummary = {
  cashier_id: string
  shifts: number
  revenue: number
  receipts: number
  /** Средний балл по сменам. null — считать не из чего. */
  score: number | null
  status: CashierStatus
  confidence: number
  /** Средние соотношения по метрикам — где сильные и слабые места. */
  metric_ratios: Partial<Record<MetricKey, number>>
  strengths: MetricKey[]
  weaknesses: MetricKey[]
  verdicts: Record<ShiftVerdict, number>
}
