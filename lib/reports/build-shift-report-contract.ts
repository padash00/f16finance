/**
 * Контракт PDF-разбора смен.
 *
 * Собирает то, что уже посчитано и показано на экране, в структуру для
 * шаблона. Здесь нет ни одного нового вычисления: PDF обязан говорить ровно
 * то же, что страница. Отчёт, расходящийся с экраном, хуже отсутствия отчёта —
 * ему нельзя верить ни там, ни там.
 *
 * Перевод на человеческий язык происходит тоже здесь: в PDF не должно
 * остаться ни «1.13», ни «confidence 0.62».
 */

const METRIC_LABELS: Record<string, string> = {
  avg_ticket: 'Средний чек',
  items_per_receipt: 'Товаров на чек',
  attach_rate: 'Допродажи',
  revenue_efficiency: 'Отдача с покупателя',
  plan_attainment: 'Выполнение плана',
  product_knowledge: 'Знание товара',
}

const VERDICT_LABELS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'mut' }> = {
  LOW_DEMAND: { label: 'Мало покупателей', tone: 'mut' },
  POSSIBLE_CASHIER_ISSUE: { label: 'Вопрос к продавцу', tone: 'warn' },
  HIGH_DEMAND: { label: 'Вытянул поток', tone: 'mut' },
  STRONG_CASHIER: { label: 'Сильная смена', tone: 'good' },
  NORMAL: { label: 'Норма', tone: 'mut' },
  INSUFFICIENT_DATA: { label: 'Мало данных', tone: 'mut' },
}

const STATUS_LABELS: Record<string, { label: string; hint: string }> = {
  TOP: { label: 'Топ', hint: 'заметно выше нормы по нескольким метрикам' },
  STRONG: { label: 'Сильный', hint: 'стабильно выше нормы' },
  NORMAL: { label: 'Норма', hint: 'работает как обычно для этой точки' },
  NEEDS_TRAINING: { label: 'Нужна помощь', hint: 'несколько смен подряд ниже нормы' },
  INSUFFICIENT_DATA: { label: 'Рано судить', hint: 'смен пока мало' },
}

export type ContractShift = {
  date: string
  shift: string
  cashier_name: string | null
  duration_minutes?: number | null
  items?: number
  /** Метрики смены как есть — для колонок таблицы и своих сводных. */
  metrics?: { metric: string; actual: number | null; expected: number | null; ratio: number | null }[]
  revenue: number
  expected_revenue: number | null
  receipts: number
  expected_receipts: number | null
  score: number | null
  confidence: number
  verdict: string
  explanation: {
    headline: string
    paragraphs: string[]
    metrics: {
      metric: string
      label: string
      actual: number | null
      expected: number | null
      delta_pct: number | null
      reading: string
      sample: number
    }[]
    conclusion: string
    action: string
    caveats: string[]
  } | null
  context: {
    weather: {
      summary: string
      label: string
      windowed: boolean
      window_label: string
      temperature_max?: number | null
      temperature_min?: number | null
      precipitation_mm?: number | null
    } | null
    days: { name: string; type_label: string }[]
    periods: { name: string; type_label: string; audience_label: string | null; confirmed: boolean }[]
  } | null
}

export type ContractCashier = {
  cashier_id: string
  name: string
  shifts: number
  revenue: number
  receipts: number
  score: number | null
  status: string
  confidence: number
  metric_ratios: Record<string, number | undefined>
  strengths: string[]
  weaknesses: string[]
  verdicts: Record<string, number>
}

/** Балл словами — так же, как на экране. */
export function scoreText(score: number | null | undefined): string {
  if (score == null) return 'нет оценки'
  const delta = Math.round((score - 1) * 100)
  if (Math.abs(delta) < 3) return 'как обычно'
  return delta > 0 ? `лучше на ${delta}%` : `слабее на ${Math.abs(delta)}%`
}

/** Доверие словами. Проценты в отчёте не помогают принять решение. */
export function confidenceText(value: number | null | undefined): string {
  const pct = Math.round((value ?? 0) * 100)
  if (pct >= 75) return 'можно доверять'
  if (pct >= 45) return 'есть сомнения'
  return 'рано судить'
}

function deltaText(delta: number | null | undefined): string {
  if (delta == null) return 'нет нормы'
  if (Math.abs(delta) < 1) return 'как обычно'
  return `${delta > 0 ? '+' : ''}${delta}%`
}

function deltaTone(delta: number | null | undefined): 'good' | 'warn' | 'mut' {
  if (delta == null) return 'mut'
  if (delta >= 5) return 'good'
  if (delta <= -5) return 'warn'
  return 'mut'
}

