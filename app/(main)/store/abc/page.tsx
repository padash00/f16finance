'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  BarChart3,
  Download,
  PackageX,
  RefreshCw,
  Search,
  TrendingUp,
} from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { isAbortError } from '@/lib/is-abort-error'

type AbcClass = 'A' | 'B' | 'C'
type XyzClass = 'X' | 'Y' | 'Z'

type AbcRow = {
  item_id: string
  name: string
  category: string | null
  sale_price: number
  purchase_price: number
  revenue?: number
  qty: number
  transactions?: number
  revenue_percent?: number
  cumulative_percent?: number
  abc_class: AbcClass
  xyz_class?: XyzClass
  margin?: number
  margin_percent?: number
  stock_qty?: number
  stock_value?: number
}

type AbcSummary = {
  total_revenue?: number
  total_value?: number
  count_a?: number
  count_b?: number
  count_c?: number
  revenue_a?: number
  revenue_b?: number
  revenue_c?: number
  value_a?: number
  value_b?: number
  value_c?: number
  slow_movers_count?: number
  slow_movers_value?: number
  abc_xyz_matrix?: Record<string, { count: number; revenue: number }>
}

type AbcResponse = {
  ok: boolean
  data?: AbcRow[]
  slow_movers?: AbcRow[]
  summary?: AbcSummary
  mode?: 'sales' | 'stock'
  days?: number
  error?: string
}

type SortKey = 'revenue' | 'qty' | 'stock_qty' | 'stock_value' | 'margin_percent' | 'name'

const PERIODS = [
  { value: 7, label: '7 дней' },
  { value: 30, label: '30 дней' },
  { value: 90, label: '90 дней' },
  { value: 365, label: 'Год' },
] as const

function fmt(n: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n || 0))
}

const ABC_COLORS: Record<AbcClass, string> = {
  A: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
  B: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
  C: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
}

const XYZ_LABEL: Record<XyzClass, string> = {
  X: 'Стабильный спрос',
  Y: 'Средне-стабильный',
  Z: 'Непредсказуемый',
}

