'use client'

/**
 * Вкладка «По продавцам».
 *
 * Смены отвечают на вопрос «что было в этот вечер». Здесь другой вопрос — «как
 * работает человек»: на одной смене повезло с потоком, на другой не повезло, а
 * привычка предлагать напиток к горячему видна только на десятке смен подряд.
 *
 * Поэтому здесь нет выручки крупными цифрами. Выручка зависит от того, сколько
 * людей зашло, а это не заслуга и не вина продавца. Оценивается то, что он
 * делает с каждым покупателем.
 *
 * Сравнения людей между собой на экране продавца нет и не будет — это
 * инструмент управляющего.
 */

import { useMemo, useState } from 'react'
import { Bot, ChevronDown, GraduationCap, Loader2, Sparkles, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'

import { SectionIntro } from './section-intro'

export type CashierRow = {
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
  training_flag: boolean
  training_reason: string | null
}

export type CashierShiftRow = {
  date: string
  shift: 'day' | 'night'
  cashier_id: string | null
  revenue: number
  receipts: number
  score: number | null
  verdict: string
}

const METRIC_LABELS: Record<string, string> = {
  avg_ticket: 'Средний чек',
  items_per_receipt: 'Товаров на чек',
  attach_rate: 'Допродажи',
  revenue_efficiency: 'Отдача с покупателя',
  plan_attainment: 'Выполнение плана',
  product_knowledge: 'Знание товара',
}

const VERDICT_LABELS: Record<string, { label: string; tone: string }> = {
  STRONG_CASHIER: { label: 'Сильная смена', tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300' },
  HIGH_DEMAND: { label: 'Вытянул поток', tone: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300' },
  NORMAL: { label: 'Норма', tone: 'bg-surface-hover text-body' },
  LOW_DEMAND: { label: 'Мало покупателей', tone: 'bg-surface-hover text-muted-foreground' },
  POSSIBLE_CASHIER_ISSUE: { label: 'Вопрос к продавцу', tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300' },
  INSUFFICIENT_DATA: { label: 'Мало данных', tone: 'bg-surface-hover text-muted-foreground' },
}

const STATUS_LABELS: Record<string, { label: string; hint: string; tone: string }> = {
  TOP: {
    label: 'Топ',
    hint: 'заметно выше нормы по нескольким метрикам',
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  },
  STRONG: {
    label: 'Сильный',
    hint: 'стабильно выше нормы',
    tone: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300',
  },
  NORMAL: {
    label: 'Норма',
    hint: 'работает как обычно для этой точки',
    tone: 'bg-surface-hover text-body',
  },
  NEEDS_TRAINING: {
    label: 'Нужна помощь',
    hint: 'несколько смен подряд ниже нормы',
    tone: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  },
  INSUFFICIENT_DATA: {
    label: 'Рано судить',
    hint: 'смен пока мало',
    tone: 'bg-surface-hover text-muted-foreground',
  },
}

function scoreText(score: number | null): string {
  if (score == null) return 'нет оценки'
  const delta = Math.round((score - 1) * 100)
  if (Math.abs(delta) < 3) return 'как обычно'
  return delta > 0 ? `лучше на ${delta}%` : `слабее на ${Math.abs(delta)}%`
}

function confidenceText(value: number): string {
  const pct = Math.round(value * 100)
  if (pct >= 75) return 'можно доверять'
  if (pct >= 45) return 'есть сомнения'
  return 'рано судить'
}

/**
 * Полоса отклонения метрики от нормы.
 *
 * Ноль — по центру, потому что вопрос не «сколько», а «в какую сторону».
 * Шкала обрезана на ±40%: дальше отличия уже не читаются глазом, а хвосты
 * растянули бы все остальные полосы в ниточку.
 */
function MetricBar({ label, ratio }: { label: string; ratio: number }) {
  const delta = Math.round((ratio - 1) * 100)
  const capped = Math.max(-40, Math.min(40, delta))
  const width = Math.abs(capped) / 40 / 2

  return (
    <div className="flex items-center gap-2">
      <span className="w-40 shrink-0 text-xs text-body">{label}</span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-surface-hover">
        <div className="absolute inset-y-0 left-1/2 w-px bg-border" />
        <div
          className={`absolute inset-y-0 ${delta >= 0 ? 'bg-emerald-500' : 'bg-amber-500'}`}
          style={{
            left: delta >= 0 ? '50%' : `${50 - width * 100}%`,
            width: `${width * 100}%`,
          }}
        />
      </div>
      <span
        className={`w-16 shrink-0 text-right text-xs font-medium tabular-nums ${
          delta >= 5
            ? 'text-emerald-600 dark:text-emerald-400'
            : delta <= -5
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-muted-foreground'
        }`}
      >
        {Math.abs(delta) < 1 ? 'как обычно' : `${delta > 0 ? '+' : ''}${delta}%`}
      </span>
    </div>
  )
}

type CashierAi = {
  summary: string
  strengths: string
  weaknesses: string
  pattern: string
  conversation: string
  watch_out: string[]
}

export function CashiersTab(props: {
  companyId: string
  from: string
  to: string
  cashiers: CashierRow[]
  shifts: CashierShiftRow[]
  minQualifyingShifts: number
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [ai, setAi] = useState<Record<string, CashierAi>>({})
  const [aiBusy, setAiBusy] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)

  /**
   * Разбор человека от ИИ — только по нажатию.
   *
   * Модель ничего не решает: она объясняет уже посчитанное и подсказывает, как
   * построить разговор. Ни статуса, ни доплаты она не меняет.
   */
  async function askAi(cashierId: string) {
    setAiBusy(cashierId)
    setAiError(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cashier',
          company_id: props.companyId,
          cashier_id: cashierId,
          from: props.from,
          to: props.to,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      if (json?.data?.ai) setAi((prev) => ({ ...prev, [cashierId]: json.data.ai }))
      if (json?.data?.ai_error) setAiError(String(json.data.ai_error))
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Не удалось получить разбор')
    } finally {
      setAiBusy(null)
    }
  }

  const shiftsByCashier = useMemo(() => {
    const map = new Map<string, CashierShiftRow[]>()
    for (const s of props.shifts) {
      if (!s.cashier_id) continue
      const list = map.get(s.cashier_id) || []
      list.push(s)
      map.set(s.cashier_id, list)
    }
    return map
  }, [props.shifts])

  // Порядок — от требующих внимания к сильным: с кем разговаривать, тот и
  // сверху.
  const ordered = useMemo(() => {
    const rank: Record<string, number> = {
      NEEDS_TRAINING: 0,
      NORMAL: 1,
      STRONG: 2,
      TOP: 3,
      INSUFFICIENT_DATA: 4,
    }
    return [...props.cashiers].sort(
      (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (a.score ?? 9) - (b.score ?? 9),
    )
  }, [props.cashiers])

  return (
    <div className="space-y-4">
      <SectionIntro
        icon={<Users className="h-5 w-5" />}
        tone="emerald"
        title="Как работает каждый продавец"
        what="Оценка человека, а не отдельной смены. На одной смене повезло с потоком, на другой не повезло — привычка предлагать допродажу видна только на десятке смен подряд."
        todo={[
          'Посмотреть, у кого стоит «нужна помощь» — с ними и разговаривать',
          'Открыть человека и увидеть, какая метрика его тянет вниз',
          'Взять одну его слабую смену и разобрать конкретно её',
        ]}
        how={`Каждая метрика сравнивается с нормой для похожих смен, потом усредняется по всем сменам человека. Смена с тремя чеками весит меньше смены с шестьюдесятью. Статус ставится от ${props.minQualifyingShifts} смен: по паре смен человека оценивать нельзя. Выручка здесь — справка: она зависит от того, сколько людей зашло, а это не заслуга продавца.`}
      />

      {ordered.length === 0 ? (
        <Card className="p-6 text-sm text-body">
          За период нет смен с указанным продавцом. Если чеки пробивались без входа под своей учётной
          записью, оценить работу людей не из чего.
        </Card>
      ) : (
        ordered.map((c) => {
          const status = STATUS_LABELS[c.status] || STATUS_LABELS.NORMAL
          const isOpen = open === c.cashier_id
          const mine = shiftsByCashier.get(c.cashier_id) || []
          const metrics = Object.entries(c.metric_ratios || {}).filter(
            ([, ratio]) => ratio != null,
          ) as [string, number][]

          return (
            <Card key={c.cashier_id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpen(isOpen ? null : c.cashier_id)}
                className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-hover"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-foreground">{c.name}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.tone}`}>
                      {status.label}
                    </span>
                    {c.training_flag ? (
                      <span
                        className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300"
                        title={c.training_reason || ''}
                      >
                        <GraduationCap className="h-3 w-3" /> рекомендуется обучение
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {status.hint} · {c.shifts} смен · {c.receipts} чеков · {formatMoney(c.revenue)}
                  </div>
                </div>

                <div className="text-right">
                  <div
                    className={`text-sm font-semibold ${
                      (c.score ?? 1) >= 1.05
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : (c.score ?? 1) <= 0.95
                          ? 'text-amber-600 dark:text-amber-400'
                          : 'text-body'
                    }`}
                    title={c.score == null ? '' : `Балл ${c.score.toFixed(2)}`}
                  >
                    {scoreText(c.score)}
                  </div>
                  <div className="text-xs text-muted-foreground">{confidenceText(c.confidence)}</div>
                </div>

                <ChevronDown
                  className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {isOpen ? (
                <div className="border-t border-border px-4 py-4">
                  <div className="grid gap-5 lg:grid-cols-2">
                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Как он работает с покупателем
                      </div>
                      {metrics.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Метрики посчитать не из чего: в сменах нет построчных чеков.
                        </p>
                      ) : (
                        <div className="space-y-2">
                          {metrics.map(([metric, ratio]) => (
                            <MetricBar
                              key={metric}
                              label={METRIC_LABELS[metric] || metric}
                              ratio={ratio}
                            />
                          ))}
                        </div>
                      )}

                      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                        Отклонение от нормы для похожих смен. Ноль — работает как обычно для этой точки, а не
                        «плохо».
                      </p>
                    </div>

                    <div>
                      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Из чего сложились его смены
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(c.verdicts || {})
                          .filter(([, count]) => count > 0)
                          .map(([verdict, count]) => {
                            const v = VERDICT_LABELS[verdict] || { label: verdict, tone: 'bg-surface-hover text-body' }
                            return (
                              <span
                                key={verdict}
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${v.tone}`}
                              >
                                {v.label} · {count}
                              </span>
                            )
                          })}
                      </div>

                      {mine.length > 0 ? (
                        <div className="mt-3 max-h-56 space-y-1 overflow-y-auto pr-1">
                          {mine.map((s) => {
                            const v = VERDICT_LABELS[s.verdict] || { label: s.verdict, tone: '' }
                            return (
                              <div
                                key={`${s.date}-${s.shift}`}
                                className="flex items-center gap-2 rounded-lg bg-surface-muted px-2.5 py-1.5 text-xs"
                              >
                                <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                                  {s.date}
                                </span>
                                <span className="w-10 shrink-0 text-muted-foreground">
                                  {s.shift === 'night' ? 'ночь' : 'день'}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-body">{v.label}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">
                                  {s.receipts} чек.
                                </span>
                                <span className="w-24 shrink-0 text-right tabular-nums text-body">
                                  {formatMoney(s.revenue)}
                                </span>
                              </div>
                            )
                          })}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  {(c.strengths.length > 0 || c.weaknesses.length > 0) ? (
                    <div className="mt-4 grid gap-2 rounded-lg bg-surface-muted p-3 text-xs sm:grid-cols-2">
                      <div>
                        <b className="text-emerald-600 dark:text-emerald-400">Сильные стороны.</b>{' '}
                        {c.strengths.length > 0
                          ? c.strengths.map((m) => (METRIC_LABELS[m] || m).toLowerCase()).join(', ')
                          : 'пока ничего не выделяется'}
                      </div>
                      <div>
                        <b className="text-amber-600 dark:text-amber-400">Стоит подтянуть.</b>{' '}
                        {c.weaknesses.length > 0
                          ? c.weaknesses.map((m) => (METRIC_LABELS[m] || m).toLowerCase()).join(', ')
                          : 'явных провалов нет'}
                      </div>
                    </div>
                  ) : null}

                  {c.training_flag && c.training_reason ? (
                    <p className="mt-2 text-xs leading-relaxed text-amber-700 dark:text-amber-300">
                      {c.training_reason} Это повод сесть рядом на смену, а не наказать.
                    </p>
                  ) : null}

                  {/* Разбор от ИИ поверх готовых цифр: он объясняет, а не считает. */}
                  <div className="mt-4 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        <Bot className="h-4 w-4" /> Как с ним разговаривать
                      </div>
                      {!ai[c.cashier_id] ? (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={aiBusy !== null}
                          onClick={() => void askAi(c.cashier_id)}
                        >
                          {aiBusy === c.cashier_id ? (
                            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="mr-1 h-3.5 w-3.5" />
                          )}
                          Спросить ИИ
                        </Button>
                      ) : null}
                    </div>

                    {ai[c.cashier_id] ? (
                      <div className="mt-2 space-y-2 text-xs leading-relaxed text-body">
                        <p>{ai[c.cashier_id].summary}</p>
                        {ai[c.cashier_id].pattern ? (
                          <p>
                            <b>Закономерность.</b> {ai[c.cashier_id].pattern}
                          </p>
                        ) : null}
                        <div className="rounded-lg bg-surface-muted p-2.5">
                          <b>Разговор.</b> {ai[c.cashier_id].conversation}
                        </div>
                        {ai[c.cashier_id].watch_out.length > 0 ? (
                          <p className="text-muted-foreground">
                            Где вывод слабый: {ai[c.cashier_id].watch_out.join('; ')}
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                        Модель не считает цифры — она объясняет уже посчитанное и подсказывает, с чего
                        начать разговор. Ни статус, ни доплату она не меняет.
                      </p>
                    )}

                    {aiError && aiBusy === null ? (
                      <p className="mt-1.5 text-xs text-rose-600 dark:text-rose-400">{aiError}</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </Card>
          )
        })
      )}
    </div>
  )
}
