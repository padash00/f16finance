/**
 * Перевод расчёта модуля в контракт PDF.
 *
 * Здесь только преобразование структуры и форматирование. Ни одной новой
 * формулы: отчёт, расходящийся с экраном, хуже отсутствия отчёта.
 *
 * Состояния метрик решаются тоже здесь, а не в шаблоне. Правило «дельта больше
 * нуля — зелёное» вынесено в одно место, чтобы его можно было изменить для
 * конкретной метрики, если однажды окажется, что рост у неё означает не то.
 */

import type { StoreKpiReport } from '@/lib/server/store-kpi-report'
import type {
  GlossaryItem,
  MetricState,
  PdfMetric,
  SellerPdfSummary,
  ShiftEfficiencyPdfReport,
  ShiftPdfDetails,
  StatusState,
  TrustState,
} from './shift-efficiency-pdf-dto'

// ─── Формат ─────────────────────────────────────────────────────────────────

/** «1 775 599 ₸». Разделитель — неразрывный пробел, чтобы не рвалось. */
export function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return `${Math.round(value).toLocaleString('ru-RU').replace(/ /g, ' ')} ₸`
}

export function count(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Math.round(value).toLocaleString('ru-RU').replace(/ /g, ' ')
}

/**
 * «+13%», «−9%», «как обычно», «нет нормы».
 *
 * Минус — типографский, а не дефис: в отчёте он стоит рядом с цифрами и
 * дефис на его месте читается как перенос.
 */
export function percent(delta: number | null | undefined): string {
  if (delta == null || !Number.isFinite(delta)) return 'нет нормы'
  const rounded = Math.round(delta)
  if (rounded === 0) return 'как обычно'
  return rounded > 0 ? `+${rounded}%` : `−${Math.abs(rounded)}%`
}

/** Порог, ниже которого отклонение считается шумом, а не сигналом. */
const NOISE_BAND = 5

function metricState(delta: number | null | undefined, hasData: boolean): MetricState {
  if (!hasData || delta == null) return 'no_data'
  if (delta >= NOISE_BAND) return 'positive'
  if (delta <= -NOISE_BAND) return 'negative'
  return 'neutral'
}

const METRIC_LABELS: Record<string, string> = {
  avg_ticket: 'Средний чек',
  items_per_receipt: 'Товаров на чек',
  attach_rate: 'Допродажи',
  revenue_efficiency: 'Отдача с покупателя',
  plan_attainment: 'Выполнение плана',
  product_knowledge: 'Знание товара',
}

function formatMetricValue(metric: string, value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  if (metric === 'attach_rate') return `${Math.round(value * 100)}%`
  if (metric === 'avg_ticket' || metric === 'revenue_efficiency' || metric === 'plan_attainment') {
    return money(value)
  }
  return value.toFixed(2)
}

/** Пустая метрика — не ноль, а честное «нет нормы». */
function emptyMetric(metric: string): PdfMetric {
  return {
    label: METRIC_LABELS[metric] || metric,
    factLabel: '—',
    normLabel: '—',
    deltaLabel: 'нет нормы',
    state: 'no_data',
  }
}

function toMetric(
  metric: string,
  actual: number | null | undefined,
  expected: number | null | undefined,
  delta: number | null | undefined,
): PdfMetric {
  const hasData = actual != null && expected != null
  return {
    label: METRIC_LABELS[metric] || metric,
    factLabel: formatMetricValue(metric, actual ?? null),
    normLabel: formatMetricValue(metric, expected ?? null),
    deltaLabel: hasData ? percent(delta) : 'нет нормы',
    state: metricState(delta, hasData),
  }
}

// ─── Статусы ────────────────────────────────────────────────────────────────

const STATUS: Record<string, { label: string; state: StatusState }> = {
  STRONG_CASHIER: { label: 'Сильная смена', state: 'positive' },
  LOW_DEMAND: { label: 'Мало покупателей', state: 'warning' },
  POSSIBLE_CASHIER_ISSUE: { label: 'Вопрос к продавцу', state: 'negative' },
  HIGH_DEMAND: { label: 'Вытянул поток', state: 'neutral' },
  NORMAL: { label: 'Норма', state: 'neutral' },
  INSUFFICIENT_DATA: { label: 'Мало данных', state: 'neutral' },
}

