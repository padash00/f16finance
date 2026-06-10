'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { BarChart3, Loader2, RefreshCw, Search, Package, TrendingUp, Coins } from 'lucide-react'

type Item = {
  item_id: string
  name: string
  barcode: string
  unit: string
  category: string | null
  qty: number
  revenue: number
  profit: number
  margin_percent: number
  stock: number
  sale_price: number
  purchase_price: number
}
type Data = {
  items: Item[]
  sales_totals: { revenue: number; profit: number; qty: number }
  stock_totals: { possible_sales: number; possible_profit: number; purchase_sum: number; total_qty: number; items_count: number }
}
type Company = { id: string; name: string }
type Tab = 'best' | 'profit' | 'stock'

const card = 'rounded-2xl border border-white/10 bg-slate-900/60 shadow-lg shadow-black/20'
const inputCls = 'rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white placeholder-slate-500 [color-scheme:dark] focus:border-emerald-400/50 focus:outline-none'
const fmt = (n: number) => Number(n || 0).toLocaleString('ru-RU')

const TABS: { key: Tab; label: string }[] = [
  { key: 'best', label: 'Продаваемые' },
  { key: 'profit', label: 'Доходные' },
  { key: 'stock', label: 'Остатки' },
]

export default function ProductAnalyticsPage() {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' })
  const monthAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Almaty' }) })()

  const [tab, setTab] = useState<Tab>('best')
  const [from, setFrom] = useState(monthAgo)
  const [to, setTo] = useState(today)
  const [companyId, setCompanyId] = useState('')
  const [companies, setCompanies] = useState<Company[]>([])
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/companies', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setCompanies(j.data || []))
      .catch(() => {})
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const p = new URLSearchParams({ from, to })
      if (companyId) p.set('company_id', companyId)
      const res = await fetch(`/api/admin/product-analytics?${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка загрузки')
      setData(j.data)
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [from, to, companyId])

  useEffect(() => { load() }, [load])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const it of data?.items || []) if (it.category) set.add(it.category)
    return Array.from(set).sort()
  }, [data])

  const rows = useMemo(() => {
    let list = data?.items || []
    if (tab === 'stock') list = list.filter((i) => i.stock > 0)
    else list = list.filter((i) => i.qty > 0)
    if (category) list = list.filter((i) => i.category === category)
    if (q.trim()) {
      const s = q.trim().toLowerCase()
      list = list.filter((i) => i.name.toLowerCase().includes(s) || (i.barcode || '').toLowerCase().includes(s) || (i.category || '').toLowerCase().includes(s))
    }
    const sorted = [...list]
    if (tab === 'best') sorted.sort((a, b) => b.qty - a.qty)
    else if (tab === 'profit') sorted.sort((a, b) => b.profit - a.profit)
    else sorted.sort((a, b) => b.stock * b.purchase_price - a.stock * a.purchase_price)
    return sorted.slice(0, 300)
  }, [data, tab, category, q])

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Аналитика товаров"
        description="Продаваемые, доходные товары и остатки склада"
        icon={<BarChart3 className="h-5 w-5" />}
        accent="emerald"
        backHref="/store"
        actions={
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Обновить
          </button>
        }
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-slate-950/50 p-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${tab === key ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10' : 'text-slate-400 hover:text-white'}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {/* KPI */}
      {data && (
        tab === 'stock' ? (
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
            <Kpi label="Количество продаж" value={`${fmt(data.sales_totals.qty)} шт`} accent="text-white" icon={<BarChart3 className="h-4 w-4" />} big />
          </div>
        )
      )}

      {/* Фильтры */}
      <div className="flex flex-wrap items-center gap-2">
        <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={inputCls}>
          <option value="">Все точки</option>
          {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
          <option value="">Все категории</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        {tab !== 'stock' && (
          <div className="flex items-center gap-1.5">
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
            <span className="text-slate-500">—</span>
            <input type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className={inputCls} />
          </div>
        )}
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Поиск по товару, артикулу, категории…" className={`${inputCls} w-full pl-9`} />
        </div>
      </div>

      {error && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</div>}

      {/* Таблица */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-semibold text-white">{TABS.find((x) => x.key === tab)?.label} товары</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">{rows.length}</span>
        </div>

        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">Нет данных за выбранный период</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-slate-500">
                  {tab === 'stock' ? (
                    <>
                      <th className="px-4 py-2.5 font-medium">Артикул</th>
                      <th className="px-4 py-2.5 font-medium">Название</th>
                      <th className="px-4 py-2.5 font-medium">Категория</th>
                      <th className="px-4 py-2.5 text-right font-medium">Остаток</th>
                      <th className="px-4 py-2.5 text-right font-medium">Цена закупки</th>
                      <th className="px-4 py-2.5 text-right font-medium">Цена продажи</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-2.5 font-medium">Название</th>
                      <th className="px-4 py-2.5 font-medium">Артикул</th>
                      <th className="px-4 py-2.5 font-medium">Категория</th>
                      <th className="px-4 py-2.5 text-right font-medium">Кол-во продаж</th>
                      <th className="px-4 py-2.5 text-right font-medium">{tab === 'profit' ? 'Прибыль' : 'Доход'}</th>
                      <th className="px-4 py-2.5 text-right font-medium">Остаток</th>
                    </>
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
                        <td className={`px-4 py-2.5 text-right font-medium tabular-nums ${tab === 'profit' ? 'text-emerald-300' : 'text-sky-300'}`}>
                          {fmt(tab === 'profit' ? it.profit : it.revenue)} ₸
                          {tab === 'profit' && <span className="ml-1 text-[11px] text-slate-500">{it.margin_percent}%</span>}
                        </td>
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
    </div>
  )
}

function Kpi({ label, value, accent, icon, big }: { label: string; value: string; accent: string; icon: React.ReactNode; big?: boolean }) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        <span className="text-slate-400">{icon}</span>
      </div>
      <div className={`mt-1.5 font-bold tabular-nums ${accent} ${big ? 'text-2xl' : 'text-xl'}`}>{value}</div>
    </div>
  )
}
