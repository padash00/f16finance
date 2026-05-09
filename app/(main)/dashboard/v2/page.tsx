'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useCashlessLabels } from '@/lib/client/use-cashless-labels'
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  AreaChart,
} from 'recharts'
import {
  Sparkles,
  TrendingUp,
  TrendingDown,
  Wallet,
  ArrowDownCircle,
  ArrowUpCircle,
  Calculator,
  RefreshCw,
  HelpCircle,
  X,
} from 'lucide-react'

type IncomeRow = {
  date: string
  cash_amount: number | null
  kaspi_amount: number | null
  card_amount: number | null
  online_amount: number | null
}

type ExpenseRow = {
  date: string
  cash_amount: number | null
  kaspi_amount: number | null
}

type Range = 'today' | 'week' | 'month'

type Totals = {
  income: number
  expense: number
  profit: number
  avgCheck: number
  txCount: number
}

const fmtMoney = (v: number) =>
  v.toLocaleString('ru-RU', { maximumFractionDigits: 0 }) + ' ₸'

const fmtDate = (d: Date) => d.toISOString().slice(0, 10)

const ru = (date: string) => {
  const d = new Date(date + 'T00:00:00')
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

function getPeriod(range: Range) {
  const now = new Date()
  const to = fmtDate(now)
  let days = 30
  if (range === 'today') days = 1
  else if (range === 'week') days = 7
  else if (range === 'month') days = 30

  const fromDate = new Date(now)
  fromDate.setDate(fromDate.getDate() - (days - 1))
  const from = fmtDate(fromDate)

  const prevTo = new Date(fromDate)
  prevTo.setDate(prevTo.getDate() - 1)
  const prevToStr = fmtDate(prevTo)
  const prevFrom = new Date(prevTo)
  prevFrom.setDate(prevFrom.getDate() - (days - 1))
  const prevFromStr = fmtDate(prevFrom)

  return { from, to, prevFrom: prevFromStr, prevTo: prevToStr, days }
}

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { cache: 'no-store' })
  const j = await r.json().catch(() => null)
  if (!r.ok) throw new Error(j?.error || `HTTP ${r.status}`)
  return j as T
}

function sumIncome(rows: IncomeRow[]) {
  return rows.reduce(
    (s, r) =>
      s +
      (r.cash_amount || 0) +
      (r.kaspi_amount || 0) +
      (r.card_amount || 0) +
      (r.online_amount || 0),
    0,
  )
}

function sumExpense(rows: ExpenseRow[]) {
  return rows.reduce(
    (s, r) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0),
    0,
  )
}

function computeTotals(incomes: IncomeRow[], expenses: ExpenseRow[]): Totals {
  const income = sumIncome(incomes)
  const expense = sumExpense(expenses)
  const txCount = incomes.length
  return {
    income,
    expense,
    profit: income - expense,
    avgCheck: txCount ? Math.round(income / txCount) : 0,
    txCount,
  }
}

function delta(current: number, prev: number): number {
  if (prev === 0) return current === 0 ? 0 : 100
  return Math.round(((current - prev) / Math.abs(prev)) * 100)
}

function buildSeries(
  incomes: IncomeRow[],
  expenses: ExpenseRow[],
  from: string,
  to: string,
) {
  const days: Record<string, { income: number; expense: number }> = {}
  const start = new Date(from + 'T00:00:00')
  const end = new Date(to + 'T00:00:00')
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days[fmtDate(d)] = { income: 0, expense: 0 }
  }
  for (const r of incomes) {
    if (!days[r.date]) continue
    days[r.date].income +=
      (r.cash_amount || 0) +
      (r.kaspi_amount || 0) +
      (r.card_amount || 0) +
      (r.online_amount || 0)
  }
  for (const r of expenses) {
    if (!days[r.date]) continue
    days[r.date].expense += (r.cash_amount || 0) + (r.kaspi_amount || 0)
  }
  return Object.entries(days)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({
      date,
      label: ru(date),
      income: v.income,
      expense: v.expense,
      profit: v.income - v.expense,
    }))
}