const SELLER_STATUS: Record<string, string> = {
  TOP: 'Топ — заметно выше нормы',
  STRONG: 'Сильный — стабильно выше нормы',
  NORMAL: 'Норма — работает как обычно',
  NEEDS_TRAINING: 'Нужна помощь — несколько смен ниже нормы',
  INSUFFICIENT_DATA: 'Рано судить — смен пока мало',
}

function trust(confidence: number | null | undefined): { label: string; state: TrustState } {
  const pct = Math.round((confidence ?? 0) * 100)
  if (pct >= 75) return { label: 'можно доверять', state: 'trusted' }
  if (pct >= 45) return { label: 'есть сомнения', state: 'doubtful' }
  return { label: 'рано судить', state: 'too_early' }
}

/** Балл словами — теми же, что на экране. */
export function scoreVsNorm(score: number | null | undefined): string {
  if (score == null) return 'нет оценки'
  const delta = Math.round((score - 1) * 100)
  if (Math.abs(delta) < 3) return 'как обычно'
  return delta > 0 ? `+${delta}%` : `−${Math.abs(delta)}%`
}

function scoreState(score: number | null | undefined): SellerPdfSummary['scoreState'] {
  if (score == null) return 'no_data'
  const delta = (score - 1) * 100
  if (delta >= 3) return 'positive'
  if (delta <= -3) return 'negative'
  return 'neutral'
}

// ─── Обстановка ─────────────────────────────────────────────────────────────

/**
 * Учебные периоды по смыслу, а не подряд.
 *
 * Шесть строк «Учёба. Вузы — приём документов на такое-то направление» подряд
 * читать невозможно, а выбросить их нельзя: в них разная информация. Поэтому
 * они склеиваются в одну фразу на категорию — уникальные названия
 * сохраняются.
 */
function groupEducation(periods: { name: string; type_label: string; audience_label: string | null }[]) {
  const buckets = new Map<string, Set<string>>()

  for (const p of periods) {
    const audience = (p.audience_label || '').toLowerCase()
    const name = p.name.toLowerCase()

    const key =
      audience.includes('школьник') || name.includes('школ') || name.includes('первый класс')
        ? 'schools'
        : audience.includes('студент') || name.includes('вуз') || name.includes('университет')
          ? 'universities'
          : name.includes('колледж') || audience.includes('колледж')
            ? 'colleges'
            : audience.includes('абитуриент') || name.includes('ент') || name.includes('грант')
              ? 'unt'
              : 'events'

    if (!buckets.has(key)) buckets.set(key, new Set())
    buckets.get(key)!.add(p.name)
  }

  const join = (key: string): string | undefined => {
    const set = buckets.get(key)
    if (!set || set.size === 0) return undefined
    return [...set].join('; ')
  }

  return {
    schools: join('schools'),
    universities: join('universities'),
    colleges: join('colleges'),
    unt: join('unt'),
    events: buckets.has('events') ? [...buckets.get('events')!] : undefined,
  }
}

// ─── Словарь ────────────────────────────────────────────────────────────────

