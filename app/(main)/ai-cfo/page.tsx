'use client'

import { useEffect, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Brain, Loader2, ShieldAlert, TrendingUp, TrendingDown, Lightbulb, Target, CalendarDays, RefreshCw } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DatePicker } from '@/components/ui/date-picker'

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
  healthScore?: { score: number; band: string; breakdown?: Record<string, number>; missing?: string[] } | null
  dataQuality?: { percent: number; band: string; notes?: string[]; limitations?: string[] }
  changes?: Tagged[]
  rootCauses?: Tagged[]
  risks?: Array<{ risk: string; probability: string; impact: string; level: string }>
  losses?: Array<{ text: string; amount: string; status: string }>
  missedProfit?: Array<{ text: string; potential: string; status: string }>
  opportunities?: Array<{ title: string; action: string; effect: string; status: string }>
  actionPlan?: { today?: string[]; week?: string[]; month?: string[] }
  forecast?: { band: string; text: string; base?: string; optimistic?: string; pessimistic?: string; warning: string | null } | null
  scenarios?: Array<{ name: string; assumption: string; effect: string; note: string; status: string }>
  summary?: { where_losing: string; where_earn: string; main_risk: string; main_opportunity: string; extra_profit: string; three_actions: string[] } | null
  error?: string
}
type CostStructure = {
  variableExpenses: number; fixedExpenses: number; capex: number; incomeTax: number; profitDistribution: number
  contributionRatePct: number; breakevenRevenue: number; safetyMarginPct: number; operatingProfit: number
}
type Resp = {
  days: number; dateFrom: string; dateTo: string
  executive: Exec; companies: Company[]; ranking: Ranking; expenseChanges: Change[]
  fot: number; fotShare: number; concentrationPct?: number
  costStructure?: CostStructure
  dataQuality: { percent: number; daysInPeriod: number; daysWithSales: number; salesCompleteness: number; daysWithExpenses: number; expenseCompleteness: number }
  ai: AI
}

const fmt = (v: number) => new Intl.NumberFormat('ru-RU').format(Math.round(v || 0))
const money = (v: number) => fmt(v) + ' ₸'
// Убираем шум [ФАКТ]/[ОЦЕНКА]/[ГИПОТЕЗА] из текста
const clean = (s?: string | null) => String(s || '').replace(/\[(ФАКТ|ОЦЕНКА|ГИПОТЕЗА)\]\s*/gi, '').trim()
// Первая фраза — для «коротко»
const firstSentence = (s?: string | null) => { const c = clean(s); const i = c.search(/[.!?]\s/); return i > 0 ? c.slice(0, i + 1) : c }

const C = { card: 'bg-white dark:bg-[#111113]', border: 'border-slate-200 dark:border-[#27272A]', sub: 'text-slate-500 dark:text-[#A1A1AA]' }
const cardCls = `rounded-xl border ${C.border} ${C.card} p-5`

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
  if (!value) return <span className="text-xs text-slate-500 dark:text-[#A1A1AA]">0{pp ? ' п.п.' : '%'}</span>
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
      <p className={`mt-1 font-bold text-slate-900 dark:text-[#FAFAFA] ${big ? 'text-2xl' : 'text-xl'}`}>{fmt(value)} {unit}</p>
      {delta ? <div className="mt-1">{delta}</div> : null}
    </div>
  )
}

const LEVEL: Record<string, { c: string; l: string }> = {
  critical: { c: '#EF4444', l: 'Критический' }, high: { c: '#F97316', l: 'Высокий' }, medium: { c: '#F59E0B', l: 'Средний' }, low: { c: '#3B82F6', l: 'Низкий' },
}

