'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ReferenceLine, Cell, Legend,
} from 'recharts'
import { Brain, TrendingUp, TrendingDown, Wallet, RefreshCw, Sparkles, Info, AlertTriangle } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

type Company = { id: string; name: string; code?: string | null }

type MonthAgg = { month: string; income: number; fixed: number; variable: number; oneOff: number; expense: number; profit: number; isPartial: boolean }
type Forecast = {
  months: MonthAgg[]
  targetMonth: string
  targetMonthLabel: string
  income: { expected: number; low: number; high: number; recentAvg: number; momGrowthPct: number; seasonalIndex: number; runRate: number | null }
  expense: { expected: number; fixed: number; variable: number; variableRatePct: number; oneOffAvg: number }
  profit: { expected: number; low: number; high: number }
  scenarios: { best: number; expected: number; worst: number }
  expenseByGroup: Array<{ group: string; label: string; amount: number; bucket: 'fixed' | 'variable' }>
  confidence: { score: number; monthsOfData: number; seasonalityAvailable: boolean; volatilityPct: number; notes: string[] }
}

function money(n: number) { return Math.round(Number(n) || 0).toLocaleString('ru-RU') + ' ₸' }
function moneyShort(n: number) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return (n / 1_000_000).toFixed(1) + ' млн'
  if (a >= 1_000) return Math.round(n / 1_000) + 'k'
  return String(Math.round(n))
}
function monthShort(ym: string) {
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const [y, m] = ym.split('-').map(Number)
  return `${names[(m - 1) % 12]} ${String(y).slice(2)}`
}

