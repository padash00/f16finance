'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useIncome } from '@/hooks/use-income'
import { useExpenses } from '@/hooks/use-expenses'
import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Lightbulb,
  Loader2,
  Save,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
  Wand2,
  Zap,
} from 'lucide-react'

const money = (v: number) => `${(Number.isFinite(v) ? v : 0).toLocaleString('ru-RU', { maximumFractionDigits: 0 })} ₸`
const moneyShort = (v: number) => {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + ' млн'
  if (abs >= 1_000) return sign + Math.round(abs / 1_000) + ' тыс'
  return sign + Math.round(abs).toLocaleString('ru-RU')
}

const currentMonthISO = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const monthStart = (m: string) => `${m}-01`
const monthEnd = (m: string) => {
  const d = new Date(`${m}-01T12:00:00`)
  d.setMonth(d.getMonth() + 1, 0)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleString('ru-RU', { month: 'long', year: 'numeric' })
const monthShort = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleString('ru-RU', { month: 'short', year: '2-digit' })
const shiftMonth = (m: string, offset: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const daysInMonth = (m: string) => {
  const d = new Date(`${m}-01T12:00:00`)
  d.setMonth(d.getMonth() + 1, 0)
  return d.getDate()
}

type Goal = { id: string; period: string; target_income: number; target_expense: number; note: string | null }
type Company = { id: string; name: string; code?: string | null }

const SQL_SCRIPT = `create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,
  target_income numeric default 0,
  target_expense numeric default 0,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);`

function ProgressCard({
  label,
  icon: Icon,
  actual,
  target,
  forecast,
  daysLeft,
  isExpense = false,
  isCurrentMonth = false,
}: {
  label: string
  icon: any
  actual: number
  target: number
  forecast: number | null
  daysLeft: number | null
  isExpense?: boolean
  isCurrentMonth?: boolean
}) {
  const hasTarget = target > 0
  const pct = hasTarget ? Math.round((actual / target) * 100) : 0
  // Для расходов лучше когда меньше плана, для остального — больше
  const onTrack = isExpense ? actual <= target : actual >= target
  const closeToTarget = hasTarget && (isExpense ? actual / target < 0.9 : actual / target > 0.9)
  const accent = !hasTarget
    ? { bar: 'bg-slate-500/40', text: 'text-muted-foreground', border: 'border-border' }
    : onTrack && pct >= 100
      ? { bar: 'bg-emerald-500', text: 'text-emerald-300', border: 'border-emerald-500/30' }
      : closeToTarget
        ? { bar: 'bg-cyan-500', text: 'text-cyan-300', border: 'border-cyan-500/30' }
        : isExpense && pct > 100
          ? { bar: 'bg-rose-500', text: 'text-rose-300', border: 'border-rose-500/30' }
          : { bar: 'bg-amber-500', text: 'text-amber-300', border: 'border-amber-500/30' }

  const forecastPct = hasTarget && forecast != null ? Math.round((forecast / target) * 100) : null
  const remainder = hasTarget ? Math.max(0, target - actual) : 0
  const requiredDaily = isCurrentMonth && daysLeft && daysLeft > 0 ? remainder / daysLeft : null

  return (
    <Card className={`border ${accent.border} bg-card p-4`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`h-4 w-4 ${accent.text}`} />
          <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
        </div>
        {hasTarget && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${accent.text} bg-white/[0.04] border border-white/10`}>
            {pct}%
          </span>
        )}
      </div>

      <div className="space-y-1">
        <p className={`text-xl font-bold ${accent.text} tabular-nums`}>{money(actual)}</p>
        {hasTarget ? (
          <p className="text-xs text-muted-foreground">
            план <span className="text-foreground font-medium tabular-nums">{moneyShort(target)}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground/60">цель не задана</p>
        )}
      </div>

      {hasTarget && (
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
          <div className={`h-full ${accent.bar} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}

      {/* Прогноз / темп — только для текущего месяца с целью */}
      {isCurrentMonth && hasTarget && forecast != null ? (
        <div className="mt-3 pt-3 border-t border-border/50 space-y-1">
          <div className="flex justify-between items-baseline text-[11px]">
            <span className="text-muted-foreground flex items-center gap-1">
              <Zap className="h-3 w-3" />Прогноз
            </span>
            <span className={`tabular-nums font-medium ${forecastPct && (isExpense ? forecastPct <= 100 : forecastPct >= 100) ? 'text-emerald-300' : 'text-amber-300'}`}>
              {moneyShort(forecast)}{forecastPct != null ? ` (${forecastPct}%)` : ''}
            </span>
          </div>
          {requiredDaily != null && !isExpense ? (
            <div className="flex justify-between items-baseline text-[11px]">
              <span className="text-muted-foreground">Нужно/день</span>
              <span className="text-foreground tabular-nums">{moneyShort(requiredDaily)}</span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function VarianceTable({ goals, companyId }: { goals: Goal[]; companyId: string }) {
  const [actuals, setActuals] = useState<Record<string, { income: number; expense: number }>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    const sorted = [...goals].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6)
    if (sorted.length === 0) return
    setLoading(true)
    Promise.all(
      sorted.map(async (g) => {
        const start = `${g.period}-01`
        const d = new Date(`${g.period}-01T12:00:00`)
        d.setMonth(d.getMonth() + 1, 0)
        const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
        const fetchAll = async (base: string) => {
          let rows: any[] = []
          let page = 0
          const PAGE = 500
          while (true) {
            const r = await fetch(`${base}&page_size=${PAGE}&page=${page}`).then((r) => r.json())
            const chunk: any[] = r.data ?? []
            rows = rows.concat(chunk)
            if (chunk.length < PAGE) break
            page++
          }
          return rows
        }
        const companyParam = companyId !== 'all' ? `&company_id=${encodeURIComponent(companyId)}` : ''
        const [incRows, expRows] = await Promise.all([
          fetchAll(`/api/admin/incomes?from=${start}&to=${end}${companyParam}`),
          fetchAll(`/api/admin/expenses?from=${start}&to=${end}${companyParam}`),
        ])
        const income = incRows.reduce(
          (s: number, r: any) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.online_amount || 0) + (r.card_amount || 0),
          0,
        )
        const expense = expRows.reduce((s: number, r: any) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0), 0)
        return [g.period, { income, expense }] as const
      }),
    )
      .then((results) => {
        setActuals(Object.fromEntries(results))
      })
      .finally(() => setLoading(false))
  }, [goals, companyId])

  const sorted = [...goals].sort((a, b) => b.period.localeCompare(a.period)).slice(0, 6).reverse()
  const maxAbs = useMemo(() => {
    let m = 0
    for (const g of sorted) {
      const a = actuals[g.period]
      const planProfit = g.target_income - g.target_expense
      const actProfit = a ? a.income - a.expense : 0
      m = Math.max(m, Math.abs(planProfit), Math.abs(actProfit), g.target_income, a?.income || 0)
    }
    return m
  }, [sorted, actuals])

  if (sorted.length === 0) return null

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">Прибыль: план vs факт</p>
        {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
      </div>

      {/* Mini-bars sparkline */}
      <div className="mb-5 grid grid-cols-6 gap-1.5">
        {sorted.map((g) => {
          const a = actuals[g.period]
          const planProfit = g.target_income - g.target_expense
          const actProfit = a ? a.income - a.expense : null
          const planH = maxAbs > 0 ? (Math.abs(planProfit) / maxAbs) * 100 : 0
          const actH = maxAbs > 0 && actProfit != null ? (Math.abs(actProfit) / maxAbs) * 100 : 0
          const beat = actProfit != null && actProfit >= planProfit
          return (
            <div key={g.period} className="flex flex-col items-center gap-1">
              <div className="relative h-24 w-full flex items-end justify-center gap-0.5 rounded-md bg-white/[0.02] p-1">
                <div
                  className="w-1/2 rounded-sm bg-slate-500/40 transition-all"
                  style={{ height: `${planH}%` }}
                  title={`План: ${moneyShort(planProfit)}`}
                />
                <div
                  className={`w-1/2 rounded-sm transition-all ${actProfit == null ? 'bg-slate-700' : beat ? 'bg-emerald-500/80' : 'bg-rose-500/70'}`}
                  style={{ height: `${actH}%` }}
                  title={actProfit != null ? `Факт: ${moneyShort(actProfit)}` : '...'}
                />
              </div>
              <span className="text-[10px] text-muted-foreground tabular-nums">{monthShort(g.period)}</span>
              {actProfit != null && (
                <span className={`text-[10px] tabular-nums font-medium ${beat ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {beat ? '✓' : '−'}{moneyShort(Math.abs(actProfit - planProfit))}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-left text-[10px] uppercase tracking-wider text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Месяц</th>
              <th className="py-2 pr-3 text-right font-medium">План выр.</th>
              <th className="py-2 pr-3 text-right font-medium">Факт выр.</th>
              <th className="py-2 pr-3 text-right font-medium">План расх.</th>
              <th className="py-2 pr-3 text-right font-medium">Факт расх.</th>
              <th className="py-2 pr-3 text-right font-medium">План приб.</th>
              <th className="py-2 text-right font-medium">Факт приб.</th>
            </tr>
          </thead>
          <tbody>
            {[...sorted].reverse().map((g) => {
              const a = actuals[g.period]
              const planProfit = g.target_income - g.target_expense
              const actProfit = a ? a.income - a.expense : null
              const profitBeat = actProfit != null && actProfit >= planProfit
              return (
                <tr key={g.period} className="border-b border-border/40 hover:bg-white/[0.02]">
                  <td className="py-2 pr-3 font-medium text-foreground whitespace-nowrap">{monthShort(g.period)}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground tabular-nums">{moneyShort(g.target_income)}</td>
                  <td className="py-2 pr-3 text-right text-emerald-400 tabular-nums">{a ? moneyShort(a.income) : '…'}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground tabular-nums">{moneyShort(g.target_expense)}</td>
                  <td className="py-2 pr-3 text-right text-rose-400 tabular-nums">{a ? moneyShort(a.expense) : '…'}</td>
                  <td className="py-2 pr-3 text-right text-muted-foreground tabular-nums">{moneyShort(planProfit)}</td>
                  <td className={`py-2 text-right font-semibold tabular-nums ${actProfit == null ? 'text-muted-foreground' : profitBeat ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {actProfit != null ? moneyShort(actProfit) : '…'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function GoalsPage() {
  const [month, setMonth] = useState(currentMonthISO)
  const [goals, setGoals] = useState<Goal[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState<string>('all')
  const [tableExists, setTableExists] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState({ target_income: '', target_expense: '', note: '' })
  const [copied, setCopied] = useState(false)

  const today = new Date()
  const currentMonth = currentMonthISO()
  const isCurrentMonth = month === currentMonth
  const totalDays = daysInMonth(month)
  const dayOfMonth = isCurrentMonth ? today.getDate() : totalDays
  const daysLeft = isCurrentMonth ? Math.max(0, totalDays - dayOfMonth) : 0

  const dateFrom = useMemo(() => monthStart(month), [month])
  const dateTo = useMemo(() => monthEnd(month), [month])

  const { rows: incomeRows } = useIncome({
    from: dateFrom,
    to: dateTo,
    companyId: companyId !== 'all' ? companyId : undefined,
    fetchAll: true,
    pageSize: 1000,
  })
  const { rows: expenseRows } = useExpenses({
    from: dateFrom,
    to: dateTo,
    companyId: companyId !== 'all' ? companyId : undefined,
    fetchAll: true,
    pageSize: 1000,
  })

  // Прошлый месяц — для подсказки и копирования цели
  const prevMonth = shiftMonth(month, -1)
  const { rows: prevIncomeRows } = useIncome({
    from: monthStart(prevMonth),
    to: monthEnd(prevMonth),
    companyId: companyId !== 'all' ? companyId : undefined,
    fetchAll: true,
    pageSize: 1000,
  })
  const { rows: prevExpenseRows } = useExpenses({
    from: monthStart(prevMonth),
    to: monthEnd(prevMonth),
    companyId: companyId !== 'all' ? companyId : undefined,
    fetchAll: true,
    pageSize: 1000,
  })

  const actuals = useMemo(() => {
    const income = incomeRows.reduce(
      (s, r) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.online_amount || 0) + (r.card_amount || 0),
      0,
    )
    const expense = expenseRows.reduce((s, r) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0), 0)
    return { income, expense, profit: income - expense }
  }, [incomeRows, expenseRows])

  const prevActuals = useMemo(() => {
    const income = prevIncomeRows.reduce(
      (s, r) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.online_amount || 0) + (r.card_amount || 0),
      0,
    )
    const expense = prevExpenseRows.reduce((s, r) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0), 0)
    return { income, expense, profit: income - expense }
  }, [prevIncomeRows, prevExpenseRows])

  const currentGoal = useMemo(() => goals.find((g) => g.period === month) ?? null, [goals, month])
  const prevGoal = useMemo(() => goals.find((g) => g.period === prevMonth) ?? null, [goals, prevMonth])

  // Прогноз на конец месяца (только для текущего месяца)
  const forecast = useMemo(() => {
    if (!isCurrentMonth || dayOfMonth === 0) return null
    const passed = dayOfMonth
    const factor = totalDays / passed
    return {
      income: actuals.income * factor,
      expense: actuals.expense * factor,
      profit: actuals.profit * factor,
    }
  }, [isCurrentMonth, actuals, dayOfMonth, totalDays])

  useEffect(() => {
    setLoading(true)
    fetch('/api/goals')
      .then((r) => r.json())
      .then((data) => {
        setTableExists(data.tableExists !== false)
        setGoals(data.data ?? [])
      })
      .catch(() => setTableExists(false))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => r.json().catch(() => null).then((json) => ({ ok: r.ok, json })))
      .then(({ ok, json }) => {
        if (ok && Array.isArray(json?.data)) setCompanies(json.data as Company[])
      })
      .catch(() => setCompanies([]))
  }, [])

  useEffect(() => {
    setDraft({
      target_income: currentGoal?.target_income ? String(currentGoal.target_income) : '',
      target_expense: currentGoal?.target_expense ? String(currentGoal.target_expense) : '',
      note: currentGoal?.note ?? '',
    })
  }, [currentGoal, month])

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          period: month,
          target_income: Number(draft.target_income.replace(',', '.') || 0),
          target_expense: Number(draft.target_expense.replace(',', '.') || 0),
          note: draft.note || null,
        }),
      })
      const data = await res.json()
      if (data.data) {
        setGoals((prev) => {
          const filtered = prev.filter((g) => g.period !== month)
          return [...filtered, data.data].sort((a, b) => b.period.localeCompare(a.period))
        })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }

  // Авто-подстановки
  const suggestFromPrev10pct = () => {
    if (!prevActuals.income && !prevActuals.expense) return
    setDraft({
      target_income: String(Math.round(prevActuals.income * 1.1)),
      target_expense: String(Math.round(prevActuals.expense * 1.05)),
      note: draft.note,
    })
  }
  const suggestCopyPrevGoal = () => {
    if (!prevGoal) return
    setDraft({
      target_income: String(prevGoal.target_income),
      target_expense: String(prevGoal.target_expense),
      note: draft.note,
    })
  }

  const monthPills = useMemo(() => {
    return [-3, -2, -1, 0, 1, 2].map((offset) => shiftMonth(month, offset))
  }, [month])

  const targetIncome = currentGoal?.target_income ?? 0
  const targetExpense = currentGoal?.target_expense ?? 0
  const targetProfit = targetIncome - targetExpense
  const hasAnyGoal = targetIncome > 0 || targetExpense > 0
  const allMet = hasAnyGoal && actuals.income >= targetIncome && actuals.expense <= targetExpense

  return (
    <div className="app-page-wide space-y-6">
      {/* ═══ HEADER ═══ */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground flex items-center gap-2">
            <Target className="h-7 w-7 text-teal-400" />
            Цели и план
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Плановые показатели по выручке, расходам и прибыли. Прогноз — на основе текущего темпа.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-sm">
            <CalendarDays className="w-4 h-4 text-teal-400" />
            <span className="text-foreground font-medium capitalize">{monthLabel(month)}</span>
          </div>
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="p-2 rounded-lg border border-border bg-card text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <select
            value={companyId}
            onChange={(e) => setCompanyId(e.target.value)}
            className="ml-1 px-3 py-2 rounded-lg border border-border bg-card text-sm text-foreground min-w-[180px]"
          >
            <option value="all">Все компании</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* SQL setup card */}
      {tableExists === false && (
        <Card className="p-5 border-amber-500/30 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-3">
            <Target className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-amber-300">Требуется настройка базы данных</h2>
          </div>
          <p className="text-xs text-muted-foreground mb-3">Выполни этот SQL в Supabase → SQL Editor:</p>
          <div className="relative">
            <pre className="bg-black/40 border border-border rounded-xl p-4 text-xs text-foreground overflow-x-auto">{SQL_SCRIPT}</pre>
            <button
              onClick={() => {
                navigator.clipboard.writeText(SQL_SCRIPT)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              }}
              className="absolute top-2 right-2 px-2 py-1 text-xs bg-white/10 hover:bg-white/15 text-foreground rounded-lg transition-colors"
            >
              {copied ? '✓ Скопировано' : 'Копировать'}
            </button>
          </div>
        </Card>
      )}

      {loading && goals.length === 0 ? (
        <Card className="border-border bg-card p-12 text-center text-muted-foreground animate-pulse">Загружаем данные…</Card>
      ) : tableExists !== false ? (
        <>
          {/* ═══ MONTH PILLS ═══ */}
          <div className="flex flex-wrap gap-2">
            {monthPills.map((m) => {
              const isActive = m === month
              const isPast = m < currentMonth
              const isFuture = m > currentMonth
              const g = goals.find((x) => x.period === m)
              return (
                <button
                  key={m}
                  onClick={() => setMonth(m)}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-all ${
                    isActive
                      ? 'border-teal-500/40 bg-teal-500/10 text-teal-200 shadow-[0_0_0_1px_rgba(20,184,166,0.2)]'
                      : 'border-border bg-card text-muted-foreground hover:border-teal-500/30 hover:text-foreground'
                  }`}
                >
                  <span className="font-medium capitalize">{monthShort(m)}</span>
                  {g && (g.target_income > 0 || g.target_expense > 0) ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-teal-400" title="Цель задана" />
                  ) : isPast ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" title="Цель не задана" />
                  ) : isFuture ? (
                    <span className="text-[10px] text-muted-foreground/60">план</span>
                  ) : null}
                </button>
              )
            })}
          </div>

          {/* ═══ ACHIEVEMENT BANNER ═══ */}
          {allMet && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
              <div className="shrink-0 rounded-lg bg-emerald-500/20 p-2 text-emerald-300">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-emerald-200">Цели выполнены полностью!</p>
                <p className="text-xs text-emerald-300/80">{monthLabel(month)} — выручка ↑ {money(targetIncome)}, расходы ↓ {money(targetExpense)}.</p>
              </div>
            </div>
          )}

          {/* ═══ 3 PROGRESS CARDS ═══ */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ProgressCard
              label="Выручка"
              icon={TrendingUp}
              actual={actuals.income}
              target={targetIncome}
              forecast={forecast?.income ?? null}
              daysLeft={daysLeft}
              isCurrentMonth={isCurrentMonth}
            />
            <ProgressCard
              label="Расходы"
              icon={TrendingDown}
              actual={actuals.expense}
              target={targetExpense}
              forecast={forecast?.expense ?? null}
              daysLeft={daysLeft}
              isExpense
              isCurrentMonth={isCurrentMonth}
            />
            <ProgressCard
              label="Прибыль"
              icon={Wallet}
              actual={actuals.profit}
              target={targetProfit}
              forecast={forecast?.profit ?? null}
              daysLeft={daysLeft}
              isCurrentMonth={isCurrentMonth}
            />
          </div>

          {/* ═══ INSIGHT строка ═══ */}
          {isCurrentMonth && hasAnyGoal && forecast && (
            <div className="flex items-start gap-3 rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-4 py-3">
              <div className="shrink-0 rounded-lg bg-cyan-500/15 p-1.5 text-cyan-300">
                <Lightbulb className="h-4 w-4" />
              </div>
              <div className="flex-1 text-sm text-cyan-100/90 space-y-1">
                <p>
                  <span className="text-foreground font-medium">{daysLeft}</span> дней до конца месяца
                  · день <span className="text-foreground">{dayOfMonth}</span> из {totalDays}.
                </p>
                {targetIncome > 0 && (() => {
                  const required = (targetIncome - actuals.income) / Math.max(1, daysLeft)
                  const currentRate = actuals.income / Math.max(1, dayOfMonth)
                  const onTrack = currentRate >= required || daysLeft === 0
                  return (
                    <p>
                      Чтобы выполнить план по выручке — нужно <span className="text-foreground font-medium">{moneyShort(Math.max(0, required))}</span>/день. Сейчас зарабатываешь <span className={onTrack ? 'text-emerald-300' : 'text-amber-300'}>{moneyShort(currentRate)}</span>/день.
                    </p>
                  )
                })()}
              </div>
            </div>
          )}

          {/* ═══ EDIT FORM ═══ */}
          <Card className="border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-teal-400" />
                Цели на {monthLabel(month)}
              </h2>
              <div className="flex items-center gap-2">
                {prevGoal && (prevGoal.target_income > 0 || prevGoal.target_expense > 0) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={suggestCopyPrevGoal}
                    className="h-8 text-xs"
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Скопировать прошлую цель
                  </Button>
                )}
                {(prevActuals.income > 0 || prevActuals.expense > 0) && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={suggestFromPrev10pct}
                    className="h-8 text-xs"
                  >
                    <Wand2 className="h-3 w-3 mr-1" />
                    +10% от факта прошлого
                  </Button>
                )}
              </div>
            </div>

            {(prevActuals.income > 0 || prevActuals.expense > 0) && (
              <div className="mb-4 rounded-lg border border-border bg-white/[0.02] px-3 py-2 text-xs text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="font-medium text-foreground">Прошлый месяц ({monthShort(prevMonth)}):</span>
                <span>выручка <span className="text-emerald-300 tabular-nums">{moneyShort(prevActuals.income)}</span></span>
                <span>расходы <span className="text-rose-300 tabular-nums">{moneyShort(prevActuals.expense)}</span></span>
                <span>прибыль <span className={`tabular-nums ${prevActuals.profit >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>{moneyShort(prevActuals.profit)}</span></span>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">Плановая выручка</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.target_income}
                    onChange={(e) => setDraft((d) => ({ ...d, target_income: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2.5 pr-12 bg-input border border-border rounded-lg text-sm text-foreground outline-none focus:border-teal-500/50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₸</span>
                </div>
                {draft.target_income && Number(draft.target_income) > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">= {moneyShort(Number(draft.target_income))}</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">Плановые расходы</label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={draft.target_expense}
                    onChange={(e) => setDraft((d) => ({ ...d, target_expense: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2.5 pr-12 bg-input border border-border rounded-lg text-sm text-foreground outline-none focus:border-teal-500/50"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">₸</span>
                </div>
                {draft.target_expense && Number(draft.target_expense) > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">= {moneyShort(Number(draft.target_expense))}</p>
                )}
              </div>
            </div>

            {/* Расчётная плановая прибыль */}
            {(Number(draft.target_income) > 0 || Number(draft.target_expense) > 0) && (
              <div className="mt-3 rounded-lg border border-cyan-500/20 bg-cyan-500/[0.04] px-3 py-2 text-xs flex items-center justify-between">
                <span className="text-muted-foreground">Расчётная плановая прибыль:</span>
                <span className={`font-semibold tabular-nums ${Number(draft.target_income) - Number(draft.target_expense) >= 0 ? 'text-cyan-300' : 'text-rose-300'}`}>
                  {moneyShort(Number(draft.target_income) - Number(draft.target_expense))}
                </span>
              </div>
            )}

            <div className="mt-4">
              <label className="block text-xs text-muted-foreground mb-1.5 uppercase tracking-wider">Заметка</label>
              <textarea
                value={draft.note}
                onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))}
                placeholder="напр.: рост из-за открытия новой зоны, акция на Каспи..."
                rows={2}
                className="w-full px-3 py-2 bg-input border border-border rounded-lg text-sm text-foreground outline-none focus:border-teal-500/50 resize-none"
              />
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saved ? 'Сохранено!' : 'Сохранить цели'}
              </button>
              {currentGoal?.note && !draft.note && (
                <span className="text-xs text-muted-foreground">Заметка: {currentGoal.note}</span>
              )}
            </div>
          </Card>

          {/* ═══ VARIANCE HISTORY ═══ */}
          {goals.filter((g) => g.target_income > 0 || g.target_expense > 0).length > 0 && (
            <Card className="border-border bg-card p-5">
              <VarianceTable
                goals={goals.filter((g) => g.target_income > 0 || g.target_expense > 0)}
                companyId={companyId}
              />
            </Card>
          )}
        </>
      ) : null}
    </div>
  )
}
