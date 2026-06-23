'use client'

import { useEffect, useMemo, useState } from 'react'
import { downloadReportPdf } from '@/lib/client/download-pdf'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { AssistantPanel } from '@/components/ai/assistant-panel'
import { Card } from '@/components/ui/card'
import { useCompanies } from '@/hooks/use-companies'
import { useExpenses } from '@/hooks/use-expenses'
import { useIncome } from '@/hooks/use-income'
import type { PageSnapshot } from '@/lib/ai/types'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { Activity, CalendarDays, Download, Loader2, Sparkles, TrendingDown, TrendingUp, Wallet } from 'lucide-react'
import {
  Area,
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
const toISODateLocal = (d: Date) => {
  const t = d.getTime() - d.getTimezoneOffset() * 60_000
  return new Date(t).toISOString().slice(0, 10)
}
const todayISO = () => toISODateLocal(new Date())
const monthStartISO = () => {
  const d = new Date()
  return toISODateLocal(new Date(d.getFullYear(), d.getMonth(), 1))
}
const addDaysISO = (iso: string, diff: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m || 1) - 1, d || 1)
  dt.setDate(dt.getDate() + diff)
  return toISODateLocal(dt)
}
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}
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
type DayRow = {
  date: string
  label: string
  income: number
  expenses: number
  profit: number
  cumBalance: number
}