export default function AnalysisPage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyId, setCompanyId] = useState('')
  const [data, setData] = useState<Forecast | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ai, setAi] = useState<string | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((j) => setCompanies(j.data || []))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true); setError(null); setAi(null)
    try {
      const p = new URLSearchParams()
      if (companyId) p.set('company_id', companyId)
      const res = await fetch(`/api/admin/monthly-forecast?${p}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body?.error || 'Не удалось построить прогноз')
      setData(body.forecast as Forecast)
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  const askAi = useCallback(async () => {
    if (!data) return
    setAiLoading(true)
    try {
      const res = await fetch('/api/admin/monthly-forecast/ai', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      })
      const j = await res.json()
      setAi(res.ok ? (j.text || 'Пусто.') : (j.error || 'AI недоступен.'))
    } catch {
      setAi('Не удалось получить AI-вывод.')
    } finally {
      setAiLoading(false)
    }
  }, [data])

  const chartData = useMemo(() => (data?.months || []).map((m) => ({
    label: monthShort(m.month) + (m.isPartial ? ' (тек.)' : ''),
    'Доход': Math.round(m.income), 'Расход': Math.round(m.expense), 'Прибыль': Math.round(m.profit),
  })), [data])

  return (
    <div className="app-page-wide space-y-6">
      <AdminPageHeader
        title="Прогноз на следующий месяц"
        description="Доход, расход и прибыль по закономерностям прошлых месяцев — честно и прозрачно"
        icon={<Brain className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <>
            <select
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className="bg-slate-100 dark:bg-zinc-900/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-white outline-none cursor-pointer"
            >
              <option value="" className="bg-white dark:bg-zinc-900">📍 Все точки</option>
              {companies.map((c) => <option key={c.id} value={c.id} className="bg-white dark:bg-zinc-900">📍 {c.name}</option>)}
            </select>
            <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="rounded-xl border border-slate-200 dark:border-white/10" title="Обновить">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
          </>
        }
      />

      {error && (
        <Card className="p-4 border-rose-500/30 bg-rose-500/10 text-sm text-rose-700 dark:text-rose-300 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {error}
        </Card>
      )}

      {loading && !data ? (
        <div className="flex min-h-[40vh] items-center justify-center gap-2 text-slate-500">
          <RefreshCw className="w-4 h-4 animate-spin" /> Считаю прогноз…
        </div>
      ) : data ? (
        <>
          {/* Вердикт */}
          <Card className="p-6 bg-gradient-to-br from-violet-50 via-white to-white dark:from-violet-900/20 dark:via-gray-900/40 dark:to-gray-900/40 border-slate-200 dark:border-white/10">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-4 h-4 text-violet-500" />
              <h2 className="text-sm font-semibold text-slate-900 dark:text-white">Прогноз на {data.targetMonthLabel}</h2>
              <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-700 dark:text-violet-300">
                уверенность {data.confidence.score}/100
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Verdict label="Доход" value={data.income.expected} range={[data.income.low, data.income.high]} tone="emerald" icon={<TrendingUp className="w-4 h-4" />} />
              <Verdict label="Расход" value={data.expense.expected} tone="rose" icon={<TrendingDown className="w-4 h-4" />} />
              <Verdict label="Прибыль" value={data.profit.expected} range={[data.scenarios.worst, data.scenarios.best]} tone={data.profit.expected >= 0 ? 'violet' : 'rose'} icon={<Wallet className="w-4 h-4" />} />
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              {([['Худший', data.scenarios.worst, 'rose'], ['Ожидаемый', data.scenarios.expected, 'slate'], ['Лучший', data.scenarios.best, 'emerald']] as const).map(([l, v, t]) => (
                <div key={l} className="rounded-xl border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/[0.02] py-2">
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">{l}</div>
                  <div className={`text-sm font-bold tabular-nums ${t === 'rose' ? 'text-rose-600 dark:text-rose-400' : t === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>{money(v)}</div>
                </div>
              ))}
            </div>
          </Card>

          {/* История по месяцам */}
          <Card className="p-5 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">История по месяцам</h3>
            {chartData.length === 0 ? (
              <div className="text-sm text-slate-500 py-8 text-center">Нет данных</div>
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" fontSize={11} tickLine={false} axisLine={false} />
                    <YAxis fontSize={10} tickLine={false} axisLine={false} tickFormatter={moneyShort} />
                    <Tooltip formatter={(v: any) => money(Number(v))} />
                    <Legend />
                    <ReferenceLine y={0} stroke="currentColor" className="text-slate-300 dark:text-white/20" />
                    <Bar dataKey="Доход" fill="#10b981" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Расход" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Прибыль" radius={[3, 3, 0, 0]}>
                      {chartData.map((d, i) => <Cell key={i} fill={d['Прибыль'] >= 0 ? '#8b5cf6' : '#f59e0b'} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>

          {/* Как собран прогноз */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-5 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2"><Info className="w-4 h-4 text-blue-400" />Как собран ДОХОД</h3>
              <div className="space-y-2 text-sm">
                <Row label="Средний за последние месяцы" value={money(data.income.recentAvg)} />
                <Row label="Тренд по месяцам" value={`${data.income.momGrowthPct >= 0 ? '+' : ''}${data.income.momGrowthPct.toFixed(1)}% / мес`} tone={data.income.momGrowthPct >= 0 ? 'emerald' : 'rose'} />
                <Row label="Сезонность месяца" value={data.confidence.seasonalityAvailable ? `×${data.income.seasonalIndex.toFixed(2)}` : 'нет данных (<13 мес)'} muted={!data.confidence.seasonalityAvailable} />
                {data.income.runRate !== null && <Row label="Run-rate текущего месяца" value={money(data.income.runRate)} />}
                <div className="pt-2 border-t border-slate-200 dark:border-white/8 flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-white">Прогноз дохода</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">{money(data.income.expected)}</span>
                </div>
              </div>
            </Card>

            <Card className="p-5 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-3 flex items-center gap-2"><Info className="w-4 h-4 text-blue-400" />Как собран РАСХОД</h3>
              <div className="space-y-2 text-sm">
                <Row label="Постоянные (аренда, ФОТ, налоги)" value={money(data.expense.fixed)} />
                <Row label={`Переменные (${data.expense.variableRatePct.toFixed(0)}% от дохода)`} value={money(data.expense.variable)} />
                <Row label="Разовые (CAPEX, штрафы) — вне прогноза" value={`~${money(data.expense.oneOffAvg)} / мес`} muted />
                <div className="pt-2 border-t border-slate-200 dark:border-white/8 flex items-center justify-between">
                  <span className="font-semibold text-slate-900 dark:text-white">Прогноз расхода</span>
                  <span className="font-bold text-rose-600 dark:text-rose-400 tabular-nums">{money(data.expense.expected)}</span>
                </div>
              </div>
            </Card>
          </div>

          {/* Расход по категориям */}
          {data.expenseByGroup.length > 0 && (
            <Card className="p-5 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-4">Расход по категориям (в среднем за месяц)</h3>
              <div className="space-y-2">
                {data.expenseByGroup.slice(0, 8).map((g) => {
                  const max = data.expenseByGroup[0].amount || 1
                  return (
                    <div key={g.group} className="flex items-center gap-3">
                      <div className="w-40 shrink-0 text-xs text-slate-700 dark:text-slate-300 truncate">{g.label}</div>
                      <div className="flex-1 h-2 rounded-full bg-slate-100 dark:bg-white/10 overflow-hidden">
                        <div className={`h-full rounded-full ${g.bucket === 'variable' ? 'bg-amber-500' : 'bg-violet-500'}`} style={{ width: `${Math.min(100, g.amount / max * 100)}%` }} />
                      </div>
                      <div className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-slate-900 dark:text-white">{money(g.amount)}</div>
                    </div>
                  )
                })}
              </div>
              <div className="mt-3 flex gap-4 text-[11px] text-slate-500">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-violet-500" />постоянные</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-500" />переменные (% от дохода)</span>
              </div>
            </Card>
          )}

          {/* AI-вывод */}
          <Card className="p-5 bg-white dark:bg-gray-900/40 border-slate-200 dark:border-white/5">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-slate-900 dark:text-white flex items-center gap-2"><Sparkles className="w-4 h-4 text-violet-500" />AI-вывод</h3>
              <Button size="sm" variant="outline" onClick={askAi} disabled={aiLoading} className="rounded-xl">
                {aiLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : 'Получить вывод'}
              </Button>
            </div>
            {ai ? (
              <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700 dark:text-slate-300">{ai}</p>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">Нажми «Получить вывод» — AI прокомментирует прогноз и подскажет действия.</p>
            )}
          </Card>

          {/* Честность */}
          <Card className="p-4 bg-slate-50 dark:bg-white/[0.02] border-slate-200 dark:border-white/8">
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
              <Info className="w-3.5 h-3.5 shrink-0" />
              <span>Месяцев данных: <strong className="text-slate-700 dark:text-slate-300">{data.confidence.monthsOfData}</strong></span>
              <span>· Волатильность: <strong className="text-slate-700 dark:text-slate-300">{data.confidence.volatilityPct.toFixed(0)}%</strong></span>
            </div>
            {data.confidence.notes.length > 0 && (
              <ul className="mt-2 space-y-1 text-xs text-slate-500 dark:text-slate-400 list-disc pl-4">
                {data.confidence.notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </div>
  )
}

function Verdict({ label, value, range, tone, icon }: { label: string; value: number; range?: [number, number]; tone: 'emerald' | 'rose' | 'violet'; icon: React.ReactNode }) {
  const col = tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-violet-600 dark:text-violet-400'
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02] p-4">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">{icon}{label}</div>
      <div className={`mt-1.5 text-2xl font-bold tabular-nums ${col}`}>{money(value)}</div>
      {range && <div className="mt-1 text-[11px] text-slate-400 dark:text-slate-500 tabular-nums">{money(range[0])} … {money(range[1])}</div>}
    </div>
  )
}

function Row({ label, value, tone, muted }: { label: string; value: string; tone?: 'emerald' | 'rose'; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`text-xs ${muted ? 'text-slate-400 dark:text-slate-500' : 'text-slate-600 dark:text-slate-400'}`}>{label}</span>
      <span className={`text-sm font-medium tabular-nums ${tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : muted ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-white'}`}>{value}</span>
    </div>
  )
}