export default function DashboardV2Page() {
  const cash = useCashlessLabels()
  const [range, setRange] = useState<Range>('month')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totals, setTotals] = useState<Totals | null>(null)
  const [prevTotals, setPrevTotals] = useState<Totals | null>(null)
  const [series, setSeries] = useState<
    Array<{ date: string; label: string; income: number; expense: number; profit: number }>
  >([])

  const [brief, setBrief] = useState<string | null>(null)
  const [briefLoading, setBriefLoading] = useState(false)

  const [askOpen, setAskOpen] = useState(false)
  const [askQ, setAskQ] = useState('')
  const [askA, setAskA] = useState<string | null>(null)
  const [asking, setAsking] = useState(false)

  const period = useMemo(() => getPeriod(range), [range])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [incCur, expCur, incPrev, expPrev] = await Promise.all([
        fetchJson<{ data: IncomeRow[] }>(
          `/api/admin/incomes?from=${period.from}&to=${period.to}&page_size=5000`,
        ),
        fetchJson<{ data: ExpenseRow[] }>(
          `/api/admin/expenses?from=${period.from}&to=${period.to}&page_size=2000&page=0`,
        ),
        fetchJson<{ data: IncomeRow[] }>(
          `/api/admin/incomes?from=${period.prevFrom}&to=${period.prevTo}&page_size=5000`,
        ),
        fetchJson<{ data: ExpenseRow[] }>(
          `/api/admin/expenses?from=${period.prevFrom}&to=${period.prevTo}&page_size=2000&page=0`,
        ),
      ])
      const cur = computeTotals(incCur.data || [], expCur.data || [])
      const prev = computeTotals(incPrev.data || [], expPrev.data || [])
      setTotals(cur)
      setPrevTotals(prev)
      setSeries(buildSeries(incCur.data || [], expCur.data || [], period.from, period.to))
    } catch (e: any) {
      setError(e.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [period])

  useEffect(() => {
    load()
  }, [load])

  // Simple offline brief — no AI required
  const localBrief = useMemo(() => {
    if (!totals || !prevTotals) return null
    const dProfit = delta(totals.profit, prevTotals.profit)
    const dIncome = delta(totals.income, prevTotals.income)
    const dExpense = delta(totals.expense, prevTotals.expense)

    const verb =
      dProfit > 10 ? 'отлично' : dProfit > 0 ? 'неплохо' : dProfit > -10 ? 'спокойно' : 'тяжело'

    const trend =
      dProfit > 0
        ? `Прибыль ${fmtMoney(totals.profit)} (+${dProfit}% к прошлому периоду).`
        : `Прибыль ${fmtMoney(totals.profit)} (${dProfit}% к прошлому периоду).`

    const reason =
      dIncome > dExpense
        ? `Доходы выросли быстрее (+${dIncome}%) чем расходы (${dExpense > 0 ? '+' : ''}${dExpense}%).`
        : dExpense > dIncome
          ? `Расходы растут быстрее (${dExpense > 0 ? '+' : ''}${dExpense}%) чем доходы (${dIncome > 0 ? '+' : ''}${dIncome}%).`
          : 'Доходы и расходы движутся синхронно.'

    return `Идёт ${verb}. ${trend} ${reason} Средний чек ${fmtMoney(totals.avgCheck)}, операций ${totals.txCount}.`
  }, [totals, prevTotals])

  const generateAIBrief = useCallback(async () => {
    if (!totals || !prevTotals) return
    setBriefLoading(true)
    try {
      const snapshot = {
        page: 'analysis' as const,
        title: 'Дашборд — утренний брифинг',
        generatedAt: new Date().toISOString(),
        period: { from: period.from, to: period.to, label: range },
        summary: [
          `Доход: ${fmtMoney(totals.income)} (vs ${fmtMoney(prevTotals.income)})`,
          `Расход: ${fmtMoney(totals.expense)} (vs ${fmtMoney(prevTotals.expense)})`,
          `Прибыль: ${fmtMoney(totals.profit)} (vs ${fmtMoney(prevTotals.profit)})`,
          `Средний чек: ${fmtMoney(totals.avgCheck)}`,
          `Операций: ${totals.txCount}`,
        ],
        sections: [],
      }
      const r = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          page: 'analysis',
          prompt:
            'Сделай короткий утренний брифинг владельцу бизнеса по этим цифрам. 2-3 предложения, без таблиц и списков. Скажи как идёт, на что обратить внимание, и одну короткую рекомендацию. Без воды.',
          snapshot,
        }),
      })
      const j = await r.json()
      if (j?.text) {
        setBrief(j.text)
        if (typeof window !== 'undefined') {
          localStorage.setItem(
            `dashboard-v2-brief:${period.from}:${period.to}`,
            j.text,
          )
        }
      }
    } catch {
      // тихо — у нас есть localBrief как fallback
    } finally {
      setBriefLoading(false)
    }
  }, [totals, prevTotals, period, range])

  // Подгружаем кешированный AI-брифинг (если есть для этого периода)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const cached = localStorage.getItem(
      `dashboard-v2-brief:${period.from}:${period.to}`,
    )
    if (cached) setBrief(cached)
    else setBrief(null)
  }, [period.from, period.to])

  const askClaude = async () => {
    if (!askQ.trim() || !totals) return
    setAsking(true)
    setAskA(null)
    try {
      const snapshot = {
        page: 'analysis' as const,
        title: 'Вопрос по дашборду',
        generatedAt: new Date().toISOString(),
        period: { from: period.from, to: period.to },
        summary: [
          `Доход: ${fmtMoney(totals.income)} (прошлый период: ${fmtMoney(prevTotals?.income || 0)})`,
          `Расход: ${fmtMoney(totals.expense)} (прошлый период: ${fmtMoney(prevTotals?.expense || 0)})`,
          `Прибыль: ${fmtMoney(totals.profit)} (прошлый период: ${fmtMoney(prevTotals?.profit || 0)})`,
        ],
        sections: [],
      }
      const r = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'analysis', prompt: askQ, snapshot }),
      })
      const j = await r.json()
      setAskA(j?.text || j?.error || 'Не получилось ответить')
    } catch (e: any) {
      setAskA(e.message || 'Ошибка')
    } finally {
      setAsking(false)
    }
  }

  const dProfit = totals && prevTotals ? delta(totals.profit, prevTotals.profit) : 0
  const dIncome = totals && prevTotals ? delta(totals.income, prevTotals.income) : 0
  const dExpense = totals && prevTotals ? delta(totals.expense, prevTotals.expense) : 0
  const dAvg = totals && prevTotals ? delta(totals.avgCheck, prevTotals.avgCheck) : 0

  return (
    <div className="app-page-wide space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-gradient-to-br from-orange-500/20 to-amber-500/10 rounded-2xl">
            <Sparkles className="w-7 h-7 text-orange-300" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-foreground">Брифинг</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Минималистичный дашборд — только важное.{' '}
              <a href="/dashboard" className="underline hover:text-foreground">
                Старая версия
              </a>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(['today', 'week', 'month'] as Range[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                range === r
                  ? 'border-orange-500/40 bg-orange-500/10 text-orange-200'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {r === 'today' ? 'Сегодня' : r === 'week' ? 'Неделя' : 'Месяц'}
            </button>
          ))}
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </div>

      {error && (
        <Card className="p-4 border-red-500/30 bg-red-500/5 text-red-300 text-sm">
          {error}
        </Card>
      )}

      {/* Утренний брифинг */}
      <Card className="p-6 border-border bg-gradient-to-br from-orange-500/[0.04] to-amber-500/[0.02]">
        <div className="flex items-start gap-4">
          <div className="p-2.5 bg-orange-500/15 rounded-xl shrink-0">
            <Sparkles className="w-5 h-5 text-orange-300" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 mb-2">
              <h2 className="text-sm font-semibold text-foreground/90">Утренний брифинг</h2>
              <button
                onClick={generateAIBrief}
                disabled={briefLoading || !totals}
                className="text-xs text-orange-300 hover:text-orange-200 disabled:opacity-50 inline-flex items-center gap-1"
              >
                <RefreshCw className={`w-3 h-3 ${briefLoading ? 'animate-spin' : ''}`} />
                {brief ? 'Перегенерировать' : 'Сгенерировать через AI'}
              </button>
            </div>
            <p className="text-base leading-relaxed text-foreground">
              {loading
                ? 'Загружаю данные...'
                : briefLoading
                  ? 'AI анализирует...'
                  : brief || localBrief || 'Нет данных за период.'}
            </p>
          </div>
        </div>
      </Card>

      {/* 4 главные цифры */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Прибыль"
          value={totals?.profit ?? 0}
          delta={dProfit}
          icon={<Wallet className="w-5 h-5" />}
          tone={(totals?.profit ?? 0) >= 0 ? 'green' : 'red'}
          loading={loading}
          onAsk={() => {
            setAskQ('Почему прибыль такая? Что повлияло больше всего?')
            setAskOpen(true)
          }}
        />
        <MetricCard
          label="Доход"
          value={totals?.income ?? 0}
          delta={dIncome}
          icon={<ArrowUpCircle className="w-5 h-5" />}
          tone="blue"
          loading={loading}
          onAsk={() => {
            setAskQ('Откуда основной доход за этот период? Растёт или падает?')
            setAskOpen(true)
          }}
        />
        <MetricCard
          label="Расход"
          value={totals?.expense ?? 0}
          delta={dExpense}
          deltaInverse
          icon={<ArrowDownCircle className="w-5 h-5" />}
          tone="amber"
          loading={loading}
          onAsk={() => {
            setAskQ('На что больше всего ушло денег? Что выросло?')
            setAskOpen(true)
          }}
        />
        <MetricCard
          label="Средний чек"
          value={totals?.avgCheck ?? 0}
          delta={dAvg}
          icon={<Calculator className="w-5 h-5" />}
          tone="violet"
          loading={loading}
          onAsk={() => {
            setAskQ('Средний чек растёт или падает? Что с ним делать?')
            setAskOpen(true)
          }}
        />
      </div>

      {/* Один график */}
      <Card className="p-5 border-border bg-card">
        <h2 className="text-sm font-semibold text-foreground/90 mb-3">
          Прибыль по дням
        </h2>
        <div className="h-64">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Загрузка...
            </div>
          ) : series.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Нет данных
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#fb923c" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#fb923c" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis
                  dataKey="label"
                  stroke="rgba(255,255,255,0.4)"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  stroke="rgba(255,255,255,0.4)"
                  fontSize={11}
                  tickFormatter={(v) =>
                    v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
                  }
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  contentStyle={{
                    background: 'rgba(20,20,20,0.95)',
                    border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => fmtMoney(v)}
                />
                <Area
                  type="monotone"
                  dataKey="profit"
                  stroke="#fb923c"
                  fill="url(#profitGradient)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        Подробности — в{' '}
        <a href="/reports" className="underline hover:text-foreground">
          Отчётах
        </a>
        . {cash.providerShort} вместе с картой и онлайн = доход.
      </p>

      {/* Drawer "Объясни мне" */}
      {askOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex justify-end"
          onClick={() => setAskOpen(false)}
        >
          <div
            className="w-full sm:max-w-md h-full bg-card border-l border-border p-5 overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-orange-300" />
                <h3 className="text-sm font-semibold">Объясни мне</h3>
              </div>
              <button
                onClick={() => setAskOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <textarea
              value={askQ}
              onChange={(e) => setAskQ(e.target.value)}
              rows={3}
              className="w-full bg-input border border-border rounded-lg px-3 py-2 text-sm focus:border-orange-500 mb-2"
              placeholder="Спроси что угодно про эти цифры..."
            />
            <Button
              onClick={askClaude}
              disabled={asking || !askQ.trim()}
              className="w-full mb-4"
            >
              {asking ? 'Думаю...' : 'Спросить'}
            </Button>

            {askA && (
              <Card className="p-4 border-border bg-background/50">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{askA}</p>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({
  label,
  value,
  delta,
  deltaInverse = false,
  icon,
  tone,
  loading,
  onAsk,
}: {
  label: string
  value: number
  delta: number
  deltaInverse?: boolean
  icon: React.ReactNode
  tone: 'green' | 'red' | 'blue' | 'amber' | 'violet'
  loading: boolean
  onAsk: () => void
}) {
  const toneClasses = {
    green: 'text-emerald-300 bg-emerald-500/10',
    red: 'text-red-300 bg-red-500/10',
    blue: 'text-blue-300 bg-blue-500/10',
    amber: 'text-amber-300 bg-amber-500/10',
    violet: 'text-violet-300 bg-violet-500/10',
  }[tone]

  // For expense, growing is bad — invert the color of delta
  const deltaPositive = deltaInverse ? delta < 0 : delta > 0
  const deltaZero = delta === 0

  return (
    <Card className="p-4 border-border bg-card group">
      <div className="flex items-start justify-between mb-3">
        <div className={`p-2 rounded-lg ${toneClasses}`}>{icon}</div>
        <button
          onClick={onAsk}
          className="text-muted-foreground/50 hover:text-orange-300 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Объясни мне"
        >
          <HelpCircle className="w-4 h-4" />
        </button>
      </div>
      <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
        {label}
      </div>
      <div className="text-2xl font-bold text-foreground">
        {loading ? '...' : fmtMoney(value)}
      </div>
      <div className="mt-2 flex items-center gap-1 text-xs">
        {deltaZero ? (
          <span className="text-muted-foreground">без изменений</span>
        ) : (
          <>
            {deltaPositive ? (
              <TrendingUp className="w-3 h-3 text-emerald-400" />
            ) : (
              <TrendingDown className="w-3 h-3 text-red-400" />
            )}
            <span className={deltaPositive ? 'text-emerald-300' : 'text-red-300'}>
              {delta > 0 ? '+' : ''}
              {delta}%
            </span>
            <span className="text-muted-foreground">vs прошлый период</span>
          </>
        )}
      </div>
    </Card>
  )
}