function formatMetricValue(metric: string, value: number | null): string {
  if (value == null) return '—'
  if (metric === 'attach_rate') return `${Math.round(value * 100)}%`
  if (metric === 'avg_ticket' || metric === 'revenue_efficiency' || metric === 'plan_attainment') {
    return `${Math.round(value).toLocaleString('ru-RU')} ₸`
  }
  return value.toFixed(2)
}

export type ShiftReportInput = {
  companyName: string
  period: { from: string; to: string }
  periodLabel: string
  generated: string
  shifts: ContractShift[]
  cashiers: ContractCashier[]
  warnings: string[]
  minSampleSize: number
}

const WEEKDAY_NAMES = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота']

function weekdayOf(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y || 1970, (m || 1) - 1, d || 1).getDay()
}

/** Номер недели внутри периода: «неделя 1», «неделя 2». */
function weekIndex(iso: string, from: string): number {
  const a = new Date(`${from}T00:00:00Z`).getTime()
  const b = new Date(`${iso}T00:00:00Z`).getTime()
  return Math.floor((b - a) / 86_400_000 / 7) + 1
}

type Bucket = {
  key: string
  label: string
  shifts: number
  revenue: number
  expected: number | null
  receipts: number
  expectedReceipts: number | null
}

function emptyBucket(key: string, label: string): Bucket {
  return { key, label, shifts: 0, revenue: 0, expected: null, receipts: 0, expectedReceipts: null }
}

function addToBucket(bucket: Bucket, s: ContractShift) {
  bucket.shifts += 1
  bucket.revenue += s.revenue
  bucket.receipts += s.receipts
  if (s.expected_revenue != null) bucket.expected = (bucket.expected ?? 0) + s.expected_revenue
  if (s.expected_receipts != null) {
    bucket.expectedReceipts = (bucket.expectedReceipts ?? 0) + s.expected_receipts
  }
}

/**
 * Срезы периода.
 *
 * Отдельными сводками, а не одной таблицей: вопросы разные. «Какая неделя
 * провалилась» и «какой день недели слабый» — это не одно и то же, и смешивать
 * их в один список значит не ответить ни на один.
 */
function buildSlices(shifts: ContractShift[], from: string) {
  const weeks = new Map<number, Bucket>()
  const weekdays = new Map<number, Bucket>()
  const parts = new Map<string, Bucket>()

  for (const s of shifts) {
    const w = weekIndex(s.date, from)
    if (!weeks.has(w)) weeks.set(w, emptyBucket(String(w), `Неделя ${w}`))
    addToBucket(weeks.get(w)!, s)

    const d = weekdayOf(s.date)
    if (!weekdays.has(d)) weekdays.set(d, emptyBucket(String(d), WEEKDAY_NAMES[d]))
    addToBucket(weekdays.get(d)!, s)

    const p = s.shift === 'night' ? 'night' : 'day'
    if (!parts.has(p)) parts.set(p, emptyBucket(p, p === 'night' ? 'Ночные смены' : 'Дневные смены'))
    addToBucket(parts.get(p)!, s)
  }

  // Дни недели — в человеческом порядке, с понедельника.
  const weekdayOrder = [1, 2, 3, 4, 5, 6, 0]

  return {
    weeks: [...weeks.values()].sort((a, b) => Number(a.key) - Number(b.key)),
    weekdays: weekdayOrder.map((d) => weekdays.get(d)).filter(Boolean) as Bucket[],
    parts: [...parts.values()].sort((a) => (a.key === 'day' ? -1 : 1)),
  }
}