const GLOSSARY: GlossaryItem[] = [
  {
    term: 'Лучше / слабее на N%',
    accent: 'green',
    meaning:
      'Насколько продавец сработал выше или ниже того, что обычно бывает в таких же сменах. Это не доля от плана.',
  },
  {
    term: 'Обычно бывает',
    accent: 'blue',
    meaning:
      'Норма для похожих смен: тот же сезон, тот же день недели, дневная или ночная. Считается по истории до начала периода.',
  },
  {
    term: 'Покупателей',
    accent: 'blue',
    meaning:
      'Число чеков. Это мера спроса, а не работы: привести людей в магазин продавец не может.',
  },
  {
    term: 'Мало покупателей',
    accent: 'amber',
    meaning:
      'Зашло меньше обычного. Продавец за это не отвечает, и наказывать за такую смену нельзя.',
  },
  {
    term: 'Вопрос к продавцу',
    accent: 'red',
    meaning:
      'Покупателей было как обычно или больше, а отдача с каждого ниже нормы. Повод разобрать смену, а не штрафовать.',
  },
  {
    term: 'Вытянул поток',
    accent: 'teal',
    meaning: 'Покупателей пришло больше обычного, и продавец с ними справился.',
  },
  {
    term: 'Можно доверять · есть сомнения · рано судить',
    accent: 'gray',
    meaning:
      'Насколько выводу можно верить. Понижается от короткой смены, погоды, события в городе и от нехватки похожих смен для сравнения.',
  },
  {
    term: 'Допродажи',
    accent: 'green',
    meaning:
      'Считается внутри одного чека: рамен и напиток в одном чеке — засчитано, разными чеками — нет. По факту присутствия, а не по количеству.',
  },
  {
    term: 'Обстановка',
    accent: 'navy',
    meaning:
      'Погода в часы смены, праздники и учебные периоды этой даты. Объясняет спрос, но на оценку продавца не влияет.',
  },
]

// ─── Сборка ─────────────────────────────────────────────────────────────────

