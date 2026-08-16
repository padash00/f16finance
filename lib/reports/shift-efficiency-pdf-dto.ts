/**
 * Контракт PDF-отчёта «Разбор смен и эффективности продавцов».
 *
 * Отдельный тип нужен затем, чтобы шаблон не лез в доменные структуры и не
 * начинал считать сам. Правило жёсткое: **шаблон ничего не вычисляет**. Все
 * состояния — положительная метрика, отсутствие нормы, уровень доверия —
 * приходят сюда уже решёнными.
 *
 * Причина не в чистоте кода. «Больше нуля — значит зелёное» верно не для
 * каждой метрики: у одних рост это хорошо, у других он может означать, что
 * что-то пошло не так. Как только шаблон начнёт красить сам, он рано или
 * поздно покрасит неверно, и это будет незаметно.
 */

export type MetricState = 'positive' | 'negative' | 'neutral' | 'warning' | 'no_data'
export type TrustState = 'trusted' | 'doubtful' | 'too_early'
export type StatusState = 'positive' | 'negative' | 'warning' | 'neutral'

export type PdfMetric = {
  label: string
  /** «1 433 ₸», «1.65», «22%», «—». Уже отформатировано. */
  factLabel: string
  normLabel: string
  /** «+22%», «−9%», «как обычно», «нет нормы». */
  deltaLabel: string
  state: MetricState
}

export type SellerPdfSummary = {
  sellerId: string | null
  name: string
  rank?: number
  scoreVsNormLabel: string
  scoreState: 'positive' | 'negative' | 'neutral' | 'no_data'
  statusText: string
  trustLabel: string
  trustState: TrustState
  shiftsCount: number
  checksCount: number
  revenue: number
  shiftTags: { label: string; count: number; state: StatusState }[]
  metrics: {
    avgCheck: PdfMetric
    itemsPerCheck: PdfMetric
    upsell: PdfMetric
    customerYield: PdfMetric
    plan: PdfMetric
  }
  strengths?: string
  focus?: string
}

export type ShiftPdfDetails = {
  id: string
  date: string
  shiftType: string
  /** «день» / «ночь» — уже на русском. */
  shiftTypeLabel: string
  sellerName: string
  statusCode: string
  statusLabel: string
  statusState: StatusState
  score: number | null
  scoreVsNormLabel: string
  trustLabel: string
  trustState: TrustState
  revenue: number | null
  expectedRevenue: number | null
  checks: number | null
  expectedChecks: number | null
  durationHours: number | null
  mainConclusion: string
  meaningText: string
  actionText: string
  metrics: {
    avgCheck: PdfMetric
    itemsPerCheck: PdfMetric
    upsell: PdfMetric
    customerYield: PdfMetric
    plan: PdfMetric
    productKnowledge: PdfMetric
  }
  reasoning: {
    demandText: string
    revenueText: string
    sellerWorkText: string
    volumeText: string
    durationText: string
  }
  /** Пустые категории отсутствуют: «Праздники: нет» — мусор на странице. */
  context: {
    weather?: string
    schools?: string
    universities?: string
    colleges?: string
    unt?: string
    events?: string[]
  }
  limitations: string[]
}

export type GlossaryItem = {
  term: string
  meaning: string
  /** Цвет вертикальной линии слева — из палитры отчёта. */
  accent: 'green' | 'amber' | 'red' | 'blue' | 'teal' | 'gray' | 'navy'
}

export type ShiftEfficiencyPdfReport = {
  generatedAt: string
  point: { id: string; name: string }
  period: { from: string; to: string; monthLabel: string }
  summary: {
    shiftsCount: number
    totalRevenue: number
    totalChecks: number
    sellerCount: number
    strongShiftCount: number
    lowTrafficCount: number
    sellerQuestionCount: number
    otherCount: number
  }
  sellers: SellerPdfSummary[]
  shifts: ShiftPdfDetails[]
  glossary: GlossaryItem[]
}