export default function StoreAbcPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [tab, setTab] = useState<'sales' | 'stock'>('sales')
  const [period, setPeriod] = useState<number>(30)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<AbcRow[]>([])
  const [slowMovers, setSlowMovers] = useState<AbcRow[]>([])
  const [summary, setSummary] = useState<AbcSummary>({})
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState<'all' | AbcClass>('all')
  const [categoryFilter, setCategoryFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const load = async (mode: 'sales' | 'stock' = tab, days: number = period, signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/inventory/abc?mode=${mode}&days=${days}`, {
        cache: 'no-store',
        signal,
      })
      const json = (await res.json().catch(() => null)) as AbcResponse | null
      if (signal?.aborted) return
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить ABC')
      setRows(json.data || [])
      setSlowMovers(json.slow_movers || [])
      setSummary(json.summary || {})
    } catch (e: any) {
      if (isAbortError(e) || signal?.aborted) return
      setRows([])
      setSlowMovers([])
      setSummary({})
      setError(e?.message || 'Не удалось загрузить ABC')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(tab, period, ac.signal)
    return () => ac.abort()
  }, [tab, period])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) if (r.category) set.add(r.category)
    return Array.from(set).sort()
  }, [rows])

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase()
    let list = rows.filter((r) => {
      if (classFilter !== 'all' && r.abc_class !== classFilter) return false
      if (categoryFilter !== 'all' && (r.category || 'Без категории') !== categoryFilter) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      return true
    })
    list = list.slice().sort((a, b) => {
      const dir = sortDir === 'desc' ? -1 : 1
      const av = (a as any)[sortKey]
      const bv = (b as any)[sortKey]
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * dir
      return ((Number(av) || 0) - (Number(bv) || 0)) * dir
    })
    return list
  }, [rows, classFilter, categoryFilter, search, sortKey, sortDir])

  const totalForBar = tab === 'sales' ? summary.total_revenue || 0 : summary.total_value || 0
  const sumA = tab === 'sales' ? summary.revenue_a || 0 : summary.value_a || 0
  const sumB = tab === 'sales' ? summary.revenue_b || 0 : summary.value_b || 0
  const sumC = tab === 'sales' ? summary.revenue_c || 0 : summary.value_c || 0
  const pctA = totalForBar > 0 ? (sumA / totalForBar) * 100 : 0
  const pctB = totalForBar > 0 ? (sumB / totalForBar) * 100 : 0
  const pctC = totalForBar > 0 ? (sumC / totalForBar) * 100 : 0

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const exportCsv = () => {
    const headers = ['Класс', 'XYZ', 'Название', 'Категория', tab === 'sales' ? 'Выручка' : 'Стоимость склада', 'Кол-во', 'Остаток', 'Маржа %', 'Доля %']
    const lines = [headers.join(',')]
    for (const r of filteredRows) {
      const moneyValue = tab === 'sales' ? r.revenue || 0 : r.stock_value || 0
      const cells = [
        r.abc_class,
        r.xyz_class || '—',
        `"${r.name.replace(/"/g, '""')}"`,
        `"${(r.category || '').replace(/"/g, '""')}"`,
        moneyValue,
        r.qty,
        r.stock_qty || 0,
        r.margin_percent || 0,
        r.revenue_percent || 0,
      ]
      lines.push(cells.join(','))
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `abc-${tab}-${period}d-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className={embedded ? 'space-y-6' : 'app-page-wide space-y-6'}>
      {(() => {
        const hdrActions = (
          <>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={exportCsv} disabled={filteredRows.length === 0}>
              <Download className="h-3.5 w-3.5" />
              CSV
            </Button>
            <Button variant="outline" size="sm" className="h-9 gap-1.5" onClick={() => void load(tab, period)} disabled={loading}>
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </>
        )
        const hdrToolbar = (
          <div className="flex flex-wrap items-center gap-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-0.5">
              <button
                type="button"
                onClick={() => setTab('sales')}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === 'sales' ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                По продажам
              </button>
              <button
                type="button"
                onClick={() => setTab('stock')}
                className={`rounded-lg px-3 py-1.5 text-sm transition ${tab === 'stock' ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                По запасам
              </button>
            </div>
            {tab === 'sales' ? (
              <div className="inline-flex rounded-xl border border-white/10 bg-white/[0.03] p-0.5">
                {PERIODS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setPeriod(p.value)}
                    className={`rounded-lg px-3 py-1.5 text-xs transition ${period === p.value ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )
        return embedded ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {hdrToolbar}
            <div className="flex flex-wrap items-center gap-2">{hdrActions}</div>
          </div>
        ) : (
          <AdminPageHeader
            title="ABC-анализ"
            description={tab === 'sales' ? `По продажам · ${period} дн` : 'По текущим запасам склада'}
            icon={<BarChart3 className="h-5 w-5" />}
            accent="emerald"
            backHref="/"
            actions={hdrActions}
            toolbar={hdrToolbar}
          />
        )
      })()}

      {error ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div> : null}

      {/* KPI карточки A/B/C */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        {(['A', 'B', 'C'] as const).map((cls) => {
          const count = (summary as any)[`count_${cls.toLowerCase()}`] || 0
          const sum = cls === 'A' ? sumA : cls === 'B' ? sumB : sumC
          const pct = cls === 'A' ? pctA : cls === 'B' ? pctB : pctC
          const subtitle = cls === 'A' ? 'Звёзды — поддерживать наличие' : cls === 'B' ? 'Середняки — отслеживать' : 'Хвост — пересмотреть ассортимент'
          return (
            <Card key={cls} className={`p-4 ${ABC_COLORS[cls]}`}>
              <div className="flex items-baseline justify-between">
                <p className="text-xs uppercase tracking-widest opacity-80">Класс {cls}</p>
                <span className="text-xs opacity-70">{count} тов.</span>
              </div>
              <p className="mt-1 text-2xl font-bold tabular-nums">{fmt(sum)} ₸</p>
              <p className="text-xs opacity-70">{pct.toFixed(1)}% от {tab === 'sales' ? 'выручки' : 'запаса'}</p>
              <p className="mt-1 text-[10px] opacity-60">{subtitle}</p>
            </Card>
          )
        })}
      </div>

      {/* Pareto-кривая */}
      {totalForBar > 0 ? (
        <Card className="border-white/10 bg-card/70 p-4">
          <div className="mb-2 flex items-baseline justify-between text-xs">
            <span className="font-semibold uppercase tracking-wider text-muted-foreground">Структура {tab === 'sales' ? 'выручки' : 'запаса'}</span>
            <span className="text-muted-foreground">100% = {fmt(totalForBar)} ₸</span>
          </div>
          <div className="flex h-6 overflow-hidden rounded-md ring-1 ring-white/10">
            {[{ pct: pctA, color: '#10b981', label: 'A' }, { pct: pctB, color: '#f59e0b', label: 'B' }, { pct: pctC, color: '#fb7185', label: 'C' }]
              .filter((b) => b.pct > 0)
              .map((b) => (
                <div
                  key={b.label}
                  style={{ width: `${b.pct}%`, background: b.color }}
                  className="flex items-center justify-center text-[10px] font-bold text-white"
                  title={`${b.label}: ${b.pct.toFixed(1)}%`}
                >
                  {b.pct >= 6 ? `${b.label} ${b.pct.toFixed(0)}%` : ''}
                </div>
              ))}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Правило Парето: {((summary.count_a || 0) / Math.max(rows.length, 1) * 100).toFixed(0)}% товаров (класс A) дают {pctA.toFixed(0)}% {tab === 'sales' ? 'выручки' : 'стоимости'}.
          </p>
        </Card>
      ) : null}

      {/* Slow-movers — мёртвый запас */}
      {slowMovers.length > 0 ? (
        <Card className="border-orange-500/25 bg-orange-500/[0.05] p-4">
          <div className="mb-2 flex items-center gap-2">
            <PackageX className="h-4 w-4 text-orange-300" />
            <h2 className="text-sm font-semibold text-orange-200">Мёртвый запас</h2>
            <span className="text-[11px] text-orange-200/70">
              · {slowMovers.length} {slowMovers.length === 1 ? 'товар' : 'товаров'} без продаж за {period} дн
            </span>
            <span className="ml-auto text-sm font-bold tabular-nums text-orange-200">
              {fmt(summary.slow_movers_value || 0)} ₸ заморожено
            </span>
          </div>
          <div className="grid gap-1 md:grid-cols-2">
            {slowMovers.slice(0, 10).map((r) => (
              <div key={r.item_id} className="flex items-baseline justify-between gap-2 rounded-lg border border-orange-500/15 bg-black/20 px-2.5 py-1.5 text-xs">
                <div className="min-w-0">
                  <p className="truncate text-orange-100/90">{r.name}</p>
                  <p className="text-[10px] text-orange-200/60">{r.category || 'Без категории'} · остаток: {r.stock_qty}</p>
                </div>
                <p className="tabular-nums font-semibold text-orange-200">{fmt(r.stock_value || 0)} ₸</p>
              </div>
            ))}
          </div>
          {slowMovers.length > 10 ? (
            <p className="mt-2 text-[11px] text-orange-200/70">…и ещё {slowMovers.length - 10}. Полный список — в основной таблице, фильтр «класс C» + сортировка по остатку.</p>
          ) : null}
        </Card>
      ) : null}

      {/* Матрица ABC×XYZ */}
      {tab === 'sales' && summary.abc_xyz_matrix ? (
        <Card className="border-white/10 bg-card/70 p-4">
          <div className="mb-3 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-300" />
            <h2 className="text-sm font-semibold text-foreground">Матрица ABC × XYZ</h2>
            <span className="text-[11px] text-muted-foreground">· XYZ = стабильность спроса</span>
          </div>
          <div className="grid grid-cols-[80px_1fr_1fr_1fr] gap-1 text-xs">
            <div></div>
            <div className="text-center font-semibold text-emerald-300">X · стабильный</div>
            <div className="text-center font-semibold text-amber-300">Y · средний</div>
            <div className="text-center font-semibold text-rose-300">Z · нестабильный</div>
            {(['A', 'B', 'C'] as const).map((abc) => (
              <>
                <div key={`label-${abc}`} className="flex items-center justify-end pr-2 font-bold text-muted-foreground">{abc}</div>
                {(['X', 'Y', 'Z'] as const).map((xyz) => {
                  const cell = summary.abc_xyz_matrix?.[`${abc}${xyz}`]
                  const ideal = abc === 'A' && xyz === 'X'
                  const dead = abc === 'C' && xyz === 'Z'
                  return (
                    <div
                      key={`${abc}${xyz}`}
                      className={`rounded-lg border px-3 py-2 text-center ${ideal ? 'border-emerald-500/40 bg-emerald-500/10' : dead ? 'border-rose-500/30 bg-rose-500/5' : 'border-white/10 bg-white/[0.03]'}`}
                      title={ideal ? 'Идеальные товары: всегда продаются' : dead ? 'Кандидаты на вывод из ассортимента' : ''}
                    >
                      <div className="text-base font-bold">{cell?.count || 0}</div>
                      <div className="text-[10px] text-muted-foreground">{fmt(cell?.revenue || 0)} ₸</div>
                    </div>
                  )
                })}
              </>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            <span className="text-emerald-300">AX</span> = звёзды, всегда в наличии · <span className="text-rose-300">CZ</span> = кандидаты на удаление.
          </p>
        </Card>
      ) : null}

      {/* Фильтры */}
      <Card className="border-white/10 bg-card/70 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:max-w-xs">
            <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Поиск по названию…"
              className="h-9 pl-9 text-sm"
            />
          </div>
          <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
            {(['all', 'A', 'B', 'C'] as const).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setClassFilter(c)}
                className={`rounded-md px-2.5 py-1 transition ${classFilter === c ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {c === 'all' ? 'Все' : c}
              </button>
            ))}
          </div>
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-foreground outline-none"
          >
            <option value="all">Все категории</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <span className="ml-auto text-xs text-muted-foreground">
            Показано: {filteredRows.length} из {rows.length}
          </span>
        </div>
      </Card>

      {/* Таблица */}
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading && rows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Загрузка...</div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">Нет данных по выбранным фильтрам.</div>
        ) : (
          <div className="max-h-[600px] overflow-auto">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-14 py-2.5 pl-4 pr-2 font-normal">Класс</th>
                  <th className="cursor-pointer py-2.5 px-2 font-normal hover:text-foreground" onClick={() => handleSort('name')}>Товар</th>
                  <th className="w-32 py-2.5 px-2 font-normal">Категория</th>
                  <th className="w-24 cursor-pointer py-2.5 px-2 text-right font-normal hover:text-foreground" onClick={() => handleSort('revenue')}>
                    {tab === 'sales' ? 'Выручка' : 'Стоимость'}
                  </th>
                  <th className="w-20 cursor-pointer py-2.5 px-2 text-right font-normal hover:text-foreground" onClick={() => handleSort('qty')}>
                    {tab === 'sales' ? 'Продано' : '—'}
                  </th>
                  <th className="w-24 cursor-pointer py-2.5 px-2 text-right font-normal hover:text-foreground" onClick={() => handleSort('stock_qty')}>Остаток</th>
                  <th className="w-20 cursor-pointer py-2.5 px-2 text-right font-normal hover:text-foreground" onClick={() => handleSort('margin_percent')}>Маржа %</th>
                  <th className="w-16 py-2.5 px-2 pr-4 text-right font-normal">Доля</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredRows.map((r) => {
                  const moneyValue = tab === 'sales' ? r.revenue || 0 : r.stock_value || 0
                  const lowStock = (r.abc_class === 'A') && (r.stock_qty || 0) < (r.qty || 0) * 0.3
                  return (
                    <tr key={r.item_id} className="hover:bg-white/[0.02]">
                      <td className="py-2 pl-4 pr-2 align-middle">
                        <div className="flex flex-col items-start gap-0.5">
                          <span className={`inline-flex h-5 min-w-[20px] items-center justify-center rounded-md border px-1.5 text-[10px] font-bold ${ABC_COLORS[r.abc_class]}`}>
                            {r.abc_class}
                          </span>
                          {r.xyz_class ? (
                            <span className="text-[9px] text-muted-foreground" title={XYZ_LABEL[r.xyz_class]}>{r.xyz_class}</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="py-2 px-2 align-middle">
                        <p className="text-sm font-medium text-foreground">{r.name}</p>
                        {lowStock ? (
                          <p className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-amber-300">
                            <AlertTriangle className="h-3 w-3" /> Класс A, остаток на исходе
                          </p>
                        ) : null}
                      </td>
                      <td className="py-2 px-2 align-middle text-xs text-muted-foreground">
                        {r.category || '—'}
                      </td>
                      <td className="py-2 px-2 text-right align-middle tabular-nums font-semibold">
                        {fmt(moneyValue)}
                      </td>
                      <td className="py-2 px-2 text-right align-middle tabular-nums text-muted-foreground">
                        {tab === 'sales' ? r.qty : '—'}
                      </td>
                      <td className="py-2 px-2 text-right align-middle tabular-nums text-muted-foreground">
                        {r.stock_qty || 0}
                      </td>
                      <td className="py-2 px-2 text-right align-middle tabular-nums text-xs">
                        <span className={(r.margin_percent || 0) >= 30 ? 'text-emerald-300' : (r.margin_percent || 0) >= 15 ? 'text-amber-300' : 'text-rose-300'}>
                          {(r.margin_percent || 0).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-2 px-2 pr-4 text-right align-middle tabular-nums text-xs text-muted-foreground">
                        {(r.revenue_percent || 0).toFixed(1)}%
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
