'use client'

import { useMemo, useState } from 'react'

import { AssistantPanel } from '@/components/ai/assistant-panel'
import { Card } from '@/components/ui/card'
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
type ForecastResult = {
  text: string
  dateFrom: string
  dateTo: string
  weeklyIncome: number[]
  weeklyExpense: number[]
  weekLabels: string[]
  projected: {
    week4Income: number
    week8Income: number
    week13Income: number
    week4Expense: number
    week8Expense: number
    week13Expense: number
  }
  avgWeeklyIncome: number
  avgWeeklyExpense: number
  scenarios?: {
    pessimistic: {
      week4Income: number; week8Income: number; week13Income: number
      week4Expense: number; week8Expense: number; week13Expense: number
    }
    realistic: {
      week4Income: number; week8Income: number; week13Income: number
      week4Expense: number; week8Expense: number; week13Expense: number
    }
    optimistic: {
      week4Income: number; week8Income: number; week13Income: number
      week4Expense: number; week8Expense: number; week13Expense: number
    }
  }
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scenario, setScenario] = useState<'pessimistic' | 'realistic' | 'optimistic'>('realistic')

  const activeProjected = useMemo(
    () => result ? (result.scenarios?.[scenario] ?? result.projected) : null,
    [result, scenario],
  )

  const handleGenerate = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/ai/forecast', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Ошибка генерации прогноза')
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
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
        <div className="app-page max-w-7xl space-y-6">

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
                  <p className="text-sm text-gray-400">Прогноз доходов, расходов и прибыли на 30/60/90 дней</p>
                </div>
              </div>

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
          {loading && (
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

              {/* Forecast cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {(() => {
                  const proj = activeProjected ?? result.projected
                  return [
                    {
                      label: '30 дней',
                      icon: CalendarDays,
                      income: proj.week4Income,
                      expense: proj.week4Expense,
                      color: 'blue',
                    },
                    {
                      label: '60 дней',
                      icon: CalendarDays,
                      income: proj.week8Income,
                      expense: proj.week8Expense,
                      color: 'purple',
                    },
                    {
                      label: '90 дней',
                      icon: CalendarDays,
                      income: proj.week13Income,
                      expense: proj.week13Expense,
                      color: 'indigo',
                    },
                  ]
                })().map(({ label, income, expense }) => {
                  const profit = income - expense
                  return (
                    <Card key={label} className="p-5 bg-gray-900/80 border-gray-700">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Прогноз — {label}</p>
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
                      </div>
                    </Card>
                  )
                })}
              </div>

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