export default function AiCfoPage() {
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [sel, setSel] = useState('d90')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [lastParams, setLastParams] = useState<{ days?: number; dateFrom?: string; dateTo?: string }>({ days: 90 })
  const [cached, setCached] = useState(false)
  const [tab, setTab] = useState<'money' | 'risks' | 'companies' | 'plan'>('money')
  const [showCustom, setShowCustom] = useState(false)

  const run = async (params: { days?: number; dateFrom?: string; dateTo?: string }, selKey: string, force = false) => {
    setSel(selKey); setLastParams(params)
    const key = 'orda.cfo.cache.v1.' + JSON.stringify(params)
    if (!force) {
      try {
        const raw = sessionStorage.getItem(key)
        if (raw) {
          const c = JSON.parse(raw)
          if (c?.data && Date.now() - c.ts < 3 * 3600 * 1000) {
            setData(c.data); setLoaded(true); setError(null); setCached(true); return
          }
        }
      } catch {}
    }
    setLoading(true); setError(null); setCached(false)
    try {
      const res = await fetch('/api/ai/cfo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(params) })
      const j = await res.json()
      if (!res.ok || j?.error) throw new Error(j?.error || 'Ошибка')
      setData(j); setLoaded(true)
      try { sessionStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: j })) } catch {}
    } catch (e: any) { setError(e?.message || 'Ошибка') } finally { setLoading(false) }
  }
  useEffect(() => { run({ days: 90 }, 'd90') }, [])

  const ai = data?.ai
  const ex = data?.executive
  const cs = data?.costStructure
  const sm = ai?.summary

  return (
    <div className="app-page-wide space-y-5 text-slate-900 dark:text-[#FAFAFA]">
      <AdminPageHeader
        title="AI Финдиректор"
        description="Где теряете деньги, где заработать больше и что делать."
        icon={<Brain className="h-5 w-5" />}
        accent="violet"
        backHref="/"
        actions={
          <button onClick={() => run(lastParams, sel, true)} disabled={loading}
            className={`inline-flex items-center gap-1.5 rounded-lg border ${C.border} px-3 py-1.5 text-sm ${C.sub} transition hover:bg-slate-100 dark:hover:bg-white/[0.03] disabled:opacity-50`}>
            <RefreshCw className="h-3.5 w-3.5" /> Обновить
          </button>
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-3">
            {/* Сегментированные пресеты */}
            <div className="inline-flex items-center rounded-xl border border-slate-200 dark:border-white/10 bg-slate-100 dark:bg-white/[0.03] p-0.5">
              {[7, 30, 90, 365].map((d) => (
                <button key={d} onClick={() => { setShowCustom(false); run({ days: d }, `d${d}`) }} disabled={loading}
                  className={`rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${sel === `d${d}` ? 'bg-violet-500 text-white shadow-sm' : `${C.sub} hover:text-slate-900 dark:hover:text-white`}`}>
                  {d} дн
                </button>
              ))}
            </div>

            {/* Месяц */}
            <select value={sel.startsWith('m:') ? sel.slice(2) : ''} onChange={(e) => { const v = e.target.value; if (v) { setShowCustom(false); run(monthRange(v), `m:${v}`) } }} disabled={loading}
              className={`rounded-xl border ${sel.startsWith('m:') ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-200' : `${C.border} bg-white dark:bg-[#111113] ${C.sub}`} px-3 py-1.5 text-sm font-medium disabled:opacity-50 cursor-pointer`}>
              <option value="">Месяц…</option>
              {MONTH_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>

            {/* Свой период — кнопка-тоггл */}
            <button onClick={() => setShowCustom((v) => !v)} disabled={loading}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${showCustom || sel === 'custom' ? 'border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-200' : `${C.border} ${C.sub} hover:bg-slate-100 dark:hover:bg-white/[0.03]`}`}>
              <CalendarDays className="h-3.5 w-3.5" /> Свой период
            </button>

            {/* Период текстом */}
            {(data || cached) ? (
              <p className={`text-xs ${C.sub} ml-auto`}>
                {data ? <span className="text-violet-600 dark:text-violet-300">{fmtRange(data.dateFrom, data.dateTo)}</span> : null}
                {cached ? <span className="ml-1">· из кэша</span> : null}
              </p>
            ) : null}

            {/* Раскрывающийся выбор дат */}
            {showCustom ? (
              <div className="flex w-full items-center gap-2">
                <DatePicker value={customFrom} onChange={setCustomFrom} max={customTo || undefined} />
                <span className={C.sub}>—</span>
                <DatePicker value={customTo} onChange={setCustomTo} min={customFrom || undefined} />
                <button onClick={() => { if (customFrom && customTo) run({ dateFrom: customFrom, dateTo: customTo }, 'custom') }} disabled={loading || !customFrom || !customTo}
                  className="rounded-xl bg-violet-500 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-violet-600 disabled:opacity-40">
                  Применить
                </button>
              </div>
            ) : null}
          </div>
        }
      />

      {error ? <p className="text-sm text-[#EF4444]">{error}</p> : null}

      {loading && !loaded ? (
        <div className="flex flex-col items-center justify-center gap-3 py-20 text-slate-500 dark:text-[#A1A1AA]">
          <Loader2 className="h-7 w-7 animate-spin text-violet-400" />
          <p className="text-sm">Финансовый директор анализирует период…</p>
        </div>
      ) : !data || !ex ? null : (
        <div className={loading ? 'space-y-5 opacity-40 transition-opacity' : 'space-y-5'}>

          {/* ВЕРДИКТ */}
          <div className="rounded-2xl border border-violet-200 dark:border-violet-500/20 bg-gradient-to-br from-violet-50 via-white to-white dark:from-violet-900/20 dark:via-[#111113] dark:to-[#111113] p-5">
            <div className="flex flex-wrap items-center gap-4">
              {ai?.healthScore ? (
                <div className="shrink-0">
                  <p className={`text-xs ${C.sub}`}>Здоровье бизнеса</p>
                  <p className="text-4xl font-bold tabular-nums" style={{ color: ai.healthScore.score >= 80 ? '#22C55E' : ai.healthScore.score >= 60 ? '#F59E0B' : '#EF4444' }}>{ai.healthScore.score}<span className="text-lg text-slate-400">/100</span></p>
                  <p className="text-xs font-medium" style={{ color: ai.healthScore.score >= 80 ? '#22C55E' : ai.healthScore.score >= 60 ? '#F59E0B' : '#EF4444' }}>
                    {ai.healthScore.band === 'healthy' ? 'Здоровый' : ai.healthScore.band === 'attention' ? 'Требует внимания' : 'Проблемный'}
                  </p>
                </div>
              ) : null}
              <div className="min-w-[240px] flex-1">
                <p className="text-sm leading-relaxed text-slate-700 dark:text-slate-200">
                  {firstSentence(sm?.where_earn) && firstSentence(sm?.where_losing)
                    ? `За период прибыль ${money(ex.profit)} при выручке ${money(ex.revenue)}, маржа ${ex.margin.toFixed(0)}%.`
                    : `Прибыль ${money(ex.profit)}, выручка ${money(ex.revenue)}, маржа ${ex.margin.toFixed(0)}%.`}
                </p>
              </div>
            </div>
          </div>

          {/* ГЛАВНОЕ СЕЙЧАС */}
          {sm ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <MainCard tone="rose" icon={<TrendingDown className="h-4 w-4" />} title="Где теряем деньги" text={firstSentence(sm.where_losing)} />
              <MainCard tone="emerald" icon={<TrendingUp className="h-4 w-4" />} title="Где заработать больше" text={firstSentence(sm.where_earn)} extra={sm.extra_profit ? `+${clean(sm.extra_profit)}` : undefined} />
              <MainCard tone="amber" icon={<ShieldAlert className="h-4 w-4" />} title="Главный риск" text={firstSentence(sm.main_risk)} />
            </div>
          ) : null}

          {/* ЧТО ДЕЛАТЬ */}
          {sm?.three_actions?.length ? (
            <div className={cardCls}>
              <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Target className="h-4 w-4 text-violet-500" />Что делать в первую очередь</h3>
              <ol className="space-y-2.5">
                {sm.three_actions.slice(0, 3).map((a, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-violet-500 text-xs font-bold text-white">{i + 1}</span>
                    <span className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{clean(a)}</span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {/* KPI */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <Metric label="Прибыль" value={ex.profit} delta={<Delta value={ex.profitDeltaPct} />} />
            <Metric label="Выручка" value={ex.revenue} delta={<Delta value={ex.revenueDeltaPct} />} />
            <Metric label="Маржа" value={ex.margin} unit="%" delta={<Delta value={ex.marginDeltaPp} pp />} />
            <Metric label="Расходы" value={ex.expenses} delta={<Delta value={ex.expensesDeltaPct} goodWhenUp={false} />} />
            <Metric label="Доля ФОТ" value={data.fotShare} unit="%" />
            <Metric label="Денежный поток" value={ex.cashflow} />
          </div>

          {/* ВКЛАДКИ */}
          <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-white/8 pb-px">
            {([['money', '💰 Деньги'], ['risks', '⚠️ Риски'], ['companies', '🏪 Точки'], ['plan', '📅 План']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`rounded-t-lg px-4 py-2 text-sm font-medium transition ${tab === k ? 'bg-violet-500/15 text-violet-700 dark:text-violet-200 border-b-2 border-violet-500' : `${C.sub} hover:text-slate-900 dark:hover:text-white`}`}>
                {l}
              </button>
            ))}
          </div>

          {/* ── Деньги ── */}
          {tab === 'money' && (
            <div className="space-y-4">
              {cs ? (
                <div className={cardCls}>
                  <h3 className="mb-4 text-sm font-semibold">Структура и устойчивость</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                    <Cell label="Безубыточность" value={money(cs.breakevenRevenue)} />
                    <Cell label="Запас прочности" value={`${cs.safetyMarginPct.toFixed(0)}%`} tone={cs.safetyMarginPct >= 0 ? 'emerald' : 'rose'} />
                    <Cell label="Операц. прибыль" value={money(cs.operatingProfit)} />
                    <Cell label="Постоянные" value={money(cs.fixedExpenses)} />
                    <Cell label="Переменные" value={money(cs.variableExpenses)} />
                    <Cell label="CAPEX / разовые" value={money(cs.capex)} />
                  </div>
                </div>
              ) : null}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {ai?.losses?.length ? (
                  <ListCard icon={<TrendingDown className="h-4 w-4 text-rose-500" />} title="Где утекают деньги"
                    items={ai.losses.map((l) => ({ amount: clean(l.amount), text: firstSentence(l.text), tone: 'rose' as const }))} />
                ) : null}
                {ai?.missedProfit?.length ? (
                  <ListCard icon={<TrendingUp className="h-4 w-4 text-emerald-500" />} title="Упущенная прибыль"
                    items={ai.missedProfit.map((l) => ({ amount: clean(l.potential), text: firstSentence(l.text), tone: 'emerald' as const }))} />
                ) : null}
              </div>

              {ai?.opportunities?.length ? (
                <div className={cardCls}>
                  <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><Lightbulb className="h-4 w-4 text-amber-500" />Возможности заработать</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ai.opportunities.map((o, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 dark:border-white/8 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{clean(o.title)}</p>
                          {o.effect ? <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">+{clean(o.effect)}</span> : null}
                        </div>
                        <p className={`mt-1 text-xs ${C.sub}`}>{firstSentence(o.action)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {data.expenseChanges?.length ? (
                <div className={cardCls}>
                  <h3 className="mb-3 text-sm font-semibold">Что изменилось в расходах</h3>
                  <div className="space-y-1.5">
                    {data.expenseChanges.slice(0, 8).map((c, i) => (
                      <div key={i} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-700 dark:text-slate-300 truncate">{c.label}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className="tabular-nums text-slate-900 dark:text-white">{money(c.current)}</span>
                          <Delta value={c.deltaPct} goodWhenUp={false} />
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {/* ── Риски ── */}
          {tab === 'risks' && (
            <div className="space-y-4">
              {ai?.risks?.length ? (
                <div className={cardCls}>
                  <h3 className="mb-3 text-sm font-semibold flex items-center gap-2"><ShieldAlert className="h-4 w-4 text-rose-500" />Основные риски</h3>
                  <div className="space-y-2">
                    {ai.risks.map((r, i) => {
                      const lv = LEVEL[(r.level || '').toLowerCase()] || LEVEL.medium
                      return (
                        <div key={i} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 dark:border-white/8 p-3">
                          <p className="text-sm text-slate-700 dark:text-slate-200 leading-relaxed">{firstSentence(r.risk)}</p>
                          <span className="shrink-0 rounded-md px-2 py-0.5 text-[11px] font-medium" style={{ color: lv.c, backgroundColor: lv.c + '22' }}>{lv.l}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : null}
              {ai?.rootCauses?.length ? (
                <div className={cardCls}>
                  <h3 className="mb-3 text-sm font-semibold">Корневые причины</h3>
                  <ul className="space-y-2">
                    {ai.rootCauses.map((c, i) => (
                      <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
                        <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-slate-400" />
                        <span>{firstSentence(c.text)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          )}

          {/* ── Точки ── */}
          {tab === 'companies' && (
            <div className={cardCls}>
              <h3 className="mb-4 text-sm font-semibold">Точки</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.companies.map((c, i) => (
                  <div key={i} className="rounded-lg border border-slate-200 dark:border-white/8 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{c.name}</p>
                      <span className={`text-xs ${C.sub}`}>{c.profitShare.toFixed(0)}% прибыли</span>
                    </div>
                    <p className={`mt-1 text-xl font-bold tabular-nums ${c.profit >= 0 ? 'text-slate-900 dark:text-white' : 'text-rose-600 dark:text-rose-400'}`}>{money(c.profit)}</p>
                    <div className="mt-1"><Delta value={c.profitDeltaPct} /></div>
                    <div className={`mt-2 flex items-center justify-between text-xs ${C.sub}`}>
                      <span>Выручка {fmt(c.revenue)}</span>
                      <span>Маржа {c.margin.toFixed(0)}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── План ── */}
          {tab === 'plan' && (
            <div className="space-y-4">
              {ai?.actionPlan ? (
                <div className={cardCls}>
                  <h3 className="mb-4 text-sm font-semibold flex items-center gap-2"><CalendarDays className="h-4 w-4 text-violet-500" />План действий</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {([['Сегодня', ai.actionPlan.today], ['На этой неделе', ai.actionPlan.week], ['В этом месяце', ai.actionPlan.month]] as const).map(([t, arr]) => (
                      <div key={t}>
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-violet-600 dark:text-violet-300">{t}</p>
                        <ul className="space-y-1.5">
                          {(arr || []).map((x, i) => (
                            <li key={i} className="flex gap-2 text-sm text-slate-700 dark:text-slate-300">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-violet-400" /><span>{firstSentence(x)}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {ai?.forecast ? (
                <div className={cardCls}>
                  <h3 className="mb-2 text-sm font-semibold flex items-center gap-2"><TrendingUp className="h-4 w-4 text-violet-500" />Прогноз прибыли (30 дней)</h3>
                  <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{firstSentence(ai.forecast.text)}</p>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                    <ForecastCell label="Пессимистичный" value={ai.forecast.pessimistic} tone="rose" />
                    <ForecastCell label="Базовый" value={ai.forecast.base} tone="slate" />
                    <ForecastCell label="Оптимистичный" value={ai.forecast.optimistic} tone="emerald" />
                  </div>
                </div>
              ) : null}

              {ai?.scenarios?.length ? (
                <div className={cardCls}>
                  <h3 className="mb-3 text-sm font-semibold">Сценарии «что если»</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {ai.scenarios.map((s, i) => (
                      <div key={i} className="rounded-lg border border-slate-200 dark:border-white/8 p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-semibold">{clean(s.name)}</p>
                          {s.effect ? <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">{clean(s.effect)}</span> : null}
                        </div>
                        <p className={`mt-1 text-xs ${C.sub}`}>{firstSentence(s.assumption)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {loading ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-violet-400" /></div> : null}
          {ai?.error ? <p className="text-xs text-[#F59E0B]">AI-анализ недоступен ({ai.error}), но цифры посчитаны.</p> : null}
        </div>
      )}
    </div>
  )
}

function MainCard({ tone, icon, title, text, extra }: { tone: 'rose' | 'emerald' | 'amber'; icon: React.ReactNode; title: string; text: string; extra?: string }) {
  const map = { rose: 'text-rose-600 dark:text-rose-400', emerald: 'text-emerald-600 dark:text-emerald-400', amber: 'text-amber-600 dark:text-amber-400' }
  return (
    <div className={cardCls}>
      <div className={`flex items-center gap-2 text-sm font-semibold ${map[tone]}`}>{icon}{title}</div>
      <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{text || '—'}</p>
      {extra ? <p className={`mt-2 text-base font-bold ${map[tone]} tabular-nums`}>{extra}</p> : null}
    </div>
  )
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'rose' }) {
  return (
    <div>
      <p className={`text-xs ${C.sub}`}>{label}</p>
      <p className={`mt-0.5 font-semibold tabular-nums ${tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  )
}

function ListCard({ icon, title, items }: { icon: React.ReactNode; title: string; items: Array<{ amount: string; text: string; tone: 'rose' | 'emerald' }> }) {
  return (
    <div className={cardCls}>
      <h3 className="mb-3 text-sm font-semibold flex items-center gap-2">{icon}{title}</h3>
      <div className="space-y-3">
        {items.map((it, i) => (
          <div key={i}>
            {it.amount ? <p className={`text-sm font-bold tabular-nums ${it.tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>{it.amount}</p> : null}
            <p className={`text-xs ${C.sub} leading-relaxed`}>{it.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ForecastCell({ label, value, tone }: { label: string; value?: string; tone: 'rose' | 'emerald' | 'slate' }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-white/8 py-2">
      <p className={`text-[11px] ${C.sub}`}>{label}</p>
      <p className={`text-sm font-bold tabular-nums ${tone === 'rose' ? 'text-rose-600 dark:text-rose-400' : tone === 'emerald' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>{value ? clean(value) : '—'}</p>
    </div>
  )
}
