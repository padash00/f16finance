'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { AssistantPanel } from '@/components/ai/assistant-panel'
import { Card } from '@/components/ui/card'
import { useCapabilities } from '@/lib/client/use-capabilities'
import type { PageSnapshot } from '@/lib/ai/types'
import {
  BrainCircuit,
  BarChart2,
  CalendarDays,
  Loader2,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

// ================== HELPERS ==================
const fmtMoney = (v: number) => {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + ' млн ₸'
  if (abs >= 1_000) return sign + (abs / 1_000).toFixed(0) + ' тыс ₸'
  return v.toLocaleString('ru-RU') + ' ₸'
}
const fmtCompact = (v: number) => {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'M'
  if (abs >= 1_000) return (v / 1_000).toFixed(0) + 'k'
  return String(Math.round(v))
}

// ================== TYPES ==================
type ProjectedShape = {
  week4Income: number
  week8Income: number
  week13Income: number
  week4Expense: number
  week8Expense: number
  week13Expense: number
  month0Label?: string
  month0Income?: number
  month0Expense?: number
  month0Fact?: { income: number; expense: number }
  month0RemainingDays?: number
  month1Label?: string
  month1Income?: number
  month1Expense?: number
  month1Days?: number
  month2Label?: string
  month2Income?: number
  month2Expense?: number
  month2Days?: number
}

type ForecastResult = {
  text: string
  dateFrom: string
  dateTo: string
  weeklyIncome: number[]
  weeklyExpense: number[]
  weekLabels: string[]
  projected: ProjectedShape
  avgWeeklyIncome: number
  avgWeeklyExpense: number
  scenarios?: {
    pessimistic: ProjectedShape
    realistic: ProjectedShape
    optimistic: ProjectedShape
  }
  // ─── Новое в умной версии ───
  comparison?: {
    last30: { income: number; expense: number; profit: number; margin: number }
    prev30: { income: number; expense: number; profit: number; margin: number }
    prevPrev30: { income: number; expense: number }
    momentum: { income: number; expense: number; profit: number }
  }
  categories?: Array<{
    category: string
    total: number
    count: number
    recent: number
    older: number
    share: number
  }>
  outliers?: Array<{
    date: string
    category: string
    amount: number
    comment: string | null
  }>
  seasonality?: {
    byDay: Array<{ name: string; avg: number }>
    best: { name: string; avg: number }
    worst: { name: string; avg: number }
  }
  kpi?: {
    plan: number
    actual: number
    progress: number
  } | null
}
type CompanyOption = {
  id: string
  name: string
  code?: string | null
}

function parseSseEvent(raw: string) {
  const event = raw
    .split('\n')
    .find((line) => line.startsWith('event:'))
    ?.slice(6)
    .trim() || 'message'
  const data = raw
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n')
  return { event, data: data ? JSON.parse(data) : null }
}

// ================== TOOLTIP ==================
function ForecastTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-xl p-3 text-xs shadow-xl">
      <p className="text-gray-400 mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-semibold text-white">{fmtMoney(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ================== PAGE ==================
export default function ForecastPage() {
  const [result, setResult] = useState<ForecastResult | null>(null)
  const [companies, setCompanies] = useState<CompanyOption[]>([])
  const [companyId, setCompanyId] = useState<string>('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scenario, setScenario] = useState<'pessimistic' | 'realistic' | 'optimistic'>('realistic')
  const abortRef = useRef<AbortController | null>(null)
  const { can } = useCapabilities()

  useEffect(() => {
    let mounted = true
    const loadCompanies = async () => {
      try {
        const res = await fetch('/api/admin/companies', { cache: 'no-store' })
        const data = await res.json().catch(() => null)
        if (!mounted) return
        if (res.ok && Array.isArray(data?.data)) setCompanies(data.data as CompanyOption[])
      } catch {
        if (mounted) setCompanies([])
      }
    }
    loadCompanies()
    return () => {
      mounted = false
    }
  }, [])

  const activeProjected = useMemo(
    () => result ? (result.scenarios?.[scenario] ?? result.projected) : null,
    [result, scenario],
  )

  const handleGenerate = async () => {
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const payload = companyId !== 'all' ? { company_id: companyId, stream: true } : { stream: true }
      const res = await fetch('/api/ai/forecast', {
        method: 'POST',
        signal: ac.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Ошибка генерации прогноза')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() || ''
        for (const rawEvent of events) {
          if (!rawEvent.trim()) continue
          const { event, data } = parseSseEvent(rawEvent)
          if (event === 'meta') {
            setResult({ ...(data as Omit<ForecastResult, 'text'>), text: '' })
          }
          if (event === 'delta') {
            setResult((current) => current ? { ...current, text: current.text + String(data?.text || '') } : current)
          }
          if (event === 'error') {
            throw new Error(String(data?.error || 'Ошибка генерации прогноза'))
          }
        }
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      if (abortRef.current === ac) abortRef.current = null
      setLoading(false)
    }
  }

  const handleCancel = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoading(false)
  }

  // Build chart data: historical weeks + projected weeks
  const chartData = result
    ? [
        ...result.weeklyIncome.map((income, i) => ({
          label: `Нед.${i + 1}`,
          income,
          expense: result.weeklyExpense[i],
          profit: income - result.weeklyExpense[i],
          type: 'historical' as const,
        })),
        {
          label: '+30д',
          income: result.projected.week4Income / 4,
          expense: result.projected.week4Expense / 4,
          profit: (result.projected.week4Income - result.projected.week4Expense) / 4,
          type: 'projected' as const,
        },
        {
          label: '+60д',
          income: result.projected.week8Income / 8,
          expense: result.projected.week8Expense / 8,
          profit: (result.projected.week8Income - result.projected.week8Expense) / 8,
          type: 'projected' as const,
        },
        {
          label: '+90д',
          income: result.projected.week13Income / 13,
          expense: result.projected.week13Expense / 13,
          profit: (result.projected.week13Income - result.projected.week13Expense) / 13,
          type: 'projected' as const,
        },
      ]
    : []

  const snapshot: PageSnapshot | null = result
    ? {
        page: 'forecast',
        title: 'AI Прогноз',
        generatedAt: new Date().toISOString(),
        route: '/forecast',
        period: { from: result.dateFrom, to: result.dateTo },
        summary: [
          `Исторические данные: ${result.dateFrom} — ${result.dateTo}`,
          `Средняя выручка в неделю: ${fmtMoney(result.avgWeeklyIncome)}`,
          `Прогноз 30 дней: ${fmtMoney(result.projected.week4Income)}`,
          `Прогноз 60 дней: ${fmtMoney(result.projected.week8Income)}`,
          `Прогноз 90 дней: ${fmtMoney(result.projected.week13Income)}`,
        ],
        sections: [
          {
            title: 'Прогнозируемые показатели',
            metrics: [
              { label: 'Выручка 30д', value: fmtMoney(result.projected.week4Income) },
              { label: 'Выручка 60д', value: fmtMoney(result.projected.week8Income) },
              { label: 'Выручка 90д', value: fmtMoney(result.projected.week13Income) },
              { label: 'Прибыль 30д', value: fmtMoney(result.projected.week4Income - result.projected.week4Expense) },
              { label: 'Прибыль 60д', value: fmtMoney(result.projected.week8Income - result.projected.week8Expense) },
              { label: 'Прибыль 90д', value: fmtMoney(result.projected.week13Income - result.projected.week13Expense) },
            ],
          },
        ],
      }
    : null

  const suggestedPrompts = [
    'Какой главный риск для прогноза?',
    'Что нужно сделать чтобы ускорить рост?',
    'Какой прогноз по прибыли реалистичен?',
    'Как сравнить прогноз с планом KPI?',
  ]

  return (
    <>
        <div className="app-page-wide space-y-6">

          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-purple-900/30 via-gray-900 to-indigo-900/30 p-6 border border-purple-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-purple-600 rounded-full blur-3xl opacity-10 pointer-events-none" />
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-purple-500/20 rounded-xl">
                  <BrainCircuit className="w-8 h-8 text-purple-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    AI Прогноз
                  </h1>
                  <p className="text-sm text-gray-400">Прогноз на текущий и следующие 2 месяца</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <select
                  value={companyId}
                  onChange={(e) => setCompanyId(e.target.value)}
                  className="px-3 py-2 bg-gray-800/80 border border-gray-700 rounded-xl text-sm text-gray-200 min-w-[210px]"
                >
                  <option value="all">Все компании</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {can('forecast.generate') && (
                  <button
                    onClick={handleGenerate}
                    disabled={loading}
                    className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-60 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-xl transition-colors"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Анализирую...
                      </>
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        {result ? 'Обновить прогноз' : 'Сгенерировать прогноз'}
                      </>
                    )}
                  </button>
                )}
                {loading && can('forecast.cancel_generation') ? (
                  <button
                    onClick={handleCancel}
                    className="px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 text-sm text-gray-200 hover:bg-white/10"
                  >
                    Отменить
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">
              {error}
            </div>
          )}

          {/* Empty state */}
          {!result && !loading && !error && (
            <Card className="p-12 bg-gray-900/80 border-gray-800 text-center">
              <BrainCircuit className="w-12 h-12 text-purple-500/40 mx-auto mb-4" />
              <p className="text-gray-400 text-sm mb-2">
                Нажмите «Сгенерировать прогноз» для анализа данных за последние 90 дней
              </p>
              <p className="text-gray-600 text-xs">ИИ проанализирует тренды и даст прогноз на 30, 60 и 90 дней вперёд</p>
            </Card>
          )}

          {/* Loading state */}
          {loading && !result && (
            <Card className="p-8 bg-gray-900/80 border-purple-500/20">
              <div className="flex items-center gap-3 mb-4">
                <Loader2 className="w-5 h-5 text-purple-400 animate-spin" />
                <span className="text-sm text-gray-300 font-medium">ИИ анализирует 90 дней данных...</span>
              </div>
              <div className="space-y-2.5">
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-3/4" />
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-full" />
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-5/6" />
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-2/3" />
                <div className="h-3 bg-gray-800 rounded-full animate-pulse w-4/5" />
              </div>
            </Card>
          )}

          {result && (
            <>
              {/* Empty state — у точки нет данных за период */}
              {result.weeklyIncome.every((v) => v === 0) && result.weeklyExpense.every((v) => v === 0) && (
                <Card className="p-8 bg-gray-900/80 border-amber-500/20 text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-500/10 mb-3">
                    <BarChart2 className="w-6 h-6 text-amber-400" />
                  </div>
                  <h3 className="text-lg font-semibold text-white mb-2">Нет данных за последние 90 дней</h3>
                  <p className="text-sm text-gray-400 max-w-md mx-auto">
                    {companyId !== 'all'
                      ? 'У выбранной точки нет операций за этот период. Попробуй выбрать другую точку или добавь несколько доходов/расходов.'
                      : 'В системе пока нет операций. Добавь несколько доходов и расходов, чтобы AI мог построить прогноз.'}
                  </p>
                </Card>
              )}

              {/* Scenario selector */}
              {result?.scenarios && (
                <div className="flex items-center gap-2 p-1 bg-gray-900/80 border border-gray-700 rounded-xl w-fit">
                  {(['pessimistic', 'realistic', 'optimistic'] as const).map((s) => (
                    <button
                      key={s}
                      onClick={() => setScenario(s)}
                      className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                        scenario === s
                          ? s === 'pessimistic' ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                            : s === 'optimistic' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                          : 'text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {s === 'pessimistic' ? <><TrendingDown className="w-3 h-3 mr-1 inline" />Пессимизм</> : s === 'realistic' ? <><BarChart2 className="w-3 h-3 mr-1 inline" />Реализм</> : <><TrendingUp className="w-3 h-3 mr-1 inline" />Оптимизм</>}
                    </button>
                  ))}
                </div>
              )}

              {/* Forecast cards: календарные месяцы */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(() => {
                  const proj = activeProjected ?? result.projected
                  // Если есть month0/1/2 (новый API) — используем календарные месяцы.
                  // Иначе fallback на 30/60/90 дней (старый формат).
                  if (proj.month0Label && proj.month1Label && proj.month2Label) {
                    return [
                      {
                        label: proj.month0Label,
                        sublabel: proj.month0RemainingDays
                          ? `факт + прогноз на ${proj.month0RemainingDays} дн.`
                          : 'этот месяц',
                        income: proj.month0Income ?? 0,
                        expense: proj.month0Expense ?? 0,
                        fact: proj.month0Fact,
                        color: 'blue',
                      },
                      {
                        label: proj.month1Label,
                        sublabel: proj.month1Days ? `${proj.month1Days} дн.` : 'следующий месяц',
                        income: proj.month1Income ?? 0,
                        expense: proj.month1Expense ?? 0,
                        color: 'purple',
                      },
                      {
                        label: proj.month2Label,
                        sublabel: proj.month2Days ? `${proj.month2Days} дн.` : 'через месяц',
                        income: proj.month2Income ?? 0,
                        expense: proj.month2Expense ?? 0,
                        color: 'indigo',
                      },
                    ]
                  }
                  // Старый формат (на случай если API ещё не задеплоен)
                  return [
                    { label: '30 дней', sublabel: 'прогноз', income: proj.week4Income, expense: proj.week4Expense, color: 'blue' },
                    { label: '60 дней', sublabel: 'прогноз', income: proj.week8Income, expense: proj.week8Expense, color: 'purple' },
                    { label: '90 дней', sublabel: 'прогноз', income: proj.week13Income, expense: proj.week13Expense, color: 'indigo' },
                  ]
                })().map(({ label, sublabel, income, expense, fact }: any) => {
                  const profit = income - expense
                  return (
                    <Card key={label} className="p-5 bg-gray-900/80 border-gray-700">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-sm text-white font-semibold capitalize">{label}</p>
                          {sublabel && <p className="text-[10px] text-gray-500 mt-0.5">{sublabel}</p>}
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 border border-purple-500/20">AI</span>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs text-gray-400">
                            <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                            Выручка
                          </div>
                          <span className="text-sm font-bold text-emerald-400">{fmtMoney(income)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs text-gray-400">
                            <TrendingDown className="w-3.5 h-3.5 text-red-400" />
                            Расходы
                          </div>
                          <span className="text-sm font-bold text-red-400">{fmtMoney(expense)}</span>
                        </div>
                        <div className="border-t border-gray-800 pt-2 flex items-center justify-between">
                          <div className="flex items-center gap-1.5 text-xs text-gray-400">
                            <Wallet className="w-3.5 h-3.5 text-blue-400" />
                            Прибыль
                          </div>
                          <span className={`text-base font-bold ${profit >= 0 ? 'text-blue-400' : 'text-red-400'}`}>
                            {profit >= 0 ? '+' : ''}{fmtMoney(profit)}
                          </span>
                        </div>
                        {fact && (fact.income > 0 || fact.expense > 0) && (
                          <div className="border-t border-gray-800 pt-2 mt-1">
                            <p className="text-[10px] text-gray-500 mb-1">Уже факт:</p>
                            <div className="flex items-center justify-between text-xs">
                              <span className="text-emerald-400/70">{fmtMoney(fact.income)}</span>
                              <span className="text-red-400/70">−{fmtMoney(fact.expense)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </Card>
                  )
                })}
              </div>

              {/* ─── Сравнение периодов (умная аналитика) ─── */}
              {result.comparison && (
                <Card className="p-5 bg-gray-900/80 border-gray-800">
                  <h2 className="text-sm font-semibold text-white mb-1">📊 Что изменилось за месяц</h2>
                  <p className="text-xs text-gray-500 mb-4">Последние 30 дней vs предыдущие 30 дней</p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {[
                      { label: 'Выручка', value: result.comparison.last30.income, prev: result.comparison.prev30.income, momentum: result.comparison.momentum.income, color: 'emerald' },
                      { label: 'Расходы', value: result.comparison.last30.expense, prev: result.comparison.prev30.expense, momentum: result.comparison.momentum.expense, color: 'red', invert: true },
                      { label: 'Прибыль', value: result.comparison.last30.profit, prev: result.comparison.prev30.profit, momentum: result.comparison.momentum.profit, color: 'blue' },
                    ].map((m) => {
                      const pos = m.invert ? m.momentum < 0 : m.momentum >= 0
                      return (
                        <div key={m.label} className="rounded-xl border border-gray-800 bg-gray-900/50 p-4">
                          <p className="text-xs text-gray-400 uppercase tracking-wide mb-2">{m.label}</p>
                          <p className={`text-2xl font-bold text-${m.color}-400 mb-1`}>{fmtMoney(m.value)}</p>
                          <div className="flex items-center gap-2 text-xs">
                            <span className={pos ? 'text-emerald-400' : 'text-red-400'}>
                              {m.momentum > 0 ? '↑' : m.momentum < 0 ? '↓' : '→'} {Math.abs(m.momentum).toFixed(1)}%
                            </span>
                            <span className="text-gray-500">vs пред. 30д ({fmtMoney(m.prev)})</span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-3 text-xs text-gray-400">
                    <span>Маржа:</span>
                    <span className="font-semibold text-white">{result.comparison.last30.margin.toFixed(1)}%</span>
                    <span className="text-gray-500">(было {result.comparison.prev30.margin.toFixed(1)}%)</span>
                  </div>
                </Card>
              )}

              {/* ─── Топ категорий расходов с трендами ─── */}
              {result.categories && result.categories.length > 0 && (
                <Card className="p-5 bg-gray-900/80 border-gray-800">
                  <h2 className="text-sm font-semibold text-white mb-1">💰 Топ категорий расходов</h2>
                  <p className="text-xs text-gray-500 mb-4">Тренд: последние 30 дней vs предыдущие 30 дней</p>
                  <div className="space-y-2">
                    {result.categories.map((c) => {
                      const trend = c.older > 0 ? ((c.recent - c.older) / c.older) * 100 : 0
                      const arrowColor = Math.abs(trend) < 10 ? 'text-gray-400' : trend > 0 ? 'text-red-400' : 'text-emerald-400'
                      const barWidth = Math.min(100, c.share)
                      return (
                        <div key={c.category} className="space-y-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-white font-medium truncate">{c.category}</span>
                            <span className="font-bold text-white whitespace-nowrap ml-2">{fmtMoney(c.total)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-gray-800 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-purple-500 to-fuchsia-500"
                                style={{ width: `${barWidth}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 w-12 text-right">{c.share.toFixed(0)}%</span>
                            <span className={`text-xs font-medium w-16 text-right ${arrowColor}`}>
                              {Math.abs(trend) < 10 ? '→' : trend > 0 ? '↑' : '↓'}
                              {' '}{trend > 0 ? '+' : ''}{trend.toFixed(0)}%
                            </span>
                          </div>
                          <p className="text-xs text-gray-500">{c.count} операций</p>
                        </div>
                      )
                    })}
                  </div>
                </Card>
              )}

              {/* ─── Сезонность по дням недели ─── */}
              {result.seasonality && result.seasonality.byDay.some((d) => d.avg > 0) && (
                <Card className="p-5 bg-gray-900/80 border-gray-800">
                  <h2 className="text-sm font-semibold text-white mb-1">📅 Сезонность по дням недели</h2>
                  <p className="text-xs text-gray-500 mb-4">Средняя выручка в каждый день недели</p>
                  <div className="grid grid-cols-7 gap-2">
                    {[1, 2, 3, 4, 5, 6, 0].map((dayIdx) => {
                      const day = result.seasonality!.byDay[dayIdx]
                      if (!day) return null
                      const max = Math.max(...result.seasonality!.byDay.map((d) => d.avg), 1)
                      const heightPct = (day.avg / max) * 100
                      const isBest = day.name === result.seasonality!.best?.name
                      const isWorst = day.name === result.seasonality!.worst?.name && day.avg > 0
                      return (
                        <div key={day.name} className="text-center">
                          <div className="h-24 flex items-end mb-2">
                            <div
                              className={`w-full rounded-t transition-all ${
                                isBest ? 'bg-gradient-to-t from-emerald-500 to-emerald-300'
                                  : isWorst ? 'bg-gradient-to-t from-red-500 to-red-300'
                                  : 'bg-gradient-to-t from-purple-500/80 to-fuchsia-400/80'
                              }`}
                              style={{ height: `${Math.max(5, heightPct)}%` }}
                              title={fmtMoney(day.avg)}
                            />
                          </div>
                          <p className={`text-xs font-medium ${isBest ? 'text-emerald-400' : isWorst ? 'text-red-400' : 'text-gray-400'}`}>
                            {day.name}
                          </p>
                          <p className="text-[10px] text-gray-500">{fmtMoney(day.avg)}</p>
                        </div>
                      )
                    })}
                  </div>
                  <div className="mt-3 pt-3 border-t border-gray-800 flex items-center gap-4 text-xs">
                    <span className="text-emerald-400">★ Лучший: {result.seasonality.best?.name}</span>
                    <span className="text-red-400">▼ Худший: {result.seasonality.worst?.name}</span>
                  </div>
                </Card>
              )}

              {/* ─── Выбросы (нерегулярные крупные расходы) ─── */}
              {result.outliers && result.outliers.length > 0 && (
                <Card className="p-5 bg-gray-900/80 border-gray-800">
                  <h2 className="text-sm font-semibold text-white mb-1">⚡ Крупные нерегулярные расходы</h2>
                  <p className="text-xs text-gray-500 mb-4">Выше median + 2σ — обычно одноразовые траты, не повторятся</p>
                  <div className="space-y-2">
                    {result.outliers.map((o, i) => (
                      <div key={`${o.date}-${i}`} className="flex items-center gap-3 p-3 bg-gray-900/50 rounded-lg border border-gray-800">
                        <div className="w-1 h-10 bg-amber-500 rounded-full" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-white truncate">{o.category}</p>
                          <p className="text-xs text-gray-500">{o.date}{o.comment ? ` · ${o.comment}` : ''}</p>
                        </div>
                        <span className="text-sm font-bold text-amber-400 whitespace-nowrap">{fmtMoney(o.amount)}</span>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* ─── KPI план vs факт (если есть план) ─── */}
              {result.kpi && (
                <Card className="p-5 bg-gray-900/80 border-gray-800">
                  <h2 className="text-sm font-semibold text-white mb-1">🎯 KPI план на месяц</h2>
                  <div className="flex items-baseline gap-3 mb-3">
                    <span className="text-2xl font-bold text-white">{fmtMoney(result.kpi.actual)}</span>
                    <span className="text-sm text-gray-400">из {fmtMoney(result.kpi.plan)}</span>
                    <span className={`text-sm font-bold ${result.kpi.progress >= 80 ? 'text-emerald-400' : result.kpi.progress >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                      {result.kpi.progress.toFixed(0)}%
                    </span>
                  </div>
                  <div className="h-3 bg-gray-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all ${result.kpi.progress >= 80 ? 'bg-gradient-to-r from-emerald-500 to-teal-500' : result.kpi.progress >= 50 ? 'bg-gradient-to-r from-amber-500 to-orange-500' : 'bg-gradient-to-r from-red-500 to-rose-500'}`}
                      style={{ width: `${Math.min(100, result.kpi.progress)}%` }}
                    />
                  </div>
                </Card>
              )}

              {/* Chart */}
              <Card className="p-5 bg-gray-900/80 border-gray-800">
                <h2 className="text-sm font-semibold text-white mb-1">История + Прогноз</h2>
                <p className="text-xs text-gray-500 mb-4">
                  Первые 13 столбцов — исторические данные по неделям. Последние 3 (+30д, +60д, +90д) — прогнозируемые средние значения.
                </p>
                <ResponsiveContainer width="100%" height={300}>
                  <ComposedChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                    <XAxis
                      dataKey="label"
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: '#6b7280', fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={fmtCompact}
                    />
                    <Tooltip content={<ForecastTooltip />} />
                    <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af', paddingTop: 8 }} />
                    <Bar dataKey="income" name="Выручка" fill="#10b981" opacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={24} />
                    <Bar dataKey="expense" name="Расходы" fill="#ef4444" opacity={0.7} radius={[2, 2, 0, 0]} maxBarSize={24} />
                    <Line
                      dataKey="profit"
                      name="Прибыль"
                      type="monotone"
                      stroke="#a855f7"
                      strokeWidth={2}
                      dot={false}
                      activeDot={{ r: 4, fill: '#a855f7' }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </Card>

              {/* AI Narrative */}
              <Card className="p-5 bg-gray-900/80 border-purple-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <div className="p-1.5 bg-purple-500/20 rounded-lg">
                    <Sparkles className="w-4 h-4 text-purple-400" />
                  </div>
                  <h2 className="text-sm font-semibold text-white">AI-анализ и прогноз</h2>
                  {loading ? <span className="text-xs text-purple-300">печатает...</span> : null}
                  <span className="text-xs text-gray-500 ml-auto">{result.dateFrom} — {result.dateTo}</span>
                </div>
                <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                  {result.text}
                </div>
              </Card>

              {/* AI Chat */}
              {snapshot && (
                <AssistantPanel
                  page="forecast"
                  title="AI Ассистент — Прогноз"
                  subtitle="Задайте вопрос по прогнозу"
                  snapshot={snapshot}
                  suggestedPrompts={suggestedPrompts}
                />
              )}
            </>
          )}

        </div>
    </>
  )
}
