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
    weather: { summary: string; label: string; windowed: boolean; window_label: string } | null
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

export function buildShiftReportContract(input: ShiftReportInput) {
  const totalRevenue = input.shifts.reduce((sum, s) => sum + s.revenue, 0)
  const totalReceipts = input.shifts.reduce((sum, s) => sum + s.receipts, 0)
  const questioned = input.shifts.filter((s) => s.verdict === 'POSSIBLE_CASHIER_ISSUE').length
  const strong = input.shifts.filter((s) => s.verdict === 'STRONG_CASHIER').length
  const lowDemand = input.shifts.filter((s) => s.verdict === 'LOW_DEMAND').length

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
        shift: s.shift === 'night' ? 'ночь' : 'день',
        cashier: s.cashier_name,
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
          'Как часто к основному товару предлагалось дополнение — по правилам, заданным в настройках модуля.',
      },
      {
        term: 'Обстановка',
        meaning:
          'Погода в часы смены, праздники и учебные периоды этой даты. Объясняет спрос, но на оценку продавца не влияет.',
      },
    ],
  }
}
