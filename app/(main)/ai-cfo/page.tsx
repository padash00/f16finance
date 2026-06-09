'use client'

import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Brain, Loader2, AlertTriangle, ShieldAlert, TrendingUp, Lightbulb, Target, CalendarDays } from 'lucide-react'

type Exec = {
  revenue: number; revenueDeltaPct: number
  expenses: number; expensesDeltaPct: number
  profit: number; profitDeltaPct: number
  margin: number; marginDeltaPp: number
  cashflow: number
}
type Company = { name: string; revenue: number; expenses: number; profit: number; margin: number; profitShare: number; revenueDeltaPct: number; profitDeltaPct: number }
type Ranking = { profitLeader: string | null; worst: string | null; efficiencyLeader: string | null; growthLeader: string | null } | null
type Change = { label: string; current: number; prev: number; deltaPct: number }
type Tagged = { text: string; status: string }
type AI = {
  state?: string
  dataQuality?: { percent: number; band: string; notes?: string[]; limitations?: string[] }
  changes?: Tagged[]
  rootCauses?: Tagged[]
  risks?: Array<{ risk: string; probability: string; impact: string; level: string }>
  opportunities?: Array<{ title: string; action: string; effect: string; status: string }>
  actionPlan?: { today?: string[]; week?: string[]; month?: string[] }
  forecast?: { band: string; text: string; warning: string | null } | null
  summary?: { where_losing: string; where_earn: string; main_risk: string; main_opportunity: string; extra_profit: string; three_actions: string[] } | null
  error?: string
}
type Resp = {
  days: number; dateFrom: string; dateTo: string
  executive: Exec; companies: Company[]; ranking: Ranking; expenseChanges: Change[]
  fot: number; fotShare: number
  dataQuality: { percent: number; daysInPeriod: number; daysWithSales: number; salesCompleteness: number; daysWithExpenses: number; expenseCompleteness: number }
  ai: AI
}

const fmt = (v: number) => new Intl.NumberFormat('ru-RU').format(Math.round(v || 0))
const C = { card: 'bg-[#111113]', border: 'border-[#27272A]', sub: 'text-[#A1A1AA]' }

const MONTHS_RU = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
function lastMonthOptions(count = 12) {
  const out: Array<{ value: string; label: string }> = []
  const now = new Date()
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    out.push({ value, label: `${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}` })
  }
  return out
}
function monthRange(value: string) {
  const [y, m] = value.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  return { dateFrom: `${value}-01`, dateTo: `${value}-${String(last).padStart(2, '0')}` }
}
const MONTH_OPTIONS = lastMonthOptions(12)
const fmtRange = (a?: string, b?: string) => (a && b ? `${a.split('-').reverse().join('.')} — ${b.split('-').reverse().join('.')}` : '')

function Delta({ value, goodWhenUp = true, pp = false }: { value: number; goodWhenUp?: boolean; pp?: boolean }) {
  if (!value) return <span className="text-xs text-[#A1A1AA]">0{pp ? ' п.п.' : '%'}</span>
  const up = value > 0
  const color = up === goodWhenUp ? '#22C55E' : '#EF4444'
  const Icon = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="inline-flex items-center gap-0.5 text-xs font-medium" style={{ color }}>
      <Icon className="h-3 w-3" />{Math.abs(value).toFixed(1)}{pp ? ' п.п.' : '%'}
    </span>
  )
}
function Metric({ label, value, unit = '₸', delta, big = false }: { label: string; value: number; unit?: string; delta?: React.ReactNode; big?: boolean }) {
  return (
    <div className={`rounded-xl border ${C.border} ${C.card} p-4`}>
      <p className={`text-xs ${C.sub}`}>{label}</p>
      <p className={`mt-1 font-bold text-[#FAFAFA] ${big ? 'text-3xl' : 'text-2xl'}`}>{fmt(value)} {unit}</p>
      {delta ? <div className="mt-1">{delta}</div> : null}
    </div>
  )
}

const STATUS_STYLE: Record<string, { c: string; l: string }> = {
  'ФАКТ': { c: '#22C55E', l: 'ФАКТ' },
  'ОЦЕНКА': { c: '#3B82F6', l: 'ОЦЕНКА' },
  'ГИПОТЕЗА': { c: '#F59E0B', l: 'ГИПОТЕЗА' },
}
function Tag({ status }: { status: string }) {
  const s = STATUS_STYLE[(status || '').toUpperCase()] || STATUS_STYLE['ОЦЕНКА']
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-medium" style={{ background: `${s.c}1a`, color: s.c }}>{s.l}</span>
}

