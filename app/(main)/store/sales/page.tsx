'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { useStoreScope } from '@/components/store/store-scope'
import {
  Activity, RefreshCw, Loader2, TrendingUp, Receipt,
  Clock, Trophy, Pause, Play, Users, Tags, Coins, Package, Search, AlertTriangle,
  RotateCcw, Truck,
} from 'lucide-react'

const REFRESH_MS = 12_000

const embFallback = () => <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
const AbcEmbed = dynamic(() => import('@/app/(main)/store/abc/page'), { ssr: false, loading: embFallback })
const ForecastEmbed = dynamic(() => import('@/app/(main)/inventory/forecast/page').then((m) => m.InventoryForecastPageContent), { ssr: false, loading: embFallback })
const PointsEmbed = dynamic(() => import('@/app/(main)/store/analytics/page'), { ssr: false, loading: embFallback })

// ── Монитор ──
type Totals = { amount: number; count: number; avg_check: number; cash: number; cashless: number; net_profit: number }
type ByCompany = { company_id: string; name: string; amount: number; count: number; avg_check: number }
type ByHour = { hour: number; amount: number; count: number }
type ByDay = { date: string; amount: number; count: number }
type TopItem = { name: string; qty: number; revenue: number }
type Recent = { id: string; sold_at: string; company_name: string; operator_name: string; total_amount: number; payment_method: string; items: string[]; items_count: number }
type ByOperator = { name: string; amount: number; count: number; avg_check: number }
type ByCategory = { name: string; qty: number; revenue: number }
type MonData = {
  totals: Totals
  returns: { amount: number; count: number }
  receipts: { amount: number; count: number }
  prev: { amount: number; delta_pct: number | null }
  last_hour: { amount: number; count: number }
  payment: { cash: number; kaspi: number; card: number; online: number }
  by_company: ByCompany[]
  by_operator: ByOperator[]
  by_category: ByCategory[]
  by_hour: ByHour[]
  by_day: ByDay[]
  top_items: TopItem[]
  recent: Recent[]
}

// ── Товары ──
type Item = {
  item_id: string; name: string; barcode: string; unit: string; category: string | null
  qty: number; revenue: number; profit: number; margin_percent: number; stock: number
  sale_price: number; purchase_price: number
}
type ProdData = {
  items: Item[]
  sales_totals: { revenue: number; profit: number; qty: number }
  stock_totals: { possible_sales: number; possible_profit: number; purchase_sum: number; total_qty: number; items_count: number }
  no_cost?: { sold: number; stock: number }
}
type Company = { id: string; name: string }
type Tab = 'monitor' | 'best' | 'profit' | 'stock' | 'abc' | 'forecast' | 'points'

const card = 'rounded-2xl border border-white/10 bg-slate-900/60 shadow-lg shadow-black/20'
const inputCls = 'rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white placeholder-slate-500 [color-scheme:dark] focus:border-emerald-400/50 focus:outline-none'
const PAY_LABEL: Record<string, string> = { cash: 'Нал', kaspi: 'Безнал', card: 'Карта', online: 'Онлайн', mixed: 'Смеш.' }
const PAY_CHIP: Record<string, string> = {
  cash: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  kaspi: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  card: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
  online: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
  mixed: 'bg-slate-500/15 text-slate-300 border-slate-400/30',
}
const fmt = (n: number) => Number(n || 0).toLocaleString('ru-RU')
const pad2 = (n: number) => String(n).padStart(2, '0')
const almatyDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' })
const dateMinus = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return almatyDate(d) }

const TABS: { key: Tab; label: string }[] = [
  { key: 'monitor', label: 'Монитор' },
  { key: 'best', label: 'Продаваемые' },
  { key: 'profit', label: 'Доходные' },
  { key: 'stock', label: 'Остатки' },
  { key: 'abc', label: 'ABC' },
  { key: 'forecast', label: 'Прогноз' },
  { key: 'points', label: 'Аналитика точек' },
]
const EMBED_TABS: Tab[] = ['abc', 'forecast', 'points']

