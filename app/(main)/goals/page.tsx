'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/card'
import { useIncome } from '@/hooks/use-income'
import { useExpenses } from '@/hooks/use-expenses'
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Save, Target, TrendingDown, TrendingUp, Wallet } from 'lucide-react'

const fmtMoney = (v: number) => {
  const abs = Math.abs(v)
  const sign = v < 0 ? '-' : ''
  if (abs >= 1_000_000) return sign + (abs / 1_000_000).toFixed(1) + ' млн ₸'
  if (abs >= 1_000) return sign + Math.round(abs / 1_000) + ' тыс ₸'
  return Math.round(v).toLocaleString('ru-RU') + ' ₸'
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
const shiftMonth = (m: string, offset: number) => {
  const [y, mo] = m.split('-').map(Number)
  const d = new Date(y, mo - 1 + offset, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

type Goal = { id: string; period: string; target_income: number; target_expense: number; note: string | null }

const SQL_SCRIPT = `create table if not exists goals (
  id uuid primary key default gen_random_uuid(),
  period text not null unique,
  target_income numeric default 0,
  target_expense numeric default 0,
  note text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);`

function VarianceTable({ goals }: { goals: Goal[] }) {
  const [actuals, setActuals] = useState<Record<string, {income: number, expense: number}>>({})

  useEffect(() => {
    const sorted = [...goals].sort((a,b) => b.period.localeCompare(a.period)).slice(0, 6)
    Promise.all(sorted.map(async g => {
      const start = `${g.period}-01`
      const d = new Date(`${g.period}-01T12:00:00`)
      d.setMonth(d.getMonth()+1, 0)
      const end = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
      // Paginate to get all records regardless of volume
      const fetchAll = async (base: string) => {
        let rows: any[] = [], page = 0
        const PAGE = 500
        while (true) {
          const r = await fetch(`${base}&page_size=${PAGE}&page=${page}`).then(r => r.json())
          const chunk: any[] = r.data ?? []
          rows = rows.concat(chunk)
          if (chunk.length < PAGE) break
          page++
        }
        return rows
      }
      const [incRows, expRows] = await Promise.all([
        fetchAll(`/api/admin/incomes?from=${start}&to=${end}`),
        fetchAll(`/api/admin/expenses?from=${start}&to=${end}`),
      ])
      const income = incRows.reduce((s:number,r:any) => s+(r.cash_amount||0)+(r.kaspi_amount||0)+(r.online_amount||0)+(r.card_amount||0), 0)
      const expense = expRows.reduce((s:number,r:any) => s+(r.cash_amount||0)+(r.kaspi_amount||0), 0)
      return [g.period, {income, expense}] as const
    })).then(results => {
      setActuals(Object.fromEntries(results))
    })
  }, [goals])

  const fmt = (v: number) => {
    const abs = Math.abs(v)
    const sign = v < 0 ? '-' : ''
    if (abs >= 1_000_000) return sign + (abs/1_000_000).toFixed(1) + ' млн'
    if (abs >= 1_000) return sign + Math.round(abs/1_000) + ' тыс'
    return Math.round(v).toLocaleString('ru-RU')
  }

  const delta = (actual: number, plan: number) => {
    if (!plan) return null
    const d = actual - plan
    const pct = Math.round((d/plan)*100)
    return { d, pct, positive: d >= 0 }
  }

  const sorted = [...goals].sort((a,b) => b.period.localeCompare(a.period)).slice(0,6)

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-gray-500 border-b border-gray-800">
            <th className="text-left py-2 pr-3 font-medium">Месяц</th>
            <th className="text-right py-2 pr-2 font-medium">П. выручка</th>
            <th className="text-right py-2 pr-3 font-medium">Ф. выручка</th>
            <th className="text-right py-2 pr-3 font-medium text-gray-600">Δ</th>
            <th className="text-right py-2 pr-2 font-medium">П. расходы</th>
            <th className="text-right py-2 pr-3 font-medium">Ф. расходы</th>
            <th className="text-right py-2 pr-3 font-medium text-gray-600">Δ</th>
            <th className="text-right py-2 pr-2 font-medium">П. прибыль</th>
            <th className="text-right py-2 font-medium">Ф. прибыль</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(g => {
            const act = actuals[g.period]
            const incDelta = act ? delta(act.income, g.target_income) : null
            const expDelta = act ? delta(act.expense, g.target_expense) : null
            const planProfit = g.target_income - g.target_expense
            const actProfit = act ? act.income - act.expense : null
            return (
              <tr key={g.period} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                <td className="py-2 pr-3 text-gray-300 whitespace-nowrap font-medium">{new Date(`${g.period}-01T12:00:00`).toLocaleString('ru-RU',{month:'short',year:'numeric'})}</td>
                <td className="py-2 pr-2 text-right text-gray-400">{fmt(g.target_income)}</td>
                <td className="py-2 pr-3 text-right text-emerald-400 font-medium">{act ? fmt(act.income) : '...'}</td>
                <td className={`py-2 pr-3 text-right font-medium ${incDelta ? (incDelta.positive ? 'text-emerald-400' : 'text-red-400') : 'text-gray-600'}`}>
                  {incDelta ? `${incDelta.positive?'+':''}${incDelta.pct}%` : '—'}
                </td>
                <td className="py-2 pr-2 text-right text-gray-400">{fmt(g.target_expense)}</td>
                <td className="py-2 pr-3 text-right text-red-400 font-medium">{act ? fmt(act.expense) : '...'}</td>
                <td className={`py-2 pr-3 text-right font-medium ${expDelta ? (!expDelta.positive ? 'text-emerald-400' : 'text-red-400') : 'text-gray-600'}`}>
                  {expDelta ? `${!expDelta.positive?'':'+'}${expDelta.pct}%` : '—'}
                </td>
                <td className="py-2 pr-2 text-right text-gray-400">{fmt(planProfit)}</td>
                <td className={`py-2 text-right font-bold ${actProfit !== null ? (actProfit >= 0 ? 'text-blue-400' : 'text-red-400') : 'text-gray-600'}`}>
                  {actProfit !== null ? fmt(actProfit) : '...'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ProgressBar({ value, target, color }: { value: number; target: number; color: string }) {
  const pct = target > 0 ? Math.min(100, (value / target) * 100) : 0
  return (
    <div className="h-2 bg-gray-800 rounded-full mt-2">
      <div className={`h-2 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export default function GoalsPage() {
  const [month, setMonth] = useState(currentMonthISO)
  const [goals, setGoals] = useState<Goal[]>([])
  const [tableExists, setTableExists] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [draft, setDraft] = useState({ target_income: '', target_expense: '', note: '' })
  const [copied, setCopied] = useState(false)

  const dateFrom = useMemo(() => monthStart(month), [month])
  const dateTo = useMemo(() => monthEnd(month), [month])

  const { rows: incomeRows, loading: incomeLoading } = useIncome({ from: dateFrom, to: dateTo })
  const { rows: expenseRows, loading: expenseLoading } = useExpenses({ from: dateFrom, to: dateTo })

  const actuals = useMemo(() => {
    const income = incomeRows.reduce((s, r) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.online_amount || 0) + (r.card_amount || 0), 0)
    const expense = expenseRows.reduce((s, r) => s + (r.cash_amount || 0) + (r.kaspi_amount || 0), 0)
    return { income, expense, profit: income - expense }
  }, [incomeRows, expenseRows])

  const currentGoal = useMemo(() => goals.find(g => g.period === month) ?? null, [goals, month])

  useEffect(() => {
    setLoading(true)
    fetch('/api/goals')
      .then(r => r.json())
      .then(data => {
        setTableExists(data.tableExists !== false)
        setGoals(data.data ?? [])
      })
      .catch(() => setTableExists(false))
      .finally(() => setLoading(false))
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
        setGoals(prev => {
          const filtered = prev.filter(g => g.period !== month)
          return [...filtered, data.data].sort((a, b) => b.period.localeCompare(a.period))
        })
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } finally {
      setSaving(false)
    }
  }

  const months = useMemo(() => {
    return [shiftMonth(month, -3), shiftMonth(month, -2), shiftMonth(month, -1), month, shiftMonth(month, 1), shiftMonth(month, 2)]
  }, [month])

  const targetIncome = currentGoal?.target_income ?? 0
  const targetExpense = currentGoal?.target_expense ?? 0
  const targetProfit = targetIncome - targetExpense

  return (
    <>
        <div className="app-page max-w-4xl space-y-6">

          {/* Header */}
          <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-teal-900/30 via-gray-900 to-cyan-900/30 p-6 border border-teal-500/20">
            <div className="absolute top-0 right-0 w-64 h-64 bg-teal-600 rounded-full blur-3xl opacity-10 pointer-events-none" />
            <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 relative z-10">
              <div className="flex items-center gap-3">
                <div className="p-3 bg-teal-500/20 rounded-xl">
                  <Target className="w-8 h-8 text-teal-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Цели и план
                  </h1>
                  <p className="text-sm text-gray-400">Плановые показатели по выручке и расходам</p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setMonth(m => shiftMonth(m, -1))}
                  className="p-1.5 rounded-lg bg-gray-800/50 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-800/50 rounded-xl border border-gray-700">
                  <CalendarDays className="w-4 h-4 text-teal-400 shrink-0" />
                  <select
                    value={month}
                    onChange={e => setMonth(e.target.value)}
                    className="bg-transparent text-sm text-gray-200 outline-none"
                  >
                    {months.map(m => (
                      <option key={m} value={m}>{monthLabel(m)}</option>
                    ))}
                  </select>
                </div>
                <button
                  onClick={() => setMonth(m => shiftMonth(m, 1))}
                  className="p-1.5 rounded-lg bg-gray-800/50 border border-gray-700 text-gray-400 hover:text-white hover:bg-gray-700 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* SQL setup card */}
          {tableExists === false && (
            <Card className="p-5 bg-yellow-500/5 border border-yellow-500/30">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-yellow-400" />
                <h2 className="text-sm font-semibold text-yellow-300">Требуется настройка базы данных</h2>
              </div>
              <p className="text-xs text-gray-400 mb-3">Выполните этот SQL в Supabase → SQL Editor:</p>
              <div className="relative">
                <pre className="bg-gray-900 border border-gray-700 rounded-xl p-4 text-xs text-gray-300 overflow-x-auto">{SQL_SCRIPT}</pre>
                <button
                  onClick={() => { navigator.clipboard.writeText(SQL_SCRIPT); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
                  className="absolute top-2 right-2 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
                >
                  {copied ? '✓ Скопировано' : 'Копировать'}
                </button>
              </div>
            </Card>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-32 gap-2 text-gray-500">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Загрузка...</span>
            </div>
          ) : tableExists !== false && (
            <>
              {/* Progress cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="p-5 bg-gray-900/80 border-emerald-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-emerald-400" />
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Выручка</p>
                  </div>
                  <p className="text-xl font-bold text-emerald-400">{fmtMoney(actuals.income)}</p>
                  {targetIncome > 0 && (
                    <>
                      <p className="text-xs text-gray-500 mt-1">из {fmtMoney(targetIncome)} ({Math.min(100, Math.round(actuals.income / targetIncome * 100))}%)</p>
                      <ProgressBar value={actuals.income} target={targetIncome} color="bg-emerald-500" />
                    </>
                  )}
                  {targetIncome === 0 && <p className="text-xs text-gray-600 mt-1">цель не задана</p>}
                </Card>

                <Card className="p-5 bg-gray-900/80 border-red-500/20">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingDown className="w-4 h-4 text-red-400" />
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Расходы</p>
                  </div>
                  <p className="text-xl font-bold text-red-400">{fmtMoney(actuals.expense)}</p>
                  {targetExpense > 0 && (
                    <>
                      <p className="text-xs text-gray-500 mt-1">из {fmtMoney(targetExpense)} ({Math.min(100, Math.round(actuals.expense / targetExpense * 100))}%)</p>
                      <ProgressBar value={actuals.expense} target={targetExpense} color="bg-red-500" />
                    </>
                  )}
                  {targetExpense === 0 && <p className="text-xs text-gray-600 mt-1">цель не задана</p>}
                </Card>

                <Card className={`p-5 bg-gray-900/80 ${actuals.profit >= 0 ? 'border-blue-500/20' : 'border-red-500/30'}`}>
                  <div className="flex items-center gap-2 mb-3">
                    <Wallet className="w-4 h-4 text-blue-400" />
                    <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Прибыль</p>
                  </div>
                  <p className={`text-xl font-bold ${actuals.profit >= 0 ? 'text-blue-400' : 'text-red-400'}`}>{fmtMoney(actuals.profit)}</p>
                  {targetProfit !== 0 && (
                    <>
                      <p className="text-xs text-gray-500 mt-1">план: {fmtMoney(targetProfit)}</p>
                      {targetProfit > 0 && <ProgressBar value={Math.max(0, actuals.profit)} target={targetProfit} color="bg-blue-500" />}
                    </>
                  )}
                  {targetProfit === 0 && targetIncome === 0 && <p className="text-xs text-gray-600 mt-1">установите цели ниже</p>}
                </Card>
              </div>

              {/* Edit form */}
              <Card className="p-5 bg-gray-900/80 border-gray-800">
                <h2 className="text-sm font-semibold text-white mb-4">
                  Цели на {monthLabel(month)}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Плановая выручка (₸)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft.target_income}
                      onChange={e => setDraft(d => ({ ...d, target_income: e.target.value }))}
                      placeholder="0"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 outline-none focus:border-teal-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1.5">Плановые расходы (₸)</label>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft.target_expense}
                      onChange={e => setDraft(d => ({ ...d, target_expense: e.target.value }))}
                      placeholder="0"
                      className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 outline-none focus:border-teal-500/50"
                    />
                  </div>
                </div>
                <div className="mb-4">
                  <label className="block text-xs text-gray-400 mb-1.5">Заметка (опционально)</label>
                  <textarea
                    value={draft.note}
                    onChange={e => setDraft(d => ({ ...d, note: e.target.value }))}
                    placeholder="Комментарий к плану..."
                    rows={2}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-xl text-sm text-gray-200 outline-none focus:border-teal-500/50 resize-none"
                  />
                </div>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-500 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                  {saved ? 'Сохранено!' : 'Сохранить цели'}
                </button>
              </Card>

              {/* Goals history */}
              {goals.filter(g => g.target_income > 0 || g.target_expense > 0).length > 0 && (
                <Card className="p-5 bg-gray-900/80 border-gray-800">
                  <h2 className="text-sm font-semibold text-white mb-4">История целей</h2>
                  <div className="space-y-2">
                    {goals.filter(g => g.target_income > 0 || g.target_expense > 0).map(g => (
                      <div key={g.id} className="flex items-center justify-between py-2 border-b border-gray-800/50 last:border-0">
                        <span className="text-sm text-gray-300">{monthLabel(g.period)}</span>
                        <div className="flex gap-4 text-xs">
                          {g.target_income > 0 && <span className="text-emerald-400">↑ {fmtMoney(g.target_income)}</span>}
                          {g.target_expense > 0 && <span className="text-red-400">↓ {fmtMoney(g.target_expense)}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>
              )}

              {/* Multi-month variance table */}
              {goals.filter(g => g.target_income > 0 || g.target_expense > 0).length > 0 && (
                <Card className="p-5 bg-gray-900/80 border-gray-800">
                  <h2 className="text-sm font-semibold text-white mb-4">План vs Факт — история</h2>
                  <VarianceTable goals={goals.filter(g => g.target_income > 0 || g.target_expense > 0)} />
                </Card>
              )}
            </>
          )}

        </div>
    </>
  )
}