export function buildShiftReportContract(input: ShiftReportInput) {
  const totalRevenue = input.shifts.reduce((sum, s) => sum + s.revenue, 0)
  const totalReceipts = input.shifts.reduce((sum, s) => sum + s.receipts, 0)
  const questioned = input.shifts.filter((s) => s.verdict === 'POSSIBLE_CASHIER_ISSUE').length
  const strong = input.shifts.filter((s) => s.verdict === 'STRONG_CASHIER').length
  const lowDemand = input.shifts.filter((s) => s.verdict === 'LOW_DEMAND').length
  const highDemand = input.shifts.filter((s) => s.verdict === 'HIGH_DEMAND').length
  const normal = input.shifts.filter((s) => s.verdict === 'NORMAL').length
  const insufficient = input.shifts.filter((s) => s.verdict === 'INSUFFICIENT_DATA').length

  const slices = buildSlices(input.shifts, input.period.from)
  const avgTicket = totalReceipts > 0 ? Math.round(totalRevenue / totalReceipts) : null

  // Лучшая и худшая смены — по работе с покупателем, а не по кассе: касса
  // зависит от потока, и «лучшей» оказалась бы просто самая людная пятница.
  const scored = input.shifts.filter((s) => s.score != null)
  const best = [...scored].sort((a, b) => (b.score as number) - (a.score as number))[0] || null
  const worst = [...scored].sort((a, b) => (a.score as number) - (b.score as number))[0] || null

  const metricValue = (s: ContractShift, metric: string): number | null =>
    s.metrics?.find((m) => m.metric === metric)?.actual ?? null

  return {
    meta: {
      title: 'Разбор смен и продавцов',
      subtitle: input.companyName,
      period: input.periodLabel,
      generated: input.generated,
      brandNote: 'эффективность продавцов магазина',
    },

    summary: {
      kpis: [
        { label: 'Смен разобрано', value: String(input.shifts.length), sub: input.periodLabel },
        {
          label: 'Выручка',
          value: `${Math.round(totalRevenue).toLocaleString('ru-RU')} ₸`,
          sub: `${totalReceipts.toLocaleString('ru-RU')} чеков`,
        },
        { label: 'Продавцов', value: String(input.cashiers.length), sub: 'с указанным именем' },
        {
          label: 'Вопрос к продавцу',
          value: String(questioned),
          sub: 'смен, где покупатели были, а отдача ниже',
        },
        { label: 'Сильных смен', value: String(strong), sub: 'выше нормы по нескольким метрикам' },
        { label: 'Мало покупателей', value: String(lowDemand), sub: 'слабый поток, не вина продавца' },
      ],
      notes: input.warnings,

      // ── Срезы периода ───────────────────────────────────────────────────
      totals: {
        shifts: input.shifts.length,
        revenue: Math.round(totalRevenue),
        receipts: totalReceipts,
        avg_ticket: avgTicket,
        verdicts: [
          { label: 'Сильная смена', count: strong, hint: 'выше нормы по нескольким метрикам' },
          { label: 'Вытянул поток', count: highDemand, hint: 'покупателей пришло больше обычного' },
          { label: 'Норма', count: normal, hint: 'работал как обычно для этой точки' },
          { label: 'Мало покупателей', count: lowDemand, hint: 'слабый поток, не вина продавца' },
          { label: 'Вопрос к продавцу', count: questioned, hint: 'покупатели были, отдача ниже' },
          { label: 'Мало данных', count: insufficient, hint: 'сравнивать было не с чем' },
        ],
      },

      weeks: slices.weeks,
      weekdays: slices.weekdays,
      parts: slices.parts,

      highlights: {
        best: best
          ? {
              date: best.date,
              shift: best.shift === 'night' ? 'ночь' : 'день',
              cashier: best.cashier_name,
              score_text: scoreText(best.score),
              revenue: best.revenue,
              receipts: best.receipts,
            }
          : null,
        worst: worst
          ? {
              date: worst.date,
              shift: worst.shift === 'night' ? 'ночь' : 'день',
              cashier: worst.cashier_name,
              score_text: scoreText(worst.score),
              revenue: worst.revenue,
              receipts: worst.receipts,
            }
          : null,
      },

      method:
        'Каждая смена сравнивается не со средним по году, а с похожими сменами: тот же сезон, тот же день недели, дневная или ночная. Спрос меряется числом чеков — счётчика посетителей у магазина нет, но чек оставляет каждый купивший, а привести людей в помещение продавец не может. Норма считается по истории до начала периода и без собственных смен продавца, иначе человек сравнивался бы сам с собой. Если похожих смен меньше ' +
        `${input.minSampleSize}, вывод не делается вовсе.`,
    },

    cashiers: input.cashiers.map((c) => {
      const status = STATUS_LABELS[c.status] || { label: c.status, hint: '' }
      return {
        name: c.name,
        status: status.label,
        status_hint: status.hint,
        score_text: scoreText(c.score),
        confidence_text: confidenceText(c.confidence),
        shifts: c.shifts,
        revenue: c.revenue,
        receipts: c.receipts,
        strengths: c.strengths.map((m) => (METRIC_LABELS[m] || m).toLowerCase()),
        weaknesses: c.weaknesses.map((m) => (METRIC_LABELS[m] || m).toLowerCase()),
        verdicts: Object.entries(c.verdicts || {}).map(([key, count]) => ({
          label: VERDICT_LABELS[key]?.label || key,
          count,
        })),
        metrics: Object.entries(c.metric_ratios || {})
          .filter(([, ratio]) => ratio != null)
          .map(([metric, ratio]) => {
            const delta = Math.round(((ratio as number) - 1) * 100)
            return {
              label: METRIC_LABELS[metric] || metric,
              // У продавца это среднее отношение к норме, а не абсолютная
              // величина: складывать средние чеки разных смен нельзя.
              value: delta === 0 ? 'как обычно' : `${delta > 0 ? '+' : ''}${delta}% к норме`,
              delta_text: deltaText(delta),
              tone: deltaTone(delta),
            }
          }),
      }
    }),

    shifts: input.shifts.map((s) => {
      const verdict = VERDICT_LABELS[s.verdict] || { label: s.verdict, tone: 'mut' as const }
      const ctx = s.context

      return {
        date: s.date,
        weekday: WEEKDAY_NAMES[weekdayOf(s.date)],
        shift: s.shift === 'night' ? 'ночь' : 'день',
        cashier: s.cashier_name,
        duration_hours:
          s.duration_minutes == null ? null : Math.round((s.duration_minutes / 60) * 10) / 10,
        items: s.items ?? null,
        // Числовые метрики отдельно от текста: по ним строят свои сводные.
        avg_ticket: metricValue(s, 'avg_ticket'),
        items_per_receipt: metricValue(s, 'items_per_receipt'),
        attach_rate: metricValue(s, 'attach_rate'),
        weather_label: ctx?.weather?.label ?? null,
        temperature_max: ctx?.weather?.temperature_max ?? null,
        temperature_min: ctx?.weather?.temperature_min ?? null,
        precipitation_mm: ctx?.weather?.precipitation_mm ?? null,
        weather_window: ctx?.weather?.windowed ? ctx.weather.window_label : null,
        holidays_text: (ctx?.days || []).map((d) => d.name).join('; ') || null,
        periods_text: (ctx?.periods || []).map((p) => p.name).join('; ') || null,
        verdict: verdict.label,
        verdict_tone: verdict.tone,
        score_text: scoreText(s.score),
        confidence_text: confidenceText(s.confidence),
        revenue: s.revenue,
        expected_revenue: s.expected_revenue,
        receipts: s.receipts,
        expected_receipts: s.expected_receipts,
        headline: s.explanation?.headline || '',
        paragraphs: s.explanation?.paragraphs || [],
        metrics: (s.explanation?.metrics || []).map((m) => ({
          label: m.label,
          actual: formatMetricValue(m.metric, m.actual),
          expected: formatMetricValue(m.metric, m.expected),
          delta_text: deltaText(m.delta_pct),
          tone: deltaTone(m.delta_pct),
          reading: m.reading,
        })),
        context: {
          weather: ctx?.weather
            ? `${ctx.weather.label}. ${ctx.weather.summary}${
                ctx.weather.windowed ? ` Окно смены ${ctx.weather.window_label}.` : ''
              }`
            : null,
          days: (ctx?.days || []).map((d) => `${d.name} (${d.type_label.toLowerCase()})`),
          periods: (ctx?.periods || []).map(
            (p) =>
              `${p.name} — ${p.type_label.toLowerCase()}${p.audience_label ? `, ${p.audience_label}` : ''}${
                p.confirmed ? '' : ' (период не подтверждён, в расчёт не идёт)'
              }`,
          ),
        },
        conclusion: s.explanation?.conclusion || '',
        action: s.explanation?.action || '',
        caveats: s.explanation?.caveats || [],
      }
    }),

    glossary: [
      {
        term: 'Лучше / слабее на N%',
        meaning:
          'Насколько продавец сработал выше или ниже того, что обычно бывает в таких же сменах. Это не доля от плана.',
      },
      {
        term: 'Обычно бывает',
        meaning:
          'Норма для похожих смен: тот же сезон, тот же день недели, дневная или ночная. Считается по истории до начала периода.',
      },
      {
        term: 'Покупателей',
        meaning:
          'Число чеков. Это мера спроса, а не работы: привести людей в магазин продавец не может.',
      },
      {
        term: 'Мало покупателей',
        meaning:
          'Зашло меньше обычного. Продавец за это не отвечает, и наказывать за такую смену нельзя.',
      },
      {
        term: 'Вопрос к продавцу',
        meaning:
          'Покупателей было как обычно или больше, а отдача с каждого ниже нормы. Повод разобрать смену, а не штрафовать.',
      },
      {
        term: 'Вытянул поток',
        meaning: 'Покупателей пришло больше обычного, и продавец с ними справился.',
      },
      {
        term: 'Можно доверять / есть сомнения / рано судить',
        meaning:
          'Насколько выводу этой смены можно верить. Понижается от короткой смены, погоды, события в городе и от нехватки похожих смен для сравнения.',
      },
      {
        term: 'Допродажи',
        meaning:
          'Считается внутри ОДНОГО чека. Рамен и напиток в одном чеке — допродажа засчитана. Рамен одним чеком, напиток следующим — это два разных покупателя или две покупки, и допродажей это не считается. Возможность появляется, когда в чеке есть товар из правила «что купили», успех — когда в том же чеке есть и товар из правила «что предложить». Считается по факту присутствия, а не по количеству: два рамена и один напиток — одна засчитанная допродажа.',
      },
      {
        term: 'Обстановка',
        meaning:
          'Погода в часы смены, праздники и учебные периоды этой даты. Объясняет спрос, но на оценку продавца не влияет.',
      },
    ],
  }
}