export default function SalesMonitorPage() {
  const today = almatyDate()

  const [tab, setTab] = useState<Tab>('monitor')
  const [preset, setPreset] = useState<'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'>('today')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [companyId, setCompanyId] = useState('')
  const { storeCompanyId } = useStoreScope()
  const [companies, setCompanies] = useState<Company[]>([])
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')

  const [mon, setMon] = useState<MonData | null>(null)
  const [prod, setProd] = useState<ProdData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [, forceTick] = useState(0)
  const seenIds = useRef<Set<string>>(new Set())
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())

  const isToday = to === today
  const isEmbed = EMBED_TABS.includes(tab)
  const isProduct = tab === 'best' || tab === 'profit' || tab === 'stock'

  function applyPreset(p: typeof preset) {
    setPreset(p)
    if (p === 'today') { setFrom(today); setTo(today) }
    else if (p === 'yesterday') { setFrom(dateMinus(1)); setTo(dateMinus(1)) }
    else if (p === '7d') { setFrom(dateMinus(6)); setTo(today) }
    else if (p === '30d') { setFrom(dateMinus(29)); setTo(today) }
    else if (p === 'month') { setFrom(`${today.slice(0, 7)}-01`); setTo(today) }
  }

  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' }).then((r) => r.json()).then((j) => setCompanies(j.data || [])).catch(() => {})
  }, [])

  const loadMonitor = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ from, to }); if (companyId) p.set('company_id', companyId)
      const res = await fetch(`/api/admin/sales-monitor?${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка загрузки')
      const next = j.data as MonData
      const prevSeen = seenIds.current
      const fresh = new Set<string>()
      for (const r of next.recent) if (!prevSeen.has(r.id)) fresh.add(r.id)
      if (prevSeen.size > 0 && fresh.size > 0) { setFlashIds(fresh); setTimeout(() => setFlashIds(new Set()), 2500) }
      seenIds.current = new Set(next.recent.map((r) => r.id))
      setMon(next)
      setLastUpdated(Date.now())
    } catch (e: any) { setError(e?.message || 'Ошибка') } finally { setLoading(false) }
  }, [from, to, companyId])

  const loadProducts = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const p = new URLSearchParams({ from, to }); if (companyId) p.set('company_id', companyId)
      const res = await fetch(`/api/admin/product-analytics?${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка загрузки')
      setProd(j.data as ProdData)
    } catch (e: any) { setError(e?.message || 'Ошибка') } finally { setLoading(false) }
  }, [from, to, companyId])

  // Загрузка по активной вкладке (встраиваемые аналитики грузят себя сами)
  useEffect(() => {
    if (EMBED_TABS.includes(tab)) return
    if (tab === 'monitor') { seenIds.current = new Set(); loadMonitor() }
    else loadProducts()
  }, [tab, loadMonitor, loadProducts])

  // Авто-обновление монитора (только сегодня)
  useEffect(() => {
    if (tab !== 'monitor' || !live || !isToday) return
    const id = setInterval(() => loadMonitor(true), REFRESH_MS)
    return () => clearInterval(id)
  }, [tab, live, isToday, loadMonitor])

  useEffect(() => { const id = setInterval(() => forceTick((t) => t + 1), 1000); return () => clearInterval(id) }, [])
  const agoSec = lastUpdated ? Math.floor((Date.now() - lastUpdated) / 1000) : null

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Монитор продаж"
        description="Продажи и аналитика в реальном времени"
        icon={<Activity className="h-5 w-5" />}
        accent="blue"
        backHref="/"
        actions={
          <>
            {tab === 'monitor' && isToday && (
              <button
                onClick={() => setLive((v) => !v)}
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${live ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
              >
                {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {live ? 'Авто' : 'Пауза'}
              </button>
            )}
            <button onClick={() => (tab === 'monitor' ? loadMonitor() : loadProducts())} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Обновить
            </button>
          </>
        }
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-slate-950/50 p-1">
            {TABS.map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)} className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${tab === key ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10' : 'text-slate-400 hover:text-white'}`}>
                {label}
              </button>
            ))}
          </div>
        }
      />

      {/* Период + фильтры (для встроенных аналитик — у них свои фильтры) */}
      {!isEmbed && (
      <div className="flex flex-wrap items-center gap-2">
        {([['today', 'Сегодня'], ['yesterday', 'Вчера'], ['7d', '7 дней'], ['30d', '30 дней'], ['month', 'Месяц']] as const).map(([k, lbl]) => (
          <button
            key={k}
            onClick={() => applyPreset(k)}
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${preset === k ? 'border-sky-400/40 bg-sky-500/15 text-sky-200' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'}`}
          >
            {lbl}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <input type="date" value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPreset('custom') }} className={inputCls} />
          <span className="text-slate-500">—</span>
          <input type="date" value={to} max={today} onChange={(e) => { setTo(e.target.value); setPreset('custom') }} className={inputCls} />
        </div>
        {!storeCompanyId && (
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputCls}>
            <option value="">Все точки</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {isProduct && (
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по товару, артикулу…" className={`${inputCls} w-full pl-9`} />
          </div>
        )}
      </div>
      )}

      {/* Статус (только монитор) */}
      {tab === 'monitor' && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          {isToday ? (
            <>
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${live ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5'}`}>
                <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`} />
                {live ? 'В реальном времени' : 'На паузе'}
              </span>
              {agoSec !== null && <span>обновлено {agoSec < 5 ? 'только что' : `${agoSec} с назад`}</span>}
            </>
          ) : (
            <span>Период: {from === to ? from : `${from} — ${to}`}</span>
          )}
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</div>}

      {tab === 'abc' ? <AbcEmbed embedded /> :
       tab === 'forecast' ? <ForecastEmbed embedded /> :
       tab === 'points' ? <PointsEmbed embedded /> :
       tab === 'monitor'
        ? <MonitorView data={mon} loading={loading} flashIds={flashIds} />
        : <ProductView data={prod} loading={loading} tab={tab} category={category} setCategory={setCategory} q={q} />}
    </div>
  )
}

// ───────────────────────── Монитор ─────────────────────────
function MonitorView({ data, loading, flashIds }: { data: MonData | null; loading: boolean; flashIds: Set<string> }) {
  const t = data?.totals
  const maxHour = useMemo(() => Math.max(1, ...(data?.by_hour.map((h) => h.amount) || [1])), [data])
  const useDaily = (data?.by_day?.length || 0) > 1
  const maxDay = useMemo(() => Math.max(1, ...(data?.by_day?.map((d) => d.amount) || [1])), [data])
  const maxOperator = useMemo(() => Math.max(1, ...(data?.by_operator.map((o) => o.amount) || [1])), [data])
  const maxCategory = useMemo(() => Math.max(1, ...(data?.by_category.map((c) => c.revenue) || [1])), [data])

  if (loading && !data) return <Loading />
  if (!data) return null

  return (
    <>
      {/* 3 верхние карточки: Продажи / Возврат / Приёмка */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Продажи" icon={<TrendingUp className="h-4 w-4" />} color="text-emerald-300" amount={t!.amount} count={t!.count} delta={data.prev.delta_pct} />
        <StatCard label="Возврат" icon={<RotateCcw className="h-4 w-4" />} color="text-rose-300" amount={data.returns.amount} count={data.returns.count} />
        <StatCard label="Приёмка" icon={<Truck className="h-4 w-4" />} color="text-sky-300" amount={data.receipts.amount} count={data.receipts.count} />
      </div>

      {/* График по часам + сетка KPI */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className={`${card} p-4 lg:col-span-2`}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Clock className="h-4 w-4 text-sky-300" /> Продажи {useDaily ? 'по дням' : 'по часам'}</div>
          {(t!.amount === 0) ? (
            <div className="flex h-44 items-center justify-center text-sm text-slate-500">Нет данных для отображения</div>
          ) : useDaily ? (
            <div className="flex h-44 gap-1">{data.by_day.map((d) => {
              const pct = d.amount > 0 ? Math.max(3, Math.round((d.amount / maxDay) * 100)) : 0
              const peak = d.amount === maxDay && d.amount > 0
              const label = `${d.date.slice(8, 10)}.${d.date.slice(5, 7)}`
              return (
                <div key={d.date} className="flex min-w-0 flex-1 flex-col justify-end gap-1" title={`${label} — ${fmt(d.amount)} ₸ · ${d.count} продаж`}>
                  <div className="flex flex-1 items-end"><div className={`w-full rounded-t transition-all ${peak ? 'bg-sky-400' : 'bg-sky-400/50'}`} style={{ height: `${pct}%` }} /></div>
                  <div className="truncate text-center text-[9px] text-slate-500">{label}</div>
                </div>
              )
            })}</div>
          ) : (
            <div className="flex h-44 gap-1">{(data.by_hour || []).map((h) => {
              const pct = h.amount > 0 ? Math.max(3, Math.round((h.amount / maxHour) * 100)) : 0
              const peak = h.amount === maxHour && h.amount > 0
              return (
                <div key={h.hour} className="flex min-w-0 flex-1 flex-col justify-end gap-1" title={`${pad2(h.hour)}:00 — ${fmt(h.amount)} ₸ · ${h.count} продаж`}>
                  <div className="flex flex-1 items-end"><div className={`w-full rounded-t transition-all ${peak ? 'bg-sky-400' : 'bg-sky-400/40'}`} style={{ height: `${pct}%` }} /></div>
                  <div className="text-center text-[9px] text-slate-500">{pad2(h.hour)}</div>
                </div>
              )
            })}</div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Выручка" value={`${fmt(t!.amount)} ₸`} icon={<TrendingUp className="h-4 w-4" />} accent="text-emerald-300" />
          <Kpi label="Чистая прибыль" value={`${fmt(t!.net_profit)} ₸`} icon={<Coins className="h-4 w-4" />} accent={t!.net_profit >= 0 ? 'text-emerald-300' : 'text-rose-300'} />
          <Kpi label="Средний чек" value={`${fmt(t!.avg_check)} ₸`} icon={<Activity className="h-4 w-4" />} accent="text-white" />
          <Kpi label="За последний час" value={`${fmt(data.last_hour.amount)} ₸`} sub={`${data.last_hour.count} продаж`} icon={<Clock className="h-4 w-4" />} accent="text-amber-300" />
        </div>
      </div>

      {/* По сотрудникам + По категориям */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`${card} p-4`}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Users className="h-4 w-4 text-violet-300" /> По сотрудникам</div>
          {data.by_operator.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">Нет данных</div> : (
            <div className="space-y-2.5">{data.by_operator.map((o) => (
              <div key={o.name}>
                <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate text-slate-200">{o.name}</span><span className="shrink-0 font-semibold tabular-nums text-emerald-300">{fmt(o.amount)} ₸</span></div>
                <div className="mt-1 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-violet-400/70" style={{ width: `${Math.round((o.amount / maxOperator) * 100)}%` }} /></div><span className="shrink-0 text-[11px] text-slate-500">{o.count} продаж · ср. {fmt(o.avg_check)} ₸</span></div>
              </div>
            ))}</div>
          )}
        </div>
        <div className={`${card} p-4`}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Tags className="h-4 w-4 text-amber-300" /> По категориям</div>
          {data.by_category.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">Нет данных</div> : (
            <div className="space-y-2.5">{data.by_category.map((c) => (
              <div key={c.name}>
                <div className="flex items-baseline justify-between gap-2 text-sm"><span className="truncate text-slate-200">{c.name}</span><span className="shrink-0 font-semibold tabular-nums text-amber-300">{fmt(c.revenue)} ₸</span></div>
                <div className="mt-1 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5"><div className="h-full rounded-full bg-amber-400/70" style={{ width: `${Math.round((c.revenue / maxCategory) * 100)}%` }} /></div><span className="shrink-0 text-[11px] text-slate-500">{c.qty} шт</span></div>
              </div>
            ))}</div>
          )}
        </div>
      </div>

      {/* Способы оплаты */}
      <div className={`${card} p-4`}>
        <div className="mb-3 text-sm font-semibold text-white">Способы оплаты</div>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
          <PayBar label="Наличные" amount={data.payment.cash} total={t!.amount} color="bg-emerald-500" />
          <PayBar label="Безнал" amount={data.payment.kaspi} total={t!.amount} color="bg-amber-500" />
          <PayBar label="Карта" amount={data.payment.card} total={t!.amount} color="bg-sky-500" />
          <PayBar label="Онлайн" amount={data.payment.online} total={t!.amount} color="bg-violet-500" />
        </div>
      </div>

      {/* Лента продаж + Топ товары */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-white"><Activity className="h-4 w-4 text-emerald-300" /> Лента продаж</span>
            <span className="text-xs text-slate-500">последние {data.recent.length}</span>
          </div>
          <div className="max-h-[420px] divide-y divide-white/5 overflow-y-auto">
            {data.recent.length === 0 ? <div className="px-4 py-12 text-center text-sm text-slate-400">Продаж нет</div> : data.recent.map((s) => {
              const time = new Date(s.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
              const chip = PAY_CHIP[s.payment_method] || PAY_CHIP.mixed
              const isNew = flashIds.has(s.id)
              return (
                <div key={s.id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isNew ? 'bg-emerald-500/10' : 'hover:bg-white/[0.02]'}`}>
                  <div className="w-11 shrink-0 text-xs tabular-nums text-slate-400">{time}</div>
                  <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${chip}`}>{PAY_LABEL[s.payment_method] || s.payment_method}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">{s.items.length > 0 ? s.items.join(', ') : `${s.items_count} позиц.`}</div>
                    {s.operator_name !== '—' && <div className="text-[11px] text-slate-500">{s.operator_name}</div>}
                  </div>
                  <div className="shrink-0 text-sm font-semibold tabular-nums text-white">{fmt(s.total_amount)} ₸</div>
                </div>
              )
            })}
          </div>
        </div>
        <div className={`${card} p-4`}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Trophy className="h-4 w-4 text-amber-300" /> Топ товары</div>
          {data.top_items.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">Нет данных</div> : (
            <div className="space-y-1.5">{data.top_items.map((it, i) => (
              <div key={it.name} className="flex items-center gap-3 text-sm">
                <span className="w-5 shrink-0 text-center text-xs text-slate-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-slate-200">{it.name}</span>
                <span className="shrink-0 text-xs text-slate-400">{it.qty} шт</span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums text-emerald-300">{fmt(it.revenue)} ₸</span>
              </div>
            ))}</div>
          )}
        </div>
      </div>
    </>
  )
}

function StatCard({ label, icon, color, amount, count, delta }: { label: string; icon: React.ReactNode; color: string; amount: number; count: number; delta?: number | null }) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-white"><span className={color}>{icon}</span> {label}</div>
        {delta != null && (
          <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${delta >= 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300'}`}>
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Сумма</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums text-white">{fmt(amount)} ₸</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Количество</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums text-white">{fmt(count)}</div>
        </div>
      </div>
    </div>
  )
}

// ───────────────────────── Товары ─────────────────────────
function ProductView({ data, loading, tab, category, setCategory, q }: { data: ProdData | null; loading: boolean; tab: Tab; category: string; setCategory: (v: string) => void; q: string }) {
  const categories = useMemo(() => {
    const set = new Set<string>(); for (const it of data?.items || []) if (it.category) set.add(it.category); return Array.from(set).sort()
  }, [data])

  const rows = useMemo(() => {
    let list = data?.items || []
    list = tab === 'stock' ? list.filter((i) => i.stock > 0) : list.filter((i) => i.qty > 0)
    if (category) list = list.filter((i) => i.category === category)
    if (q.trim()) { const s = q.trim().toLowerCase(); list = list.filter((i) => i.name.toLowerCase().includes(s) || (i.barcode || '').toLowerCase().includes(s) || (i.category || '').toLowerCase().includes(s)) }
    const sorted = [...list]
    if (tab === 'best') sorted.sort((a, b) => b.qty - a.qty)
    else if (tab === 'profit') sorted.sort((a, b) => b.profit - a.profit)
    else sorted.sort((a, b) => b.stock * b.purchase_price - a.stock * a.purchase_price)
    return sorted.slice(0, 300)
  }, [data, tab, category, q])

  if (loading && !data) return <Loading />
  if (!data) return null

  return (
    <>
      {tab === 'stock' ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi label="Возможные продажи" value={`${fmt(data.stock_totals.possible_sales)} ₸`} accent="text-sky-300" icon={<TrendingUp className="h-4 w-4" />} />
          <Kpi label="Возможная прибыль" value={`${fmt(data.stock_totals.possible_profit)} ₸`} accent="text-emerald-300" icon={<Coins className="h-4 w-4" />} />
          <Kpi label="Сумма закупки" value={`${fmt(data.stock_totals.purchase_sum)} ₸`} accent="text-amber-300" icon={<Coins className="h-4 w-4" />} />
          <Kpi label="Количество товаров" value={`${fmt(data.stock_totals.total_qty)} шт`} accent="text-white" icon={<Package className="h-4 w-4" />} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Выручка" value={`${fmt(data.sales_totals.revenue)} ₸`} accent="text-sky-300" icon={<TrendingUp className="h-4 w-4" />} big />
          <Kpi label="Чистая прибыль" value={`${fmt(data.sales_totals.profit)} ₸`} accent="text-emerald-300" icon={<Coins className="h-4 w-4" />} big />
          <Kpi label="Количество продаж" value={`${fmt(data.sales_totals.qty)} шт`} accent="text-white" icon={<Receipt className="h-4 w-4" />} big />
        </div>
      )}

      {tab === 'profit' && (data.no_cost?.sold ?? 0) > 0 && (
        <a href="/store/stock" className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100 transition-colors hover:bg-amber-500/15">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <span><b>{data.no_cost!.sold}</b> проданных товаров без закупочной цены — прибыль завышена. Заполнить в каталоге →</span>
        </a>
      )}
      {tab === 'stock' && (data.no_cost?.stock ?? 0) > 0 && (
        <a href="/store/stock" className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-100 transition-colors hover:bg-amber-500/15">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-300" />
          <span><b>{data.no_cost!.stock}</b> товаров на остатке без закупочной цены — оценка неточная. Заполнить в каталоге →</span>
        </a>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          <option value="">Все категории</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-semibold text-white">{TABS.find((x) => x.key === tab)?.label} товары</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">{rows.length}</span>
        </div>
        {rows.length === 0 ? <div className="px-4 py-16 text-center text-sm text-slate-400">Нет данных за период</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  {tab === 'stock' ? (
                    <><th className="px-4 py-2.5 font-medium">Артикул</th><th className="px-4 py-2.5 font-medium">Название</th><th className="px-4 py-2.5 font-medium">Категория</th><th className="px-4 py-2.5 text-right font-medium">Остаток</th><th className="px-4 py-2.5 text-right font-medium">Закупка</th><th className="px-4 py-2.5 text-right font-medium">Продажа</th></>
                  ) : (
                    <><th className="px-4 py-2.5 font-medium">Название</th><th className="px-4 py-2.5 font-medium">Артикул</th><th className="px-4 py-2.5 font-medium">Категория</th><th className="px-4 py-2.5 text-right font-medium">Кол-во</th><th className="px-4 py-2.5 text-right font-medium">{tab === 'profit' ? 'Прибыль' : 'Доход'}</th><th className="px-4 py-2.5 text-right font-medium">Остаток</th></>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {rows.map((it) => (
                  <tr key={it.item_id} className="transition-colors hover:bg-white/[0.02]">
                    {tab === 'stock' ? (
                      <>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{it.barcode || '—'}</td>
                        <td className="px-4 py-2.5 text-white">{it.name}</td>
                        <td className="px-4 py-2.5 text-slate-400">{it.category || '—'}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${it.stock > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>{fmt(it.stock)} {it.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-300">{fmt(it.purchase_price)} ₸</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-white">{fmt(it.sale_price)} ₸</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-white">{it.name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-400">{it.barcode || '—'}</td>
                        <td className="px-4 py-2.5 text-slate-400">{it.category || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-200">{fmt(it.qty)} {it.unit}</td>
                        <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${tab === 'profit' ? 'text-emerald-300' : 'text-sky-300'}`}>{fmt(tab === 'profit' ? it.profit : it.revenue)} ₸{tab === 'profit' && <span className="ml-1 text-[11px] text-slate-500">{it.margin_percent}%</span>}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-slate-400">{fmt(it.stock)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function Loading() {
  return <div className="flex items-center justify-center gap-2 py-20 text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /> Загрузка…</div>
}

function Kpi({ label, value, sub, icon, accent, big }: { label: string; value: string; sub?: string; icon: React.ReactNode; accent: string; big?: boolean }) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500"><span>{label}</span><span className="text-slate-400">{icon}</span></div>
      <div className={`mt-1.5 font-bold tabular-nums ${accent} ${big ? 'text-2xl' : 'text-xl'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

function PayBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 shrink-0 text-xs text-slate-400">{label}</div>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/5"><div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} /></div>
      <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums text-white">{fmt(amount)} ₸</div>
      <div className="w-8 shrink-0 text-right text-xs text-slate-500">{pct}%</div>
    </div>
  )
}
