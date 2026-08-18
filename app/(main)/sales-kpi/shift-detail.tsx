'use client'

/**
 * Развёрнутый разбор одной смены.
 *
 * Показывает всё, из чего сложился вывод: что было с потоком, что с кассой,
 * что делал продавец, каждая метрика с человеческим прочтением, чего в данных
 * не хватило и что стоит сделать. Этот разбор не требует ИИ — он посчитан
 * детерминированно и виден сразу.
 *
 * Кнопка ИИ добавляет поверх связный текст. Если модель недоступна, разбор
 * остаётся на месте: модуль обязан работать без неё.
 */

import { useState } from 'react'
import { AlertTriangle, Bot, CalendarDays, CloudSun, GraduationCap, Loader2, Sparkles } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/core/format'

export type MetricReading = {
  metric: string
  label: string
  actual: number | null
  expected: number | null
  delta_pct: number | null
  reading: string
  sample: number
}

export type ShiftExplanation = {
  headline: string
  paragraphs: string[]
  metrics: MetricReading[]
  conclusion: string
  action: string
  caveats: string[]
}

/**
 * Обстановка смены: погода, праздники, учебный период.
 *
 * Всё это уже было в системе, но лежало по разным экранам. Здесь оно рядом с
 * выводом, потому что вопрос «почему такая касса» без него не закрывается.
 */
export type ShiftContext = {
  weather: {
    bucket: string
    label: string
    windowed: boolean
    temperature_max: number | null
    temperature_min: number | null
    precipitation_mm: number | null
    window_label: string
    summary: string
  } | null
  days: { name: string; type_label: string; impact_index: number; verified: boolean }[]
  periods: {
    name: string
    type_label: string
    audience_label: string | null
    index: number | null
    confirmed: boolean
  }[]
}

type AiResult = {
  summary: string
  traffic: string
  store: string
  cashier: string
  conclusion: string
  recommendation: string
  uncertainties: string[]
}

function formatMetric(metric: string, value: number | null): string {
  if (value == null) return '—'
  if (metric === 'attach_rate') return `${Math.round(value * 100)}%`
  if (metric === 'avg_ticket' || metric === 'revenue_efficiency' || metric === 'plan_attainment')
    return formatMoney(value)
  return value.toFixed(2)
}

function deltaTone(delta: number | null): string {
  if (delta == null) return 'text-muted-foreground'
  if (delta >= 5) return 'text-emerald-600 dark:text-emerald-400'
  if (delta <= -5) return 'text-amber-600 dark:text-amber-400'
  return 'text-body'
}

function Block(props: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {props.title}
      </div>
      {props.children}
    </div>
  )
}

/** Влияние особого дня словами: 1.00 — нейтрально, отклонение в процентах. */
function impactText(value: number): string {
  const delta = Math.round((Number(value) - 1) * 100)
  if (delta === 0) return 'влияние не задано'
  return delta > 0 ? `спрос выше на ${delta}%` : `спрос ниже на ${Math.abs(delta)}%`
}