// ================== TOOLTIP ==================
function CashTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 text-xs shadow-xl">
      <p className="text-slate-500 dark:text-slate-400 mb-2 font-medium">{label}</p>
      {payload.map((p: any) => (
        <div key={p.name} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-semibold text-slate-900 dark:text-white">{fmtMoney(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ================== PAGE ==================
export default function CashFlowPage() {
  const [dateFrom, setDateFrom] = useState(() => monthStartISO())
  const [dateTo, setDateTo] = useState(() => todayISO())
  const [companyId, setCompanyId] = useState('')

  const [aiText, setAiText] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const { can } = useCapabilities()

  const { companies } = useCompanies()
  const { rows: incomeRows, loading: incomeLoading } = useIncome({
    from: dateFrom || undefined,
    to: dateTo || undefined,
    companyId: companyId || undefined,
    fetchAll: true,
    pageSize: 1000,
  })
  const { rows: expenseRows, loading: expenseLoading } = useExpenses({
    from: dateFrom || undefined,
    to: dateTo || undefined,
    companyId: companyId || undefined,
    fetchAll: true,
    pageSize: 1000,
  })

  const loading = incomeLoading || expenseLoading

  // ---- Daily aggregation ----
  const dailyData = useMemo((): DayRow[] => {
    const incomeMap = new Map<string, number>()
    const expenseMap = new Map<string, number>()

    for (const r of incomeRows) {
      const total = (r.cash_amount || 0) + (r.kaspi_amount || 0) + (r.online_amount || 0) + (r.card_amount || 0)
      incomeMap.set(r.date, (incomeMap.get(r.date) || 0) + total)
    }
    for (const r of expenseRows) {
      const total = (r.cash_amount || 0) + (r.kaspi_amount || 0)
      expenseMap.set(r.date, (expenseMap.get(r.date) || 0) + total)
    }

    const allDates = Array.from(new Set([...incomeMap.keys(), ...expenseMap.keys()])).sort()
    let cumBalance = 0
    return allDates.map((date) => {
      const income = incomeMap.get(date) || 0
      const expenses = expenseMap.get(date) || 0
      const profit = income - expenses
      cumBalance += profit
      return { date, label: fmtDate(date), income, expenses, profit, cumBalance }
    })
  }, [incomeRows, expenseRows])

  // ---- Summary stats ----
  const stats = useMemo(() => {
    const totalIncome = dailyData.reduce((s, d) => s + d.income, 0)
    const totalExpenses = dailyData.reduce((s, d) => s + d.expenses, 0)
    const profit = totalIncome - totalExpenses
    const margin = totalIncome > 0 ? (profit / totalIncome) * 100 : 0
    const negativeDays = dailyData.filter((d) => d.profit < 0).length
    const finalBalance = dailyData.at(-1)?.cumBalance ?? 0
    return { totalIncome, totalExpenses, profit, margin, negativeDays, finalBalance }
  }, [dailyData])

  const downloadCSV = async () => {
    const period = `${dateFrom} — ${dateTo}`
    const generated = new Date().toLocaleString('ru-RU')
    const nf = (v: number) => Math.round(v || 0).toLocaleString('ru-RU')
    const meta = { title: 'Движение денег', period, generated, brandNote: 'дашборд cash flow' }
    const cols = [
      { key: 'date', label: 'Дата', w: '18%' },
      { key: 'income', label: 'Доходы', align: 'right' as const, signed: true, w: '20%' },
      { key: 'expenses', label: 'Расходы', align: 'right' as const, w: '20%' },
      { key: 'profit', label: 'Прибыль за день', align: 'right' as const, signed: true, w: '21%' },
      { key: 'balance', label: 'Баланс накоп.', align: 'right' as const, signed: true, w: '21%' },
    ]

    if (dailyData.length === 0) {
      await downloadReportPdf('premium', {
        meta,
        kpis: [{ label: 'Доходы', value: '—' }, { label: 'Расходы', value: '—' }, { label: 'Чистый cashflow', value: '—' }, { label: 'Баланс', value: '—' }],
        empty: { columns: cols, message: 'Нет данных за выбранный период', hint: 'Выберите период с движениями денег.' },
      }, `Cashflow_${dateFrom}_${dateTo}`)
      return
    }

    const daysAsc = [...dailyData]
    const balances = daysAsc.map((d) => d.cumBalance)
    const minB = Math.min(...balances), maxB = Math.max(...balances)
    const spanB = Math.max(1, maxB - minB)
    const bestDay = daysAsc.reduce((m, d) => (d.profit > m.profit ? d : m), daysAsc[0])
    const worstDay = daysAsc.reduce((m, d) => (d.profit < m.profit ? d : m), daysAsc[0])
    const topProfit = [...daysAsc].filter((d) => d.profit > 0).sort((a, b) => b.profit - a.profit).slice(0, 6)
    const maxProfit = topProfit[0]?.profit || 1
    const incPct = stats.totalIncome + stats.totalExpenses > 0 ? Math.round((stats.totalIncome / (stats.totalIncome + stats.totalExpenses)) * 100) : 0
    const daysDesc = [...dailyData].sort((a, b) => b.date.localeCompare(a.date))

    await downloadReportPdf('premium', {
      meta,
      kpis: [
        { label: 'Доходы', value: `${nf(stats.totalIncome)} тг`, sub: `${dailyData.length} дней`, badge: 'итог' },
        { label: 'Расходы', value: `${nf(stats.totalExpenses)} тг`, sub: `${stats.negativeDays} дней в минусе` },
        { label: 'Чистый cashflow', value: `${nf(stats.profit)} тг`, sub: `маржа ${Math.round(stats.margin)}%`, tone: stats.profit < 0 ? 'bad' : undefined },
        { label: 'Баланс накоп.', value: `${nf(stats.finalBalance)} тг`, sub: bestDay ? `Лучший: ${bestDay.date}` : '', tone: stats.finalBalance < 0 ? 'bad' : undefined },
      ],
      sections: [
        { type: 'split', title: 'Доходы / Расходы', parts: [{ label: 'Доходы', pct: incPct, amount: stats.totalIncome, color: '#16a34a' }, { label: 'Расходы', pct: 100 - incPct, amount: stats.totalExpenses, color: '#f97316' }], accent: { title: 'Лучший / худший день', text: `${bestDay?.date}: +${nf(bestDay?.profit || 0)} · ${worstDay?.date}: ${nf(worstDay?.profit || 0)}` } },
        { type: 'minichart', title: 'Накопительный баланс по дням', hint: 'динамика баланса', bars: daysAsc.map((d) => ({ ratio: (d.cumBalance - minB) / spanB, peak: d.date === bestDay?.date })), footer: `Баланс на конец: ${nf(stats.finalBalance)} тг` },
        { type: 'bars', title: 'Топ дней по прибыли', hint: 'прибыльные дни', items: topProfit.map((d) => ({ label: d.label || d.date, amount: d.profit, ratio: d.profit / maxProfit, color: '#16a34a' })) },
        { type: 'previewTable', title: 'Сводка по дням', hint: 'preview · полная ниже', columns: [{ key: 'date', label: 'Дата' }, { key: 'income', label: 'Доходы', align: 'right' }, { key: 'expenses', label: 'Расходы', align: 'right' }, { key: 'profit', label: 'Прибыль', align: 'right' }, { key: 'balance', label: 'Баланс', align: 'right' }], rows: daysDesc.slice(0, 3).map((d) => ({ date: d.date, income: d.income, expenses: d.expenses, profit: d.profit, balance: d.cumBalance })), moreNote: dailyData.length > 3 ? `+ ещё ${dailyData.length - 3} дней в детализации` : '' },
      ],
      detail: {
        title: 'Детализация по дням',
        subtitle: 'доходы, расходы, прибыль и накопительный баланс',
        columns: cols,
        rows: daysAsc.map((d) => ({ date: d.date, income: d.income, expenses: d.expenses, profit: d.profit, balance: d.cumBalance })),
        total: { date: null, income: stats.totalIncome, expenses: stats.totalExpenses, profit: stats.profit, balance: stats.finalBalance },
      },
    }, `Cashflow_${dateFrom}_${dateTo}`)
  }

  // ---- Page snapshot for AI ----
  const snapshot = useMemo<PageSnapshot>(
    () => ({
      page: 'cashflow',
      title: 'Cash Flow — движение денег',
      generatedAt: new Date().toISOString(),
      route: '/cashflow',
      period: { from: dateFrom, to: dateTo },
      summary: [
        `Доходы: ${fmtMoney(stats.totalIncome)}`,
        `Расходы: ${fmtMoney(stats.totalExpenses)}`,
        `Прибыль: ${fmtMoney(stats.profit)}, маржа ${stats.margin.toFixed(1)}%`,
        `Убыточных дней: ${stats.negativeDays}`,
      ],
      sections: [
        {
          title: 'Сводка',
          metrics: [
            { label: 'Доходы', value: fmtMoney(stats.totalIncome) },
            { label: 'Расходы', value: fmtMoney(stats.totalExpenses) },
            { label: 'Прибыль', value: fmtMoney(stats.profit) },
            { label: 'Маржа', value: `${stats.margin.toFixed(1)}%` },
            { label: 'Убыточных дней', value: String(stats.negativeDays) },
            { label: 'Итоговый баланс', value: fmtMoney(stats.finalBalance) },
          ],
        },
        {
          title: 'Топ убыточных дней',
          bullets: [...dailyData]
            .filter((d) => d.profit < 0)
            .sort((a, b) => a.profit - b.profit)
            .slice(0, 3)
            .map((d) => `${d.date}: расход ${fmtMoney(d.expenses)}, доход ${fmtMoney(d.income)}, убыток ${fmtMoney(d.profit)}`),
        },
      ],
    }),
    [stats, dailyData, dateFrom, dateTo],
  )

  // ---- Auto-insights on data load ----
  useEffect(() => {
    if (loading || dailyData.length === 0) return

    setAiLoading(true)
    setAiText(null)

    fetch('/api/ai/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: 'cashflow',
        prompt:
          'Проанализируй этот Cash Flow за период. Дай 3 конкретных инсайта: что хорошо, что плохо, и одну главную рекомендацию. Используй точные цифры из данных.',
        snapshot,
      }),
    })
      .then((r) => r.json())
      .then((data) => setAiText(data.text ?? null))
      .catch(() => null)
      .finally(() => setAiLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyData.length, loading])

  const suggestedPrompts = [
    'Какие дни были убыточными и почему?',
    'Как изменился баланс за период?',
    'Что влияет на маржинальность больше всего?',
    'Сравни первую и вторую половину периода',
  ]

  return (
    <>
        <div className="app-page-wide space-y-6">

          {/* Header */}
          <AdminPageHeader
            title="Cash Flow"
            description="Движение денег и баланс нарастающим итогом"
            icon={<Activity className="h-5 w-5" />}
            accent="emerald"
            backHref="/"
            actions={
              can('cashflow.export') ? (
                <button
                  onClick={downloadCSV}
                  disabled={dailyData.length === 0}
                  className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800/50 hover:bg-slate-100 dark:hover:bg-slate-700/50 disabled:opacity-40 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200 transition-colors"
                >
                  <Download className="w-4 h-4 text-emerald-400" />
                  PDF
                </button>
              ) : undefined
            }
            toolbar={
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-1.5">
                  {([
                    { label: 'Сегодня', days: 0 },
                    { label: '7 дней', days: 6 },
                    { label: 'Месяц', days: -1 },  // -1 = текущий календарный месяц с 1 числа
                  ] as const).map(({ label, days }) => {
                    const from = days === -1 ? monthStartISO() : addDaysISO(todayISO(), -days)
                    const active = dateFrom === from && dateTo === todayISO()
                    return (
                      <button
                        key={label}
                        onClick={() => { setDateFrom(from); setDateTo(todayISO()) }}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${
                          active
                            ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
                            : 'bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  })}
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-white dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700">
                  <CalendarDays className="w-4 h-4 text-emerald-400 shrink-0" />
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="bg-transparent text-sm text-slate-700 dark:text-slate-200 outline-none w-[120px]"
                  />
                  <span className="text-slate-500">—</span>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="bg-transparent text-sm text-slate-700 dark:text-slate-200 outline-none w-[120px]"
                  />
                </div>
                {companies.length > 0 && (
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className="px-3 py-2 bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-200 outline-none"
                  >
                    <option value="">Все компании</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            }
          />

          {/* Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="p-4 bg-white dark:bg-slate-900/80 border-emerald-500/20">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="w-4 h-4 text-emerald-400" />
                <p className="text-xs text-slate-400">Доходы</p>
              </div>
              <p className="text-xl font-bold text-emerald-400">{fmtMoney(stats.totalIncome)}</p>
            </Card>
            <Card className="p-4 bg-white dark:bg-slate-900/80 border-red-500/20">
              <div className="flex items-center gap-2 mb-2">
                <TrendingDown className="w-4 h-4 text-red-400" />
                <p className="text-xs text-slate-400">Расходы</p>
              </div>
              <p className="text-xl font-bold text-red-400">{fmtMoney(stats.totalExpenses)}</p>
            </Card>
            <Card className={`p-4 bg-white dark:bg-slate-900/80 ${stats.profit >= 0 ? 'border-amber-500/20' : 'border-red-500/30'}`}>
              <div className="flex items-center gap-2 mb-2">
                <Wallet className="w-4 h-4 text-amber-400" />
                <p className="text-xs text-slate-400">Прибыль</p>
              </div>
              <p className={`text-xl font-bold ${stats.profit >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                {fmtMoney(stats.profit)}
              </p>
            </Card>
            <Card className="p-4 bg-white dark:bg-slate-900/80 border-slate-200 dark:border-slate-700">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-4 h-4 text-amber-400" />
                <p className="text-xs text-slate-400">Маржа</p>
              </div>
              <p className={`text-xl font-bold ${stats.margin >= 20 ? 'text-emerald-400' : stats.margin >= 10 ? 'text-amber-400' : 'text-red-400'}`}>
                {stats.margin.toFixed(1)}%
              </p>
              {stats.negativeDays > 0 && (
                <p className="text-xs text-red-400 mt-1">{stats.negativeDays} убыточных дн.</p>
              )}
            </Card>
          </div>

          {/* AI Auto-Insights */}
          {can('cashflow.ai_analysis') && (
            <Card className="p-5 bg-white dark:bg-slate-900/80 border border-amber-500/20">
              <div className="flex items-center gap-2 mb-3">
                <div className="p-1.5 bg-amber-500/20 rounded-lg">
                  <Sparkles className="w-4 h-4 text-amber-400" />
                </div>
                <h2 className="text-sm font-semibold text-slate-900 dark:text-white">AI-анализ Cash Flow</h2>
                {aiLoading && <Loader2 className="w-4 h-4 text-amber-400 animate-spin ml-1" />}
              </div>

              {aiLoading && (
                <div className="space-y-2.5">
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse w-3/4" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse w-full" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse w-5/6" />
                  <div className="h-3 bg-slate-100 dark:bg-slate-800 rounded-full animate-pulse w-2/3" />
                </div>
              )}
              {!aiLoading && aiText && (
                <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed">{aiText}</p>
              )}
              {!aiLoading && !aiText && dailyData.length === 0 && !loading && (
                <p className="text-sm text-slate-500">Нет данных за выбранный период</p>
              )}
            </Card>
          )}

          {/* Chart */}
          <Card className="p-5 bg-white dark:bg-slate-900/80 border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-1">Доходы vs Расходы</h2>
            <p className="text-xs text-slate-500 mb-4">Синяя линия — баланс нарастающим итогом</p>

            {loading ? (
              <div className="h-64 flex items-center justify-center">
                <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
              </div>
            ) : dailyData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-slate-500 text-sm">Нет данных</div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={dailyData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
                  <XAxis
                    dataKey="label"
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fill: '#6b7280', fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={fmtCompact}
                  />
                  <Tooltip content={<CashTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#9ca3af', paddingTop: 8 }} />
                  <Bar dataKey="income" name="Доходы" fill="#10b981" opacity={0.8} radius={[2, 2, 0, 0]} maxBarSize={20} />
                  <Bar dataKey="expenses" name="Расходы" fill="#ef4444" opacity={0.7} radius={[2, 2, 0, 0]} maxBarSize={20} />
                  <Line
                    dataKey="cumBalance"
                    name="Баланс"
                    type="monotone"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#3b82f6' }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </Card>

          {/* Daily Table */}
          {dailyData.length > 0 && (
            <Card className="p-5 bg-white dark:bg-slate-900/80 border-slate-200 dark:border-slate-800">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Таблица по дням</h2>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200 dark:border-slate-800 text-xs uppercase tracking-wide">
                      <th className="text-left py-2 pr-4 font-medium">Дата</th>
                      <th className="text-right py-2 pr-4 font-medium">Доходы</th>
                      <th className="text-right py-2 pr-4 font-medium">Расходы</th>
                      <th className="text-right py-2 pr-4 font-medium">День</th>
                      <th className="text-right py-2 font-medium">Баланс ∑</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyData.map((row) => (
                      <tr
                        key={row.date}
                        className={`border-b border-slate-200/40 dark:border-slate-800/40 hover:bg-slate-50 dark:hover:bg-slate-800/20 transition-colors ${
                          row.profit < 0 ? 'bg-red-500/5' : ''
                        }`}
                      >
                        <td className="py-2 pr-4 text-slate-700 dark:text-slate-300 whitespace-nowrap">{row.label}</td>
                        <td className="py-2 pr-4 text-right text-emerald-400 font-medium">
                          {row.income > 0 ? fmtMoney(row.income) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className="py-2 pr-4 text-right text-red-400 font-medium">
                          {row.expenses > 0 ? fmtMoney(row.expenses) : <span className="text-slate-600">—</span>}
                        </td>
                        <td className={`py-2 pr-4 text-right font-semibold ${row.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {row.profit > 0 ? '+' : ''}
                          {fmtMoney(row.profit)}
                        </td>
                        <td className={`py-2 text-right font-bold ${row.cumBalance >= 0 ? 'text-amber-400' : 'text-red-400'}`}>
                          {fmtMoney(row.cumBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* AI Chat */}
          <AssistantPanel
            page="cashflow"
            title="AI Ассистент — Cash Flow"
            subtitle="Задайте вопрос по движению денег"
            snapshot={snapshot}
            suggestedPrompts={suggestedPrompts}
          />

        </div>
    </>
  )
}
