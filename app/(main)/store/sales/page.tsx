'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useApiCache } from '@/lib/client/use-api-cache'
import { useToday } from '@/lib/client/use-today'
import { usePersistentState } from '@/lib/client/use-persistent-state'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { PageSkeleton } from '@/components/skeleton'
import { useStoreScope } from '@/components/store/store-scope'
import { DatePicker } from '@/components/ui/date-picker'
import {
  Activity, RefreshCw, Loader2, TrendingUp, Receipt,
  Clock, Trophy, Pause, Play, Users, Tags, Coins, Package, Search, AlertTriangle,
  RotateCcw, Truck, ChevronRight,
} from 'lucide-react'

const REFRESH_MS = 12_000

const embFallback = () => <PageSkeleton stats={0} rows={8} cols={5} />
const AbcEmbed = dynamic(() => import('@/app/(main)/store/abc/page'), { ssr: false, loading: embFallback })
const ForecastEmbed = dynamic(() => import('@/components/store/forecast-page').then((m) => m.InventoryForecastPageContent), { ssr: false, loading: embFallback })

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
  showcase_stock: number; warehouse_stock: number
  sale_price: number; purchase_price: number
}
type ProdData = {
  items: Item[]
  sales_totals: { revenue: number; profit: number; qty: number }
  stock_totals: { possible_sales: number; possible_profit: number; purchase_sum: number; total_qty: number; items_count: number }
  no_cost?: { sold: number; stock: number }
}
type Company = { id: string; name: string }
type Tab = 'monitor' | 'best' | 'profit' | 'category' | 'stock' | 'abc' | 'forecast'
type Preset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'custom'

const card = 'rounded-2xl border border-border bg-white dark:bg-slate-900/60 shadow-lg shadow-black/20'
const inputCls = 'rounded-xl border border-border bg-white dark:bg-slate-950/50 px-3 py-2 text-sm text-foreground placeholder-slate-500 [color-scheme:dark] focus:border-emerald-400/50 focus:outline-none'
const PAY_LABEL: Record<string, string> = { cash: 'Нал', kaspi: 'Безнал', card: 'Карта', online: 'Онлайн', mixed: 'Смеш.' }
const PAY_CHIP: Record<string, string> = {
  cash: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 border-emerald-400/30',
  kaspi: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 border-amber-400/30',
  card: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 border-sky-400/30',
  online: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 border-violet-400/30',
  mixed: 'bg-slate-500/15 text-body border-slate-400/30',
}
const fmt = (n: number) => Number(n || 0).toLocaleString('ru-RU')
const pad2 = (n: number) => String(n).padStart(2, '0')
const almatyDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' })
const dateMinus = (days: number) => { const d = new Date(); d.setDate(d.getDate() - days); return almatyDate(d) }

/**
 * Подпись «обновлено N с назад».
 *
 * Отдельный компонент, потому что секундный тик должен перерисовывать одну
 * строчку, а не весь монитор с графиками, топом товаров и списком чеков —
 * раньше страница целиком пересобиралась раз в секунду.
 */