export function mapReportToPdfDto(args: {
  report: StoreKpiReport
  point: { id: string; name: string }
  monthLabel: string
  generatedAt: string
}): ShiftEfficiencyPdfReport {
  const { report, point } = args

  const shifts: ShiftPdfDetails[] = report.shifts.map((s: any) => {
    const status = STATUS[s.verdict] || { label: s.verdict, state: 'neutral' as StatusState }
    const t = trust(s.confidence)
    const explanation = s.explanation
    const ctx = s.context

    const byMetric = new Map<string, any>()
    for (const m of s.metrics || []) byMetric.set(m.metric, m)
    const reading = new Map<string, any>()
    for (const m of explanation?.metrics || []) reading.set(m.metric, m)

    const metricOf = (key: string): PdfMetric => {
      const raw = byMetric.get(key)
      const read = reading.get(key)
      if (!raw && !read) return emptyMetric(key)

      // Отклонение берём тем же, что на экране. Если словесного разбора по
      // этой метрике нет, считаем из отношения, посчитанного доменом, —
      // это то же число, а не новая формула.
      const delta =
        read?.delta_pct ??
        (raw?.raw_ratio != null
          ? Math.round((raw.raw_ratio - 1) * 100)
          : raw?.ratio != null
            ? Math.round((raw.ratio - 1) * 100)
            : null)

      return toMetric(key, raw?.actual ?? read?.actual, raw?.expected ?? read?.expected, delta)
    }

    const education = groupEducation(ctx?.periods || [])
    const holidays = (ctx?.days || []).map((d: any) => `${d.name} (${d.type_label.toLowerCase()})`)

    // Абзацы разбора приходят с префиксами «Спрос.», «Касса.» и так далее —
    // раскладываем их по своим карточкам, а не печатаем сплошняком.
    const paragraphs: string[] = explanation?.paragraphs || []
    const pick = (prefix: string) =>
      paragraphs.find((p) => p.startsWith(prefix))?.slice(prefix.length).trim() || ''

    return {
      id: `${s.date}-${s.shift}-${s.cashier_id ?? 'none'}`,
      date: s.date,
      shiftType: s.shift,
      shiftTypeLabel: s.shift === 'night' ? 'ночь' : 'день',
      sellerName: s.cashier_name || 'без продавца',
      statusCode: s.verdict,
      statusLabel: status.label,
      statusState: status.state,
      score: s.score,
      scoreVsNormLabel: scoreVsNorm(s.score),
      trustLabel: t.label,
      trustState: t.state,
      revenue: s.revenue,
      expectedRevenue: s.expected_revenue,
      checks: s.receipts,
      expectedChecks: s.expected_receipts,
      durationHours:
        s.duration_minutes == null ? null : Math.round((s.duration_minutes / 60) * 10) / 10,
      mainConclusion: explanation?.headline || '',
      meaningText: explanation?.conclusion || '',
      actionText: explanation?.action || '',
      metrics: {
        avgCheck: metricOf('avg_ticket'),
        itemsPerCheck: metricOf('items_per_receipt'),
        upsell: metricOf('attach_rate'),
        customerYield: metricOf('revenue_efficiency'),
        plan: metricOf('plan_attainment'),
        productKnowledge: metricOf('product_knowledge'),
      },
      reasoning: {
        demandText: pick('Спрос.'),
        revenueText: pick('Касса.'),
        sellerWorkText: pick('Работа продавца.'),
        volumeText: pick('Объём.'),
        durationText: pick('Длительность.'),
      },
      context: {
        weather: ctx?.weather
          ? `${ctx.weather.label}. ${ctx.weather.summary}${
              ctx.weather.windowed ? ` Окно смены ${ctx.weather.window_label}.` : ''
            }`
          : undefined,
        schools: education.schools,
        universities: education.universities,
        colleges: education.colleges,
        unt: education.unt,
        events: [...(education.events || []), ...holidays].length
          ? [...(education.events || []), ...holidays]
          : undefined,
      },
      limitations: explanation?.caveats || [],
    }
  })

  const sellers: SellerPdfSummary[] = report.cashiers.map((c: any, i: number) => {
    const t = trust(c.confidence)
    const ratios = c.metric_ratios || {}

    const metricFromRatio = (key: string): PdfMetric => {
      const r = ratios[key]
      if (r == null) return emptyMetric(key)
      const delta = (r - 1) * 100
      return {
        label: METRIC_LABELS[key] || key,
        factLabel: percent(delta),
        normLabel: 'норма',
        deltaLabel: percent(delta),
        state: metricState(delta, true),
      }
    }

    const tags = Object.entries(c.verdicts || {})
      .filter(([, n]) => (n as number) > 0)
      .map(([key, n]) => ({
        label: STATUS[key]?.label || key,
        count: n as number,
        state: STATUS[key]?.state || ('neutral' as StatusState),
      }))

    return {
      sellerId: c.cashier_id,
      name: c.name,
      rank: i + 1,
      scoreVsNormLabel: scoreVsNorm(c.score),
      scoreState: scoreState(c.score),
      statusText: SELLER_STATUS[c.status] || c.status,
      trustLabel: t.label,
      trustState: t.state,
      shiftsCount: c.shifts,
      checksCount: c.receipts,
      revenue: c.revenue,
      shiftTags: tags,
      metrics: {
        avgCheck: metricFromRatio('avg_ticket'),
        itemsPerCheck: metricFromRatio('items_per_receipt'),
        upsell: metricFromRatio('attach_rate'),
        customerYield: metricFromRatio('revenue_efficiency'),
        plan: metricFromRatio('plan_attainment'),
      },
      strengths: (c.strengths || []).length
        ? (c.strengths as string[]).map((m) => (METRIC_LABELS[m] || m).toLowerCase()).join(', ')
        : undefined,
      focus: (c.weaknesses || []).length
        ? (c.weaknesses as string[]).map((m) => (METRIC_LABELS[m] || m).toLowerCase()).join(', ')
        : undefined,
    }
  })

  const t = report.totals

  return {
    generatedAt: args.generatedAt,
    point,
    period: { from: report.period.from, to: report.period.to, monthLabel: args.monthLabel },
    summary: {
      shiftsCount: t.shifts,
      totalRevenue: t.revenue,
      totalChecks: t.receipts,
      sellerCount: sellers.length,
      strongShiftCount: t.strong,
      lowTrafficCount: t.low_demand,
      sellerQuestionCount: t.cashier_issue,
      // «Прочее» — всё, что не попало в три названные группы: норма, вытянул
      // поток и смены без достаточных данных.
      otherCount: Math.max(0, t.shifts - t.strong - t.low_demand - t.cashier_issue),
    },
    sellers,
    shifts,
    glossary: GLOSSARY,
  }
}