const BAND: Record<string, { c: string; l: string }> = {
  high: { c: '#22C55E', l: 'Высокая' }, medium: { c: '#F59E0B', l: 'Средняя' }, low: { c: '#EF4444', l: 'Низкая' },
}
const LEVEL: Record<string, { c: string; l: string }> = {
  critical: { c: '#EF4444', l: '🔴 Критический' }, high: { c: '#F97316', l: '🟠 Высокий' }, medium: { c: '#F59E0B', l: '🟡 Средний' }, low: { c: '#3B82F6', l: 'Низкий' },
}

export default function AiCfoPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sel, setSel] = useState('d90')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')

  const run = async (params: { days?: number; dateFrom?: string; dateTo?: string }, selKey: string) => {
    setLoading(true); setError(null); setSel(selKey)
    try {
      const res = await fetch('/api/ai/cfo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
      const j = await res.json()
      if (!res.ok || j?.error) throw new Error(j?.error || 'Ошибка')
      setData(j); setLoaded(true)
    } catch (e: any) { setError(e?.message || 'Ошибка') } finally { setLoading(false) }
  }
  useEffect(() => { run({ days: 90 }, 'd90') }, [])

  const ai = data?.ai
  const ex = data?.executive
  const dq = data?.dataQuality
  const band = ai?.dataQuality?.band || (dq ? (dq.percent >= 90 ? 'high' : dq.percent >= 70 ? 'medium' : 'low') : 'medium')

  return (
    <div className="app-page-wide space-y-5 text-[#FAFAFA]">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold"><Brain className="h-6 w-6 text-violet-400" /> AI Финдиректор</h1>
        <p className={`mt-1 text-sm ${C.sub}`}>
          Где теряете деньги, где заработать больше и что делать.
          {data ? <span className="ml-1 text-violet-300">· период {fmtRange(data.dateFrom, data.dateTo)}</span> : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {[7, 30, 90, 365].map((d) => (
          <button key={d} onClick={() => run({ days: d }, `d${d}`)} disabled={loading}
            className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-50 ${sel === `d${d}` ? 'border-violet-500/40 bg-violet-500/15 text-violet-200' : `${C.border} ${C.sub} hover:bg-white/[0.03]`}`}>
            {d} дн
          </button>
        ))}
        <select value={sel.startsWith('m:') ? sel.slice(2) : ''} onChange={(e) => { const v = e.target.value; if (v) run(monthRange(v), `m:${v}`) }} disabled={loading}
          className={`rounded-lg border ${C.border} bg-[#111113] px-3 py-1.5 text-sm ${C.sub} disabled:opacity-50`}>
          <option value="">Месяц…</option>
          {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <div className="flex items-center gap-1">
          <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className={`rounded-lg border ${C.border} bg-[#111113] px-2 py-1.5 text-sm ${C.sub}`} />
          <span className={C.sub}>—</span>
          <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className={`rounded-lg border ${C.border} bg-[#111113] px-2 py-1.5 text-sm ${C.sub}`} />
          <button onClick={() => { if (customFrom && customTo) run({ dateFrom: customFrom, dateTo: customTo }, 'custom') }} disabled={loading || !customFrom || !customTo}
            className={`rounded-lg border px-3 py-1.5 text-sm transition disabled:opacity-50 ${sel === 'custom' ? 'border-violet-500/40 bg-violet-500/15 text-violet-200' : `${C.border} ${C.sub} hover:bg-white/[0.03]`}`}>
            Период
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-[#EF4444]">{error}</p> : null}

      {loading && !loaded ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-[#A1A1AA]">
          <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
          <p className="text-sm">Финансовый директор анализирует период…</p>
        </div>
      ) : !data || !ex ? null : (
        <>
          {/* Качество данных */}
          {dq ? (
            <div className={`rounded-xl border ${C.border} ${C.card} flex flex-wrap items-center justify-between gap-3 p-4`}>
              <div className="flex items-center gap-3">
                <div>
                  <p className={`text-xs ${C.sub}`}>Качество данных</p>
                  <p className="text-lg font-bold" style={{ color: BAND[band]?.c }}>{dq.percent}% · {BAND[band]?.l}</p>
                </div>
                <div className={`text-xs ${C.sub}`}>
                  продажи {dq.salesCompleteness}% ({dq.daysWithSales}/{dq.daysInPeriod} дн) · расходы {dq.expenseCompleteness}%
                </div>
              </div>
              {ai?.dataQuality?.limitations?.length ? (
                <p className="max-w-md text-right text-[11px] text-[#F59E0B]">{ai.dataQuality.limitations.join(' · ')}</p>
              ) : null}
            </div>
          ) : null}

          {/* Executive Summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
            <Metric label="Прибыль" value={ex.profit} delta={<Delta value={ex.profitDeltaPct} />} big />
            <Metric label="Выручка" value={ex.revenue} delta={<Delta value={ex.revenueDeltaPct} />} />
            <Metric label="Маржа" value={ex.margin} unit="%" delta={<Delta value={ex.marginDeltaPp} pp />} />
            <Metric label="Расходы" value={ex.expenses} delta={<Delta value={ex.expensesDeltaPct} goodWhenUp={false} />} />
            <Metric label="Доля ФОТ" value={data.fotShare} unit="%" />
            <Metric label="Денежный поток" value={ex.cashflow} delta={<Delta value={ex.profitDeltaPct} />} />
          </div>

          {/* Состояние бизнеса */}
          {ai?.state ? (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-5">
              <p className="text-[15px] leading-relaxed">{ai.state}</p>
            </div>
          ) : null}

          {/* Итог одним экраном */}
          {ai?.summary ? (
            <div className="grid gap-3 md:grid-cols-3">
              <div className={`rounded-xl border ${C.border} ${C.card} p-4`}>
                <p className="text-xs font-medium text-[#EF4444]">Где теряем деньги</p>
                <p className="mt-1 text-sm">{ai.summary.where_losing}</p>
              </div>
              <div className={`rounded-xl border ${C.border} ${C.card} p-4`}>
                <p className="text-xs font-medium text-[#22C55E]">Где заработать больше</p>
                <p className="mt-1 text-sm">{ai.summary.where_earn}</p>
                {ai.summary.extra_profit ? <p className="mt-1 text-xs text-[#22C55E]">+{ai.summary.extra_profit}</p> : null}
              </div>
              <div className={`rounded-xl border ${C.border} ${C.card} p-4`}>
                <p className="text-xs font-medium text-[#F59E0B]">Главный риск</p>
                <p className="mt-1 text-sm">{ai.summary.main_risk}</p>
              </div>
            </div>
          ) : null}

          {ai?.summary?.three_actions?.length ? (
            <div className={`rounded-xl border ${C.border} ${C.card} p-5`}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Target className="h-4 w-4 text-violet-400" /> 3 действия с максимальным эффектом</h2>
              <ol className="space-y-2">
                {ai.summary.three_actions.map((a, i) => (<li key={i} className="flex gap-2 text-sm"><span className="text-violet-400">{i + 1}.</span>{a}</li>))}
              </ol>
            </div>
          ) : null}

          {/* Компании + рейтинг */}
          {data.companies.length > 0 ? (
            <div className={`rounded-xl border ${C.border} ${C.card} p-5`}>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Компании</h2>
                {data.ranking ? (
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {data.ranking.profitLeader ? <span className="rounded-md bg-[#22C55E]/10 px-2 py-0.5 text-[#22C55E]">🏆 Прибыль: {data.ranking.profitLeader}</span> : null}
                    {data.ranking.efficiencyLeader ? <span className="rounded-md bg-[#3B82F6]/10 px-2 py-0.5 text-[#3B82F6]">⚡ Маржа: {data.ranking.efficiencyLeader}</span> : null}
                    {data.ranking.worst ? <span className="rounded-md bg-[#EF4444]/10 px-2 py-0.5 text-[#EF4444]">⚠ Слабая: {data.ranking.worst}</span> : null}
                  </div>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {data.companies.map((c) => (
                  <div key={c.name} className={`rounded-lg border ${C.border} bg-black/20 p-4`}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{c.name}</span>
                      <span className={`text-xs ${C.sub}`}>{c.profitShare}% прибыли</span>
                    </div>
                    <p className="mt-2 text-2xl font-bold">{fmt(c.profit)} ₸</p>
                    <div className="mt-0.5"><Delta value={c.profitDeltaPct} /></div>
                    <div className={`mt-2 flex justify-between border-t ${C.border} pt-2 text-xs ${C.sub}`}>
                      <span>Выручка {fmt(c.revenue)}</span><span>Маржа {c.margin}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Что изменилось */}
          {(data.expenseChanges.length > 0 || ai?.changes?.length) ? (
            <div className={`rounded-xl border ${C.border} ${C.card} p-5`}>
              <h2 className="mb-3 text-sm font-semibold">Что изменилось</h2>
              {ai?.changes?.length ? (
                <ul className="mb-3 space-y-1.5">
                  {ai.changes.map((ch, i) => (<li key={i} className="flex items-start gap-2 text-sm"><Tag status={ch.status} /><span>{ch.text}</span></li>))}
                </ul>
              ) : null}
              {data.expenseChanges.length > 0 ? (
                <div className="space-y-1.5 border-t border-[#27272A] pt-3">
                  {data.expenseChanges.map((ch) => (
                    <div key={ch.label} className="flex items-center justify-between text-sm">
                      <span className={C.sub}>{ch.label}</span>
                      <span className="flex items-center gap-3"><span>{fmt(ch.current)} ₸</span><Delta value={ch.deltaPct} goodWhenUp={false} /></span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Корневые причины */}
          {ai?.rootCauses?.length ? (
            <div className={`rounded-xl border ${C.border} ${C.card} p-5`}>
              <h2 className="mb-3 text-sm font-semibold">Корневые причины</h2>
              <ul className="space-y-2">
                {ai.rootCauses.map((rc, i) => (<li key={i} className="flex items-start gap-2 text-sm"><Tag status={rc.status} /><span>{rc.text}</span></li>))}
              </ul>
            </div>
          ) : null}

          {/* Риски */}
          {ai?.risks?.length ? (
            <div className={`rounded-xl border ${C.border} ${C.card} p-5`}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="h-4 w-4 text-[#EF4444]" /> Основные риски</h2>
              <div className="space-y-2">
                {ai.risks.map((r, i) => (
                  <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#27272A] bg-black/20 px-3 py-2 text-sm">
                    <span className="flex-1">{r.risk}</span>
                    <span className={`text-xs ${C.sub}`}>вер. {r.probability} · влияние {r.impact}</span>
                    <span className="text-xs font-medium" style={{ color: LEVEL[r.level]?.c || '#F59E0B' }}>{LEVEL[r.level]?.l || r.level}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Возможности */}
          {ai?.opportunities?.length ? (
            <div>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold"><Lightbulb className="h-4 w-4 text-[#22C55E]" /> Возможности заработать</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {ai.opportunities.map((o, i) => (
                  <div key={i} className={`rounded-xl border ${C.border} ${C.card} p-4`}>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">{o.title}</h3>
                      <Tag status={o.status} />
                    </div>
                    <p className={`mt-1 text-xs ${C.sub}`}>{o.action}</p>
                    <p className="mt-2 text-sm font-medium text-[#22C55E]">{o.effect}</p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Прогноз */}
          {ai?.forecast ? (
            <div className={`rounded-xl border ${C.border} ${C.card} p-5`}>
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="h-4 w-4 text-violet-400" /> Прогноз
                <span className="text-[11px]" style={{ color: BAND[ai.forecast.band]?.c }}>уверенность: {BAND[ai.forecast.band]?.l || ai.forecast.band}</span>
              </h2>
              <p className="text-sm">{ai.forecast.text}</p>
              {ai.forecast.warning ? <p className="mt-2 flex items-center gap-1.5 text-xs text-[#F59E0B]"><AlertTriangle className="h-3.5 w-3.5" /> {ai.forecast.warning}</p> : null}
            </div>
          ) : null}

          {/* План действий */}
          {ai?.actionPlan ? (
            <div className={`rounded-xl border ${C.border} ${C.card} p-5`}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CalendarDays className="h-4 w-4 text-violet-400" /> План действий</h2>
              <div className="grid gap-4 md:grid-cols-3">
                {([['today', 'Сегодня'], ['week', 'На этой неделе'], ['month', 'В этом месяце']] as const).map(([k, label]) => {
                  const items = (ai.actionPlan as any)?.[k] as string[] | undefined
                  return (
                    <div key={k}>
                      <p className="mb-2 text-xs font-medium text-violet-300">{label}</p>
                      <ul className="space-y-1.5">
                        {(items || []).map((it, i) => (<li key={i} className={`text-sm ${C.sub}`}>• {it}</li>))}
                        {!items?.length ? <li className="text-xs text-[#52525B]">—</li> : null}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : null}

          {loading ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-violet-400" /></div> : null}
          {ai?.error ? <p className="text-xs text-[#F59E0B]">AI-анализ недоступен ({ai.error}), но цифры посчитаны.</p> : null}
        </>
      )}
    </div>
  )
}
