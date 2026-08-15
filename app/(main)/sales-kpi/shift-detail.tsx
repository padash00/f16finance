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
import { AlertTriangle, Bot, Loader2, Sparkles } from 'lucide-react'

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
  if (delta == null) return 'text-slate-400 dark:text-slate-500'
  if (delta >= 5) return 'text-emerald-600 dark:text-emerald-400'
  if (delta <= -5) return 'text-amber-600 dark:text-amber-400'
  return 'text-slate-600 dark:text-slate-300'
}

function Block(props: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {props.title}
      </div>
      {props.children}
    </div>
  )
}

export function ShiftDetail(props: {
  companyId: string
  date: string
  shift: 'day' | 'night'
  explanation: ShiftExplanation | null
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
    return <div className="text-xs text-slate-500 dark:text-slate-400">Разбор недоступен.</div>
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-2">
        {/* Что произошло */}
        <div className="space-y-3">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{explanation.headline}</div>
          {explanation.paragraphs.map((p) => (
            <p key={p.slice(0, 40)} className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {p}
            </p>
          ))}

          <Block title="Что это значит">
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">{explanation.conclusion}</p>
          </Block>

          <Block title="Что делать">
            <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">{explanation.action}</p>
          </Block>

          {explanation.caveats.length > 0 ? (
            <Block title="Где выводу нельзя доверять">
              <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
                {explanation.caveats.map((c) => (
                  <li key={c}>• {c}</li>
                ))}
              </ul>
            </Block>
          ) : null}
        </div>

        {/* Метрики с прочтением */}
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Что видно по работе с покупателем
          </div>
          {explanation.metrics.map((m) => (
            <div
              key={m.metric}
              className="rounded-lg border border-slate-200 p-2.5 dark:border-white/10"
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-xs font-medium text-slate-900 dark:text-white">{m.label}</span>
                <span className={`text-xs tabular-nums ${deltaTone(m.delta_pct)}`}>
                  {m.delta_pct == null ? '—' : `${m.delta_pct > 0 ? '+' : ''}${m.delta_pct}%`}
                </span>
              </div>
              <div className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-slate-400">
                было {formatMetric(m.metric, m.actual)} · обычно бывает{' '}
                {formatMetric(m.metric, m.expected)}
                {m.sample > 0 ? ` · по ${m.sample} похожим сменам` : ''}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-300">{m.reading}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ИИ поверх готового разбора */}
      <div className="rounded-lg border border-slate-200 p-3 dark:border-white/10">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
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
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
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
                  <p className="text-xs leading-relaxed text-slate-700 dark:text-slate-200">{text as string}</p>
                </Block>
              ))}

            {ai.uncertainties.length > 0 ? (
              <Block title="Оговорки">
                <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
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