function UpdatedAgo({ at }: { at: number | null }) {
  const [, tick] = useState(0)
  useEffect(() => {
    if (at === null) return
    const id = setInterval(() => tick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [at])
  if (at === null) return null
  const sec = Math.floor((Date.now() - at) / 1000)
  return <span>обновлено {sec < 5 ? 'только что' : `${sec} с назад`}</span>
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'monitor', label: 'Монитор' },
  { key: 'best', label: 'Продаваемые' },
  { key: 'profit', label: 'Доходные' },
  { key: 'category', label: 'Категории' },
  { key: 'stock', label: 'Остатки' },
  { key: 'abc', label: 'ABC' },
  { key: 'forecast', label: 'Прогноз' },
]
const EMBED_TABS: Tab[] = ['abc', 'forecast']

export default function SalesMonitorPage() {
  // «Сегодня» — после гидрации: страница готовится заранее, и вычисленная при
  // отрисовке дата попала бы в HTML как день сборки. Подробности в useToday.
  const today = useToday('Asia/Almaty')

  // Память фильтров: вкладка, точка, период. Даты (from/to) — обычный state:
  // относительные пресеты («сегодня», «7 дней») пересчитываются от текущей даты
  // эффектом ниже, а произвольный диапазон хранится в 'storeSales.range'.
  const [tab, setTab] = usePersistentState<Tab>('storeSales.tab', 'monitor')
  const [preset, setPreset] = usePersistentState<Preset>('storeSales.preset', 'today')
  const [savedRange, setSavedRange] = usePersistentState<{ from: string; to: string } | null>('storeSales.range', null)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [companyId, setCompanyId] = usePersistentState('storeSales.companyId', '')
  const { storeCompanyId } = useStoreScope()
  const [companies, setCompanies] = useState<Company[]>([])
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')

  const [live, setLive] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const seenIds = useRef<Set<string>>(new Set())
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())

  // Пока даты нет, «сегодня ли это» неизвестно — и живого монитора быть не
  // может: он привязан к текущему дню.
  const isToday = !!today && to === today
  const isEmbed = EMBED_TABS.includes(tab)
  const isProduct = tab === 'best' || tab === 'profit' || tab === 'stock' || tab === 'category'

  // SWR-кэш: повторное открытие показывает прошлые данные мгновенно, свежие
  // подтягиваются фоном. refresh() (loadMonitor/loadProducts) — перезагрузка;
  // с живым кэшем она фоновая (без скелетона) — то же, что прежний silent=true.
  // Глобальный переключатель точки (шапка магазина) имеет приоритет над
  // локальным селектором страницы.
  const effectiveCompanyId = storeCompanyId || companyId
  const qsParams = new URLSearchParams({ from, to })
  if (effectiveCompanyId) qsParams.set('company_id', effectiveCompanyId)
  const qs = qsParams.toString()
  // Без дат запрашивать нечего: период ещё не восстановлен.
  const hasPeriod = !!from && !!to
  const { data: mon, loading: monLoading, error: monError, refresh: loadMonitor } =
    useApiCache<MonData>(`/api/admin/sales-monitor?${qs}`, { enabled: hasPeriod && tab === 'monitor' })
  const { data: prod, loading: prodLoading, error: prodError, refresh: loadProducts } =
    useApiCache<ProdData>(`/api/admin/product-analytics?${qs}`, { enabled: hasPeriod && isProduct })
  const loading = tab === 'monitor' ? monLoading : prodLoading
  const error = tab === 'monitor' ? monError : isProduct ? prodError : null

  // Сброс «увиденных» продаж при входе на монитор — чтобы не мигала вся лента
  useEffect(() => {
    if (tab === 'monitor') seenIds.current = new Set()
  }, [tab])

  // Подсветка новых продаж в ленте — реагирует на каждое обновление данных
  useEffect(() => {
    if (!mon) return
    const prevSeen = seenIds.current
    const fresh = new Set<string>()
    for (const r of mon.recent) if (!prevSeen.has(r.id)) fresh.add(r.id)
    if (prevSeen.size > 0 && fresh.size > 0) {
      setFlashIds(fresh)
      setTimeout(() => setFlashIds(new Set()), 2500)
    }
    seenIds.current = new Set(mon.recent.map((r) => r.id))
    setLastUpdated(Date.now())
  }, [mon])

  function applyPreset(p: Preset) {
    setPreset(p)
    if (p === 'today') { setFrom(today); setTo(today) }
    else if (p === 'yesterday') { setFrom(dateMinus(1)); setTo(dateMinus(1)) }
    else if (p === '7d') { setFrom(dateMinus(6)); setTo(today) }
    else if (p === '30d') { setFrom(dateMinus(29)); setTo(today) }
    else if (p === 'month') { setFrom(`${today.slice(0, 7)}-01`); setTo(today) }
  }

  // Восстановление периода из памяти: относительные пресеты пересчитываются от
  // сегодняшней даты (сохранённое «сегодня» не должно застрять на вчера),
  // произвольный диапазон берётся из savedRange. Срабатывает после загрузки
  // localStorage (usePersistentState меняет preset/savedRange) и при смене пресета.
  useEffect(() => {
    // Относительные пресеты считаются от сегодняшней даты — ждём, пока она
    // появится после гидрации.
    if (!today) return
    if (preset === 'custom') {
      if (savedRange?.from && savedRange?.to) { setFrom(savedRange.from); setTo(savedRange.to) }
      return
    }
    applyPreset(preset)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, savedRange, today])

  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' }).then((r) => r.json()).then((j) => setCompanies(j.data || [])).catch(() => {})
  }, [])

  // Авто-обновление монитора (только сегодня); refresh с кэшем — фоновый.
  // На скрытой вкладке опрос стоит: смысла грузить сервер каждые 12 секунд ради
  // экрана, на который никто не смотрит, нет. При возврате — сразу освежаем.
  useEffect(() => {
    if (tab !== 'monitor' || !live || !isToday) return
    let id: ReturnType<typeof setInterval> | null = null
    const start = () => { if (id === null) id = setInterval(() => void loadMonitor(), REFRESH_MS) }
    const stop = () => { if (id !== null) { clearInterval(id); id = null } }
    const onVisibility = () => {
      if (document.hidden) stop()
      else { void loadMonitor(); start() }
    }
    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility) }
  }, [tab, live, isToday, loadMonitor])

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
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${live ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-200' : 'border-border bg-surface-muted text-body hover:bg-surface-hover'}`}
              >
                {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                {live ? 'Авто' : 'Пауза'}
              </button>
            )}
            <button onClick={() => (tab === 'monitor' ? loadMonitor() : loadProducts())} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface-muted px-3 py-2 text-xs font-medium text-body transition-colors hover:bg-surface-hover">
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Обновить
            </button>
          </>
        }
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-border bg-slate-50 dark:bg-slate-950/50 p-1">
            {TABS.map(({ key, label }) => (
              <button key={key} onClick={() => setTab(key)} className={`rounded-xl px-3 py-2 text-sm font-medium transition-all sm:px-4 ${tab === key ? 'bg-white/10 text-foreground shadow-sm ring-1 ring-slate-200 dark:ring-white/10' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'}`}>
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
            className={`rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${preset === k ? 'border-sky-400/40 bg-sky-500/15 text-sky-700 dark:text-sky-200' : 'border-border bg-surface-muted text-body hover:bg-surface-hover'}`}
          >
            {lbl}
          </button>
        ))}
        <div className="flex items-center gap-1.5">
          <DatePicker value={from} max={to} onChange={(v) => { setFrom(v); setPreset('custom'); setSavedRange({ from: v, to }) }} className={inputCls} />
          <span className="text-slate-500">—</span>
          <DatePicker value={to} max={today} onChange={(v) => { setTo(v); setPreset('custom'); setSavedRange({ from, to: v }) }} className={inputCls} />
        </div>
        {!storeCompanyId && (
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={`${inputCls} w-full sm:w-auto`}>
            <option value="">Все точки</option>
            {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {isProduct && (
          <div className="relative w-full flex-1 sm:w-auto sm:min-w-[200px]">
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
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${live ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border bg-surface-muted'}`}>
                <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`} />
                {live ? 'В реальном времени' : 'На паузе'}
              </span>
              <UpdatedAgo at={lastUpdated} />
            </>
          ) : (
            <span>Период: {from === to ? from : `${from} — ${to}`}</span>
          )}
        </div>
      )}

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-200">{error}</div>}

      {tab === 'abc' ? <AbcEmbed embedded /> :
       tab === 'forecast' ? <ForecastEmbed embedded /> :
       tab === 'monitor'
        ? <MonitorView data={mon} loading={loading} flashIds={flashIds} />
        : tab === 'category'
        ? <CategoryView data={prod} loading={loading} q={q} />
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

  if (loading && !data) return <Loading />
  if (!data) return null

  return (
    <>
      {/* 3 верхние карточки: Продажи / Возврат / Приёмка */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard label="Продажи" icon={<TrendingUp className="h-4 w-4" />} color="text-emerald-600 dark:text-emerald-300" amount={t!.amount} count={t!.count} delta={data.prev.delta_pct} />
        <StatCard label="Возврат" icon={<RotateCcw className="h-4 w-4" />} color="text-rose-600 dark:text-rose-300" amount={data.returns.amount} count={data.returns.count} />
        <StatCard label="Приёмка" icon={<Truck className="h-4 w-4" />} color="text-sky-600 dark:text-sky-300" amount={data.receipts.amount} count={data.receipts.count} />
      </div>

      {/* График по часам + сетка KPI */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className={`${card} p-4 lg:col-span-2`}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Clock className="h-4 w-4 text-sky-600 dark:text-sky-300" /> Продажи {useDaily ? 'по дням' : 'по часам'}</div>
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
          <Kpi label="Выручка" value={`${fmt(t!.amount)} ₸`} icon={<TrendingUp className="h-4 w-4" />} accent="text-emerald-600 dark:text-emerald-300" />
          <Kpi label="Чистая прибыль" value={`${fmt(t!.net_profit)} ₸`} icon={<Coins className="h-4 w-4" />} accent={t!.net_profit >= 0 ? 'text-emerald-600 dark:text-emerald-300' : 'text-rose-600 dark:text-rose-300'} />
          <Kpi label="Средний чек" value={`${fmt(t!.avg_check)} ₸`} icon={<Activity className="h-4 w-4" />} accent="text-foreground" />
          <Kpi label="За последний час" value={`${fmt(data.last_hour.amount)} ₸`} sub={`${data.last_hour.count} продаж`} icon={<Clock className="h-4 w-4" />} accent="text-amber-600 dark:text-amber-300" />
        </div>
      </div>

      {/* Информация о сотрудниках + товары по категориям */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-foreground"><Users className="h-4 w-4 text-violet-600 dark:text-violet-300" /> Информация о сотрудниках</div>
          {data.by_operator.length === 0 ? <div className="px-4 py-10 text-center text-sm text-slate-400">Нет данных</div> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">ФИО</th>
                  <th className="px-4 py-2 text-right font-medium">Продаж</th>
                  <th className="px-4 py-2 text-right font-medium">Ср. чек</th>
                  <th className="px-4 py-2 text-right font-medium">Сумма</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">{data.by_operator.map((o) => (
                  <tr key={o.name} className="transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-foreground">{o.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-body">{o.count}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{fmt(o.avg_check)} ₸</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-emerald-600 dark:text-emerald-300">{fmt(o.amount)} ₸</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-foreground"><Tags className="h-4 w-4 text-amber-600 dark:text-amber-300" /> Товары по категориям</div>
          {data.by_category.length === 0 ? <div className="px-4 py-10 text-center text-sm text-slate-400">Нет данных</div> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2 font-medium">Категория</th>
                  <th className="px-4 py-2 text-right font-medium">Количество</th>
                  <th className="px-4 py-2 text-right font-medium">Сумма</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">{data.by_category.map((c) => (
                  <tr key={c.name} className="transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-2.5 text-foreground">{c.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-body">{fmt(c.qty)}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-amber-600 dark:text-amber-300">{fmt(c.revenue)} ₸</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Способы оплаты */}
      <div className={`${card} overflow-hidden`}>
        <div className="border-b border-border px-4 py-3 text-sm font-semibold text-foreground">Способы оплаты</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-slate-500">
              <th className="px-4 py-2 font-medium">Способ оплаты</th>
              <th className="px-4 py-2 text-right font-medium">Сумма продаж</th>
              <th className="px-4 py-2 text-right font-medium">Доля</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {[
                { label: 'Наличные', amount: data.payment.cash },
                { label: 'Безнал (Kaspi)', amount: data.payment.kaspi },
                { label: 'Карта', amount: data.payment.card },
                { label: 'Онлайн', amount: data.payment.online },
              ].map((p) => (
                <tr key={p.label} className="transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5 text-body">{p.label}</td>
                  <td className="px-4 py-2.5 text-right font-medium tabular-nums text-foreground">{fmt(p.amount)} ₸</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-500">{t!.amount > 0 ? Math.round((p.amount / t!.amount) * 100) : 0}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Лента продаж + Топ товары */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`${card} overflow-hidden`}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <span className="flex items-center gap-2 text-sm font-semibold text-foreground"><Activity className="h-4 w-4 text-emerald-600 dark:text-emerald-300" /> Лента продаж</span>
            <span className="text-xs text-slate-500">последние {data.recent.length}</span>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {data.recent.length === 0 ? <div className="px-4 py-12 text-center text-sm text-slate-400">Продаж нет</div> : (
              <>
                {/* Мобильная версия: карточки продаж вместо компактных строк */}
                <div className="divide-y divide-slate-100 dark:divide-white/5 sm:hidden">
                  {data.recent.map((s) => {
                    const time = new Date(s.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                    const chip = PAY_CHIP[s.payment_method] || PAY_CHIP.mixed
                    const isNew = flashIds.has(s.id)
                    return (
                      <div key={s.id} className={`px-4 py-3 transition-colors ${isNew ? 'bg-emerald-500/10' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium tabular-nums text-foreground">{time}</div>
                            {s.company_name ? <div className="truncate text-[11px] text-slate-500">{s.company_name}</div> : null}
                          </div>
                          <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${chip}`}>{PAY_LABEL[s.payment_method] || s.payment_method}</span>
                        </div>
                        <div className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">{fmt(s.total_amount)} ₸</div>
                        <div className="mt-1.5 space-y-0.5">
                          {s.items.length > 0
                            ? s.items.map((name, i) => <div key={i} className="truncate text-xs text-body">{name}</div>)
                            : <div className="text-xs text-slate-500">{s.items_count} позиц.</div>}
                        </div>
                        {s.operator_name !== '—' && <div className="mt-1 text-[11px] text-slate-500">{s.operator_name}</div>}
                      </div>
                    )
                  })}
                </div>
                {/* Десктоп: прежние компактные строки */}
                <div className="hidden divide-y divide-slate-100 dark:divide-white/5 sm:block">
                  {data.recent.map((s) => {
                    const time = new Date(s.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                    const chip = PAY_CHIP[s.payment_method] || PAY_CHIP.mixed
                    const isNew = flashIds.has(s.id)
                    return (
                      <div key={s.id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isNew ? 'bg-emerald-500/10' : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]'}`}>
                        <div className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground">{time}</div>
                        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${chip}`}>{PAY_LABEL[s.payment_method] || s.payment_method}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-foreground">{s.items.length > 0 ? s.items.join(', ') : `${s.items_count} позиц.`}</div>
                          {s.operator_name !== '—' && <div className="text-[11px] text-slate-500">{s.operator_name}</div>}
                        </div>
                        <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmt(s.total_amount)} ₸</div>
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </div>
        </div>
        <div className={`${card} p-4`}>
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground"><Trophy className="h-4 w-4 text-amber-600 dark:text-amber-300" /> Топ товары</div>
          {data.top_items.length === 0 ? <div className="py-6 text-center text-sm text-slate-400">Нет данных</div> : (
            <div className="space-y-1.5">{data.top_items.map((it, i) => (
              <div key={it.name} className="flex items-center gap-3 text-sm">
                <span className="w-5 shrink-0 text-center text-xs text-slate-500">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate text-body">{it.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{it.qty} шт</span>
                <span className="w-24 shrink-0 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-300">{fmt(it.revenue)} ₸</span>
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
    <div className={`${card} p-3 sm:p-4`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><span className={color}>{icon}</span> {label}</div>
        {delta != null && (
          <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-medium ${delta >= 0 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'}`}>
            {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}%
          </span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Сумма</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{fmt(amount)} ₸</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-slate-500">Количество</div>
          <div className="mt-0.5 text-xl font-bold tabular-nums text-foreground">{fmt(count)}</div>
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
          <Kpi label="Возможные продажи" value={`${fmt(data.stock_totals.possible_sales)} ₸`} accent="text-sky-600 dark:text-sky-300" icon={<TrendingUp className="h-4 w-4" />} />
          <Kpi label="Возможная прибыль" value={`${fmt(data.stock_totals.possible_profit)} ₸`} accent="text-emerald-600 dark:text-emerald-300" icon={<Coins className="h-4 w-4" />} />
          <Kpi label="Сумма закупки" value={`${fmt(data.stock_totals.purchase_sum)} ₸`} accent="text-amber-600 dark:text-amber-300" icon={<Coins className="h-4 w-4" />} />
          <Kpi label="Количество товаров" value={`${fmt(data.stock_totals.total_qty)} шт`} accent="text-foreground" icon={<Package className="h-4 w-4" />} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi label="Выручка" value={`${fmt(data.sales_totals.revenue)} ₸`} accent="text-sky-600 dark:text-sky-300" icon={<TrendingUp className="h-4 w-4" />} big />
          <Kpi label="Чистая прибыль" value={`${fmt(data.sales_totals.profit)} ₸`} accent="text-emerald-600 dark:text-emerald-300" icon={<Coins className="h-4 w-4" />} big />
          <Kpi label="Количество продаж" value={`${fmt(data.sales_totals.qty)} шт`} accent="text-foreground" icon={<Receipt className="h-4 w-4" />} big />
        </div>
      )}

      {tab === 'profit' && (data.no_cost?.sold ?? 0) > 0 && (
        <a href="/store/stock" className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-100 transition-colors hover:bg-amber-500/15">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <span><b>{data.no_cost!.sold}</b> проданных товаров без закупочной цены — прибыль завышена. Заполнить в каталоге →</span>
        </a>
      )}
      {tab === 'stock' && (data.no_cost?.stock ?? 0) > 0 && (
        <a href="/store/stock" className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-100 transition-colors hover:bg-amber-500/15">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
          <span><b>{data.no_cost!.stock}</b> товаров на остатке без закупочной цены — оценка неточная. Заполнить в каталоге →</span>
        </a>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={`${inputCls} w-full sm:w-auto`}>
          <option value="">Все категории</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">{TABS.find((x) => x.key === tab)?.label} товары</span>
          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">{rows.length}</span>
        </div>
        {rows.length === 0 ? <div className="px-4 py-16 text-center text-sm text-slate-400">Нет данных за период</div> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-slate-500">
                  {tab === 'stock' ? (
                    <><th className="px-4 py-2.5 font-medium">Артикул</th><th className="px-4 py-2.5 font-medium">Название</th><th className="px-4 py-2.5 font-medium">Категория</th><th className="px-4 py-2.5 text-right font-medium">Витрина</th><th className="px-4 py-2.5 text-right font-medium">Склад</th><th className="px-4 py-2.5 text-right font-medium">Закупка</th><th className="px-4 py-2.5 text-right font-medium">Продажа</th></>
                  ) : (
                    <><th className="px-4 py-2.5 font-medium">Название</th><th className="px-4 py-2.5 font-medium">Артикул</th><th className="px-4 py-2.5 font-medium">Категория</th><th className="px-4 py-2.5 text-right font-medium">Кол-во</th><th className="px-4 py-2.5 text-right font-medium">{tab === 'profit' ? 'Прибыль' : 'Доход'}</th><th className="px-4 py-2.5 text-right font-medium">Остаток</th></>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map((it) => (
                  <tr key={it.item_id} className="transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                    {tab === 'stock' ? (
                      <>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{it.barcode || '—'}</td>
                        <td className="px-4 py-2.5 text-foreground">{it.name}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{it.category || '—'}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${it.showcase_stock > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-400'}`}>{fmt(it.showcase_stock)} {it.unit}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${it.warehouse_stock > 0 ? 'text-sky-700 dark:text-sky-300' : 'text-slate-400'}`}>{fmt(it.warehouse_stock)} {it.unit}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-body">{fmt(it.purchase_price)} ₸</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-foreground">{fmt(it.sale_price)} ₸</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-foreground">{it.name}</td>
                        <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{it.barcode || '—'}</td>
                        <td className="px-4 py-2.5 text-muted-foreground">{it.category || '—'}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-body">{fmt(it.qty)} {it.unit}</td>
                        <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${tab === 'profit' ? 'text-emerald-600 dark:text-emerald-300' : 'text-sky-600 dark:text-sky-300'}`}>{fmt(tab === 'profit' ? it.profit : it.revenue)} ₸{tab === 'profit' && <span className="ml-1 text-[11px] text-slate-500">{it.margin_percent}%</span>}</td>
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

// ───────────────────────── Категории ─────────────────────────

type CategoryRow = {
  name: string
  revenue: number
  profit: number
  qty: number
  margin: number
  share: number
  itemsTotal: number
  itemsSold: number
  deadCount: number
  deadValue: number
  stockValue: number
  top: Item[]
}

type CategorySort = 'revenue' | 'profit' | 'margin' | 'dead'

const CATEGORY_SORTS: { key: CategorySort; label: string }[] = [
  { key: 'revenue', label: 'По выручке' },
  { key: 'profit', label: 'По прибыли' },
  { key: 'margin', label: 'По марже' },
  { key: 'dead', label: 'По залежавшемуся' },
]

const NO_CATEGORY = 'Без категории'

/**
 * Разрез продаж по категориям.
 *
 * Считается из того же ответа, что и вкладки «Продаваемые/Доходные/Остатки» —
 * отдельного запроса нет, переключение вкладки бесплатно.
 *
 * «Залежалось» — это позиции, у которых за период ноль продаж, но есть остаток:
 * деньги, которые лежат на полке вместо кассы. Обычная таблица выручки этого не
 * показывает — категория может выглядеть прибыльной и при этом держать склад.
 */
function CategoryView({ data, loading, q }: { data: ProdData | null; loading: boolean; q: string }) {
  const [sort, setSort] = useState<CategorySort>('revenue')
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  const rows = useMemo<CategoryRow[]>(() => {
    const items = data?.items || []
    const totalRevenue = items.reduce((sum, i) => sum + Number(i.revenue || 0), 0)
    const byName = new Map<string, Item[]>()
    for (const item of items) {
      const key = item.category || NO_CATEGORY
      const bucket = byName.get(key)
      if (bucket) bucket.push(item)
      else byName.set(key, [item])
    }

    const list: CategoryRow[] = []
    for (const [name, group] of byName) {
      const revenue = group.reduce((sum, i) => sum + Number(i.revenue || 0), 0)
      const profit = group.reduce((sum, i) => sum + Number(i.profit || 0), 0)
      const qty = group.reduce((sum, i) => sum + Number(i.qty || 0), 0)
      const dead = group.filter((i) => Number(i.qty || 0) <= 0 && Number(i.stock || 0) > 0)
      // Пустая категория (ни продаж, ни остатка) в отчёте только мешает.
      if (revenue === 0 && qty === 0 && dead.length === 0) continue
      list.push({
        name,
        revenue,
        profit,
        qty,
        // Маржа категории — от её денег, а не среднее по товарам: две позиции
        // с маржой 50% и 5% при разной выручке дают совсем не 27,5%.
        margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
        share: totalRevenue > 0 ? Math.round((revenue / totalRevenue) * 1000) / 10 : 0,
        itemsTotal: group.length,
        itemsSold: group.filter((i) => Number(i.qty || 0) > 0).length,
        deadCount: dead.length,
        deadValue: dead.reduce((sum, i) => sum + Number(i.stock || 0) * Number(i.purchase_price || 0), 0),
        stockValue: group.reduce((sum, i) => sum + Number(i.stock || 0) * Number(i.purchase_price || 0), 0),
        top: [...group].sort((a, b) => b.revenue - a.revenue).slice(0, 8),
      })
    }

    const search = q.trim().toLowerCase()
    const filtered = search ? list.filter((row) => row.name.toLowerCase().includes(search)) : list
    return filtered.sort((a, b) => {
      if (sort === 'profit') return b.profit - a.profit
      if (sort === 'margin') return b.margin - a.margin
      if (sort === 'dead') return b.deadValue - a.deadValue
      return b.revenue - a.revenue
    })
  }, [data, q, sort])

  const summary = useMemo(() => {
    const best = rows.reduce<CategoryRow | null>((acc, r) => (!acc || r.profit > acc.profit ? r : acc), null)
    const heaviest = rows.reduce<CategoryRow | null>((acc, r) => (!acc || r.deadValue > acc.deadValue ? r : acc), null)
    return {
      count: rows.length,
      best,
      heaviest,
      deadValue: rows.reduce((sum, r) => sum + r.deadValue, 0),
    }
  }, [rows])

  if (loading && !data) return <Loading />
  if (!data) return null

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Категорий" value={String(summary.count)} accent="text-foreground" icon={<Tags className="h-4 w-4" />} />
        <Kpi
          label="Больше всего прибыли"
          value={summary.best?.name || '—'}
          sub={summary.best ? `${fmt(summary.best.profit)} ₸ · маржа ${summary.best.margin}%` : undefined}
          accent="text-emerald-600 dark:text-emerald-300"
          icon={<Coins className="h-4 w-4" />}
        />
        <Kpi
          label="Залежалось на складе"
          value={`${fmt(summary.deadValue)} ₸`}
          sub="закупочная цена позиций без продаж"
          accent={summary.deadValue > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-foreground'}
          icon={<Package className="h-4 w-4" />}
        />
        <Kpi
          label="Тяжелее всех"
          value={summary.heaviest && summary.heaviest.deadValue > 0 ? summary.heaviest.name : '—'}
          sub={summary.heaviest && summary.heaviest.deadValue > 0 ? `${fmt(summary.heaviest.deadValue)} ₸ без движения` : undefined}
          accent="text-amber-600 dark:text-amber-300"
          icon={<AlertTriangle className="h-4 w-4" />}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-white p-1 dark:bg-slate-950/50">
        {CATEGORY_SORTS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setSort(key)}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              sort === key
                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Продажи по категориям</span>
          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">{rows.length}</span>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">Нет данных за период</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-4 py-2.5 font-medium">Категория</th>
                  <th className="px-4 py-2.5 text-right font-medium">Выручка</th>
                  <th className="px-4 py-2.5 text-right font-medium">Доля</th>
                  <th className="px-4 py-2.5 text-right font-medium">Прибыль</th>
                  <th className="px-4 py-2.5 text-right font-medium">Маржа</th>
                  <th className="px-4 py-2.5 text-right font-medium">Продано</th>
                  <th className="px-4 py-2.5 text-right font-medium">Позиций</th>
                  <th className="px-4 py-2.5 text-right font-medium">Залежалось</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {rows.map((row) => {
                  const open = openCategory === row.name
                  return (
                    <Fragment key={row.name}>
                      <tr
                        onClick={() => setOpenCategory(open ? null : row.name)}
                        className="cursor-pointer transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.02]"
                      >
                        <td className="px-4 py-2.5">
                          <span className="flex items-center gap-1.5 text-foreground">
                            <ChevronRight className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
                            {row.name}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-sky-600 dark:text-sky-300">{fmt(row.revenue)} ₸</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{row.share}%</td>
                        <td className="px-4 py-2.5 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-300">{fmt(row.profit)} ₸</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${row.margin < 10 ? 'text-rose-600 dark:text-rose-300' : 'text-body'}`}>{row.margin}%</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-body">{fmt(row.qty)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">{row.itemsSold} / {row.itemsTotal}</td>
                        <td className={`px-4 py-2.5 text-right tabular-nums ${row.deadValue > 0 ? 'text-amber-600 dark:text-amber-300' : 'text-slate-400'}`}>
                          {row.deadValue > 0 ? `${fmt(row.deadValue)} ₸` : '—'}
                          {row.deadCount > 0 && <span className="ml-1 text-[11px] text-slate-500">{row.deadCount} поз.</span>}
                        </td>
                      </tr>
                      {open && (
                        <tr className="bg-slate-50/60 dark:bg-white/[0.02]">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="mb-2 text-[11px] uppercase tracking-wider text-slate-500">Товары категории — по выручке</div>
                            <div className="space-y-1.5">
                              {row.top.map((item) => (
                                <div key={item.item_id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                  <span className="min-w-0 flex-1 truncate text-body">{item.name}</span>
                                  <span className="tabular-nums text-muted-foreground">{fmt(item.qty)} {item.unit}</span>
                                  <span className="w-24 text-right tabular-nums text-sky-600 dark:text-sky-300">{fmt(item.revenue)} ₸</span>
                                  <span className="w-24 text-right tabular-nums text-emerald-600 dark:text-emerald-300">{fmt(item.profit)} ₸</span>
                                  <span className="w-20 text-right tabular-nums text-slate-400">ост. {fmt(item.stock)}</span>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}

function Loading() {
  return <PageSkeleton stats={3} rows={8} cols={5} />
}

function Kpi({ label, value, sub, icon, accent, big }: { label: string; value: string; sub?: string; icon: React.ReactNode; accent: string; big?: boolean }) {
  return (
    <div className={`${card} p-3 sm:p-4`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500"><span>{label}</span><span className="text-muted-foreground">{icon}</span></div>
      <div className={`mt-1.5 font-bold tabular-nums ${accent} ${big ? 'text-xl sm:text-2xl' : 'text-xl'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}
