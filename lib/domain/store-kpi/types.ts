/**
 * Эффективность продавца магазина — типы предметной области.
 *
 * Отдельная система от `/performance` (там PI оператора клуба по выручке
 * смены). Здесь оценивается продавец магазина: как он распорядился теми
 * покупателями, которые до него дошли.
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
 * Собирается из `point_sales` / `point_sale_items` / `point_returns` функцией
 * `store_kpi_shift_facts`. Доменный слой БД не знает: сюда приходят уже
 * готовые числа.
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

  /** Чеков с тремя и более позициями. */
  receipts_3plus: number
  /** Сколько раз возникала возможность допродажи по правилам cross-sell. */
  attach_opportunities: number
  /** Сколько из них закрыто. */
  attach_success: number

  /**
   * Себестоимость проданного, ₸. Считается по закупочной цене товара; для
   * позиций с техкартой это приближение, но оно честнее, чем считать прибыль
   * равной выручке.
   */
  cogs: number
  /** Сумма скидок, ₸ — включая скидку лояльности. */
  discount_amount: number
  /** Чеков со скидкой. */
  discounted_receipts: number
  /** Уникальных товаров продано. */
  unique_skus: number

  /**
   * Смена помечена как аномальная (дубль, сбой кассы, тестовые данные).
   * Помеченная смена не формирует норму, но из отчёта не исчезает.
   */
  is_anomaly?: boolean
  exclude_from_baseline?: boolean
  anomaly_reason?: string | null

  /** Деловые события смены: отсутствие товара, акция, простой. */
  events?: ShiftEvent[]
}

/** Деловое событие, влиявшее на смену. */
export type ShiftEvent = {
  event_type:
    | 'STOCKOUT'
    | 'PROMOTION'
    | 'PRICE_CHANGE'
    | 'NEW_PRODUCT'
    | 'TECHNICAL_DOWNTIME'
    | 'PARTIAL_CLOSURE'
    | 'FULL_CLOSURE'
    | 'CUSTOM'
  title: string
  severity: 'low' | 'medium' | 'high'
}

/** Уровень, на котором нашлось ожидание. Чем ниже в списке — тем грубее. */
export type SegmentLevel =
  | 'season_month_weekday_shift'
  | 'season_weekday_shift'
  | 'season_weekday_group_shift'
  | 'season_shift'
  | 'all'

/**
 * Правило допродажи: «взяли рамен — предложи напиток».
 *
 * Обе стороны могут быть как категорией, так и конкретным товаром: «любой
 * напиток» это категория, а «фирменный соус» — товар. Ассортимент задаёт
 * администратор, зашивать конкретные позиции в код нельзя.
 */
export type CrossSellRule = {
  id: string
  source_kind: 'category' | 'item'
  source_ref: string
  target_kind: 'category' | 'item'
  target_ref: string
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
  | 'avg_ticket'
  | 'items_per_receipt'
  | 'attach_rate'
  | 'revenue_efficiency'
  | 'plan_attainment'
  | 'product_knowledge'

/**
 * Вывод по смене: спрос или продавец.
 *
 * Спрос измеряется числом чеков — отдельного счётчика посетителей у магазина
 * нет, а чек оставляет каждый купивший. Число чеков продавец почти не
 * контролирует: он не приводит людей в помещение.
 */
export type ShiftVerdict =
  /** Чеков было мало, но с каждым пришедшим продавец отработал нормально. */
  | 'LOW_DEMAND'
  /** Люди приходили, а управляемые продавцом метрики просели. */
  | 'POSSIBLE_CASHIER_ISSUE'
  /** Чеков было много, и касса выросла в основном из-за этого. */
  | 'HIGH_DEMAND'
  /** Из того же числа покупателей выжали заметно больше обычного. */
  | 'STRONG_CASHIER'
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
  /** Ожидаемое число чеков — мера спроса, а не работы продавца. */
  expected_receipts: number | null
  /** Ожидаемый средний чек для сопоставимых условий. */
  expected_avg_ticket: number | null
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