function ContextBlock(props: { context: ShiftContext }) {
  const { weather, days, periods } = props.context
  const empty = !weather && days.length === 0 && periods.length === 0

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Обстановка в этот день
      </div>

      {empty ? (
        <p className="text-xs leading-relaxed text-muted-foreground">
          Ничего не известно: погода не загружена, праздников и учебных периодов на эту дату нет.
          Догрузить погоду и справочники можно во вкладке «Цели на смену».
        </p>
      ) : (
        <div className="space-y-2">
          {weather ? (
            <div className="flex items-start gap-2">
              <CloudSun className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
              <div className="min-w-0 text-xs leading-relaxed text-body">
                <span className="font-medium">{weather.label}</span>
                {weather.windowed ? (
                  <span className="text-muted-foreground"> · окно смены {weather.window_label}</span>
                ) : null}
                <div className="text-muted-foreground">{weather.summary}</div>
              </div>
            </div>
          ) : null}

          {days.map((d) => (
            <div key={`${d.type_label}-${d.name}`} className="flex items-start gap-2">
              <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-500" />
              <div className="min-w-0 text-xs leading-relaxed text-body">
                <span className="font-medium">{d.name}</span>
                <span className="text-muted-foreground"> · {d.type_label}</span>
                <div className="text-muted-foreground">
                  {impactText(d.impact_index)}
                  {!d.verified ? ' · дата не сверена' : ''}
                </div>
              </div>
            </div>
          ))}

          {periods.map((p) => (
            <div key={`${p.type_label}-${p.name}`} className="flex items-start gap-2">
              <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0 text-violet-500" />
              <div className="min-w-0 text-xs leading-relaxed text-body">
                <span className="font-medium">{p.name}</span>
                <span className="text-muted-foreground">
                  {' '}
                  · {p.type_label}
                  {p.audience_label ? ` · ${p.audience_label}` : ''}
                </span>
                <div className="text-muted-foreground">
                  {p.confirmed
                    ? p.index != null
                      ? impactText(p.index)
                      : 'влияние не задано'
                    : 'период не подтверждён — в расчёт не идёт'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        Обстановка объясняет, сколько людей зашло. На баллы продавца она не влияет: за погоду и
        праздники он не отвечает.
      </p>
    </div>
  )
}

/**
 * Что ожидалось от смены и что случилось.
 *
 * Показываем деловой смысл, а не устройство модели: человеку нужно знать,
 * попал ли поток в обычные границы и насколько уверенно продавец обошёл норму.
 * Названия распределений, параметры разброса и размеры выборки живут во
 * вкладке качества — здесь они только мешали бы.
 */
function ForecastBlock(props: { probability: ShiftProbabilityView }) {
  const { demand, fact_percentile, attach, simulation } = props.probability
  if (!demand && !attach && !simulation) return null

  const percent = (value: number) => Math.round(value * 100)

  return (
    <Block title="Чего ждали от смены">
      <div className="space-y-2.5 text-xs leading-relaxed text-body">
        {demand ? (
          <div>
            <div>
              Ожидалось <span className="font-semibold text-foreground">{Math.round(demand.expectedReceipts)} чеков</span>,
              обычные границы для такой смены — от {Math.round(demand.interval80.low)} до{' '}
              {Math.round(demand.interval80.high)}.
            </div>
            {fact_percentile !== null ? (
              <div className="text-muted-foreground">
                {fact_percentile <= 0.15
                  ? `Поток был в нижних ${percent(fact_percentile)}% ожидаемого — покупателей пришло заметно меньше обычного.`
                  : fact_percentile >= 0.85
                    ? `Поток был в верхних ${100 - percent(fact_percentile)}% ожидаемого — покупателей пришло заметно больше обычного.`
                    : 'Поток остался в обычных границах — спрос был как всегда.'}
              </div>
            ) : null}
          </div>
        ) : null}

        {simulation ? (
          <div>
            <div>
              Прогноз выручки был{' '}
              <span className="font-semibold text-foreground">
                {simulation.medianRevenue.toLocaleString('ru-RU')} ₸
              </span>
              , вероятные границы — от {simulation.interval80.low.toLocaleString('ru-RU')} до{' '}
              {simulation.interval80.high.toLocaleString('ru-RU')} ₸.
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
              {simulation.probabilityB1 !== null ? <span>B1 — {percent(simulation.probabilityB1)}%</span> : null}
              {simulation.probabilityB2 !== null ? <span>B2 — {percent(simulation.probabilityB2)}%</span> : null}
              {simulation.probabilityB3 !== null ? <span>B3 — {percent(simulation.probabilityB3)}%</span> : null}
              {simulation.probabilityRecord !== null ? (
                <span>рекорд — {percent(simulation.probabilityRecord)}%</span>
              ) : null}
            </div>
          </div>
        ) : null}

        {attach && attach.observedRate !== null ? (
          <div>
            <div>
              Допродажи: <span className="font-semibold text-foreground">{percent(attach.observedRate)}%</span> чеков с
              двумя и более позициями.
            </div>
            {attach.probabilityAboveBaseline > 0 ? (
              <div className="text-muted-foreground">
                {attach.probabilityAboveBaseline >= 0.85
                  ? `Вероятность, что продавец действительно работает лучше нормы, — ${percent(attach.probabilityAboveBaseline)}%.`
                  : attach.probabilityAboveBaseline <= 0.15
                    ? `Вероятность, что он действительно слабее нормы, — ${percent(attach.probabilityBelowBaseline)}%.`
                    : `Отличить от нормы нельзя: за смену было всего ${attach.opportunities} чеков, на таком объёме разница ещё не значит ничего.`}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="text-[11px] text-muted-foreground">
          Это прогноз, посчитанный до смены. На балл продавца и на план он не влияет.
        </div>
      </div>
    </Block>
  )
}

/**
 * Вероятностный прогноз в том виде, в каком он нужен экрану.
 *
 * Отдельный тип, а не импорт серверного: страница не должна тянуть за собой
 * серверный модуль ради формы объекта.
 */
export type ShiftProbabilityView = {
  demand: {
    expectedReceipts: number
    interval80: { low: number; high: number }
  } | null
  fact_percentile: number | null
  attach: {
    observedRate: number | null
    opportunities: number
    probabilityAboveBaseline: number
    probabilityBelowBaseline: number
  } | null
  simulation: {
    medianRevenue: number
    interval80: { low: number; high: number }
    probabilityB1: number | null
    probabilityB2: number | null
    probabilityB3: number | null
    probabilityRecord: number | null
  } | null
}

export function ShiftDetail(props: {
  companyId: string
  date: string
  shift: 'day' | 'night'
  explanation: ShiftExplanation | null
  context?: ShiftContext | null
  probability?: ShiftProbabilityView | null
  canAskAi: boolean
}) {
  const [ai, setAi] = useState<AiResult | null>(null)
  const [aiError, setAiError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const explanation = props.explanation

  async function askAi() {
    setLoading(true)
    setAiError(null)
    try {
      const res = await fetch('/api/admin/sales-kpi/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: props.companyId, date: props.date, shift: props.shift }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
      if (json?.data?.ai) setAi(json.data.ai as AiResult)
      if (json?.data?.ai_error) setAiError(String(json.data.ai_error))
    } catch (e) {
      setAiError(e instanceof Error ? e.message : 'Не удалось получить разбор')
    } finally {
      setLoading(false)
    }
  }

  if (!explanation) {
    return <div className="text-xs text-muted-foreground">Разбор недоступен.</div>
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Что произошло */}
        <div className="space-y-3">
          <div className="text-sm font-semibold text-foreground">{explanation.headline}</div>
          {explanation.paragraphs.map((p) => (
            <p key={p.slice(0, 40)} className="text-xs leading-relaxed text-body">
              {p}
            </p>
          ))}

          <Block title="Что это значит">
            <p className="text-xs leading-relaxed text-body">{explanation.conclusion}</p>
          </Block>

          {props.probability ? <ForecastBlock probability={props.probability} /> : null}

          {props.context ? <ContextBlock context={props.context} /> : null}

          <Block title="Что делать">
            <p className="text-xs leading-relaxed text-body">{explanation.action}</p>
          </Block>

          {explanation.caveats.length > 0 ? (
            <Block title="Где выводу нельзя доверять">
              <ul className="space-y-1 text-xs text-muted-foreground">
                {explanation.caveats.map((c) => (
                  <li key={c}>• {c}</li>
                ))}
              </ul>
            </Block>
          ) : null}
        </div>

        {/* Метрики с прочтением */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Что видно по работе с покупателем
          </div>
          {explanation.metrics.map((m) => (
            <div
              key={m.metric}
              className="rounded-lg border border-border p-2.5"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-foreground">{m.label}</span>
                <span className={`text-xs tabular-nums ${deltaTone(m.delta_pct)}`}>
                  {m.delta_pct == null ? '—' : `${m.delta_pct > 0 ? '+' : ''}${m.delta_pct}%`}
                </span>
              </div>
              <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                было {formatMetric(m.metric, m.actual)} · обычно бывает{' '}
                {formatMetric(m.metric, m.expected)}
                {m.sample > 0 ? ` · по ${m.sample} похожим сменам` : ''}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-body">{m.reading}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ИИ поверх готового разбора */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <Bot className="h-4 w-4" /> Разбор от ИИ
          </div>
          {props.canAskAi && !ai ? (
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void askAi()}>
              {loading ? (
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1 h-3.5 w-3.5" />
              )}
              Объяснить словами
            </Button>
          ) : null}
        </div>

        {!ai && !loading && !aiError ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Модель не считает цифры — она объясняет уже посчитанное. Разбор выше от неё не зависит.
          </p>
        ) : null}

        {aiError ? (
          <div className="mt-2 flex gap-2 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>ИИ не ответил: {aiError}. Разбор выше от этого не меняется.</span>
          </div>
        ) : null}

        {ai ? (
          <div className="mt-3 space-y-3">
            {[
              ['Коротко', ai.summary],
              ['Поток', ai.traffic],
              ['Магазин', ai.store],
              ['Продавец', ai.cashier],
              ['Вывод', ai.conclusion],
              ['Рекомендация', ai.recommendation],
            ]
              .filter(([, text]) => Boolean(text))
              .map(([title, text]) => (
                <Block key={title as string} title={title as string}>
                  <p className="text-xs leading-relaxed text-body">{text as string}</p>
                </Block>
              ))}

            {ai.uncertainties.length > 0 ? (
              <Block title="Оговорки">
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {ai.uncertainties.map((u) => (
                    <li key={u}>• {u}</li>
                  ))}
                </ul>
              </Block>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}
