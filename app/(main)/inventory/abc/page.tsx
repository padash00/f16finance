'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import Link from 'next/link'
import {
  AlertTriangle,
  Download,
  Edit2,
  Lightbulb,
  PieChart,
  RefreshCw,
  Search,
  Trash2,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { InventoryLegacyRedirect } from '../legacy-redirect'

// ─── Types ────────────────────────────────────────────────────────────────────

type AbcClass = 'A' | 'B' | 'C'

type AbcItem = {
  item_id: string
  name: string
  category: string | null
  sale_price: number
  purchase_price: number
  revenue: number
  qty: number
  transactions: number
  revenue_percent: number
  cumulative_percent: number
  abc_class: AbcClass
  margin: number
  margin_percent: number
}

type Summary = {
  total_revenue: number
  count_a: number
  count_b: number
  count_c: number
  revenue_a: number
  revenue_b: number
  revenue_c: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-KZ', {
    style: 'currency',
    currency: 'KZT',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNum(value: number) {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
}

const CLASS_BADGE: Record<AbcClass, string> = {
  A: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  B: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  C: 'bg-red-500/20 text-red-400 border-red-500/30',
}

const CLASS_ROW: Record<AbcClass, string> = {
  A: 'bg-emerald-500/[0.04]',
  B: 'bg-yellow-500/[0.04]',
  C: 'bg-red-500/[0.04]',
}

const PERIOD_OPTIONS = [
  { label: '7 дней', value: 7 },
  { label: '30 дней', value: 30 },
  { label: '90 дней', value: 90 },
  { label: '365 дней', value: 365 },
]

// ─── Main Component ────────────────────────────────────────────────────────────

export function AbcAnalysisPageContent() {
  const [items, setItems] = useState<AbcItem[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [days, setDays] = useState(30)

  // Filters
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState<AbcClass | 'all'>('all')
  const [categoryFilter, setCategoryFilter] = useState('')

  // Price edit modal
  const [editItem, setEditItem] = useState<AbcItem | null>(null)
  const [editPrice, setEditPrice] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ days: String(days) })
      const res = await fetch(`/api/admin/inventory/abc?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки')
      setItems(json.data || [])
      setSummary(json.summary || null)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => {
    void load()
  }, [load])

  // Derived categories list
  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      if (item.category) set.add(item.category)
    }
    return Array.from(set).sort()
  }, [items])

  // Filtered items
  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (classFilter !== 'all' && item.abc_class !== classFilter) return false
      if (categoryFilter && item.category !== categoryFilter) return false
      if (search) {
        const q = search.toLowerCase()
        if (!item.name.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [items, classFilter, categoryFilter, search])

  // Recommendations
  const recommendations = useMemo(() => {
    const recs: string[] = []
    const totalItems = items.length
    const cCount = items.filter((i) => i.abc_class === 'C').length
    if (totalItems > 0 && cCount / totalItems > 0.5) {
      recs.push('Рассмотрите списание неходовых товаров класса C')
    }
    const aLowMargin = items.filter((i) => i.abc_class === 'A' && i.margin_percent < 10 && i.revenue > 0)
    if (aLowMargin.length > 0) {
      recs.push('Товары класса A с низкой маржой требуют пересмотра цен')
    }
    const aZeroBalance = items.filter((i) => i.abc_class === 'A' && i.qty === 0 && i.revenue > 0)
    if (aZeroBalance.length > 0) {
      recs.push('Критично: товары класса A заканчиваются')
    }
    return recs
  }, [items])

  // Export Excel
  async function exportCsv() {
    const wb = createWorkbook()
    const today = new Date().toLocaleDateString('ru-RU')
    const abcRows = filtered.map((item, idx) => ({
      num: idx + 1,
      cls: item.abc_class,
      name: item.name,
      category: item.category || '',
      revenue: item.revenue,
      revPct: item.revenue_percent,
      qty: item.qty,
      transactions: item.transactions,
      margin: item.margin,
      marginPct: item.margin_percent,
    }))
    buildStyledSheet(wb, 'ABC-анализ', 'ABC-анализ товаров', `Экспорт: ${today} | Позиций: ${filtered.length}`, [
      { header: '#', key: 'num', width: 6, type: 'number', align: 'right' },
      { header: 'Класс', key: 'cls', width: 8, type: 'text', align: 'center' },
      { header: 'Наименование', key: 'name', width: 30, type: 'text' },
      { header: 'Категория', key: 'category', width: 18, type: 'text' },
      { header: 'Выручка', key: 'revenue', width: 16, type: 'money' },
      { header: '% от итого', key: 'revPct', width: 12, type: 'percent' },
      { header: 'Кол-во', key: 'qty', width: 10, type: 'number', align: 'right' },
      { header: 'Сделок', key: 'transactions', width: 10, type: 'number', align: 'right' },
      { header: 'Маржа', key: 'margin', width: 16, type: 'money' },
      { header: 'Маржа %', key: 'marginPct', width: 12, type: 'percent' },
    ], abcRows)
    await downloadWorkbook(wb, `abc_analysis_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  // Open price edit
  function openEdit(item: AbcItem) {
    setEditItem(item)
    setEditPrice(String(item.sale_price || ''))
    setEditError(null)
  }

  // Save price
  async function handleSavePrice(e: React.FormEvent) {
    e.preventDefault()
    if (!editItem) return
    const price = parseFloat(editPrice)
    if (isNaN(price) || price < 0) {
      setEditError('Введите корректную цену')
      return
    }
    setEditSaving(true)
    setEditError(null)
    try {
      const res = await fetch('/api/admin/inventory/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateItem',
          item_id: editItem.item_id,
          fields: { sale_price: price },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      // Update local state
      setItems((prev) =>
        prev.map((i) => (i.item_id === editItem.item_id ? { ...i, sale_price: price } : i))
      )
      setEditItem(null)
    } catch (err: any) {
      setEditError(err?.message || 'Ошибка сохранения')
    } finally {
      setEditSaving(false)
    }
  }

  // Revenue percent of total for summary cards
  const totalRevenue = summary?.total_revenue || 0
  const revenuePercentA =
    totalRevenue > 0 ? Math.round(((summary?.revenue_a || 0) / totalRevenue) * 100) : 0
  const revenuePercentB =
    totalRevenue > 0 ? Math.round(((summary?.revenue_b || 0) / totalRevenue) * 100) : 0
  const revenuePercentC =
    totalRevenue > 0 ? Math.round(((summary?.revenue_c || 0) / totalRevenue) * 100) : 0

  return (
    <div className="app-page">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <PieChart className="h-6 w-6 text-emerald-400" />
            ABC-анализ товаров
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Классификация товаров по вкладу в выручку
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Period selector */}
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setDays(opt.value)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  days === opt.value
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Скачать Excel
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      {loading ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Card key={i}>
              <CardContent className="p-4">
                <div className="h-4 w-16 rounded bg-white/10 animate-pulse mb-2" />
                <div className="h-7 w-24 rounded bg-white/10 animate-pulse mb-1" />
                <div className="h-3 w-20 rounded bg-white/10 animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : summary ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          {/* Class A */}
          <Card className="border-emerald-500/20 bg-emerald-500/[0.04]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-emerald-400">
                  Класс A
                </span>
                <Badge className={CLASS_BADGE['A']}>A</Badge>
              </div>
              <p className="text-2xl font-bold">{summary.count_a} товаров</p>
              <p className="text-sm text-emerald-400 font-medium mt-0.5">
                {formatMoney(summary.revenue_a)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{revenuePercentA}% от выручки</p>
            </CardContent>
          </Card>
          {/* Class B */}
          <Card className="border-yellow-500/20 bg-yellow-500/[0.04]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-yellow-400">
                  Класс B
                </span>
                <Badge className={CLASS_BADGE['B']}>B</Badge>
              </div>
              <p className="text-2xl font-bold">{summary.count_b} товаров</p>
              <p className="text-sm text-yellow-400 font-medium mt-0.5">
                {formatMoney(summary.revenue_b)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{revenuePercentB}% от выручки</p>
            </CardContent>
          </Card>
          {/* Class C */}
          <Card className="border-red-500/20 bg-red-500/[0.04]">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-red-400">
                  Класс C
                </span>
                <Badge className={CLASS_BADGE['C']}>C</Badge>
              </div>
              <p className="text-2xl font-bold">{summary.count_c} товаров</p>
              <p className="text-sm text-red-400 font-medium mt-0.5">
                {formatMoney(summary.revenue_c)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{revenuePercentC}% от выручки</p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3 items-center">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по наименованию..."
                className="pl-10"
              />
            </div>

            {/* ABC class filter */}
            <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-1">
              {(['all', 'A', 'B', 'C'] as const).map((cls) => (
                <button
                  key={cls}
                  onClick={() => setClassFilter(cls)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    classFilter === cls
                      ? cls === 'A'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : cls === 'B'
                        ? 'bg-yellow-500/20 text-yellow-400'
                        : cls === 'C'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-white/10 text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {cls === 'all' ? 'Все' : `Класс ${cls}`}
                </button>
              ))}
            </div>

            {/* Category filter */}
            {categories.length > 0 && (
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-emerald-500/50"
              >
                <option value="">Все категории</option>
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="space-y-0">
              {Array.from({ length: 8 }).map((_, i) => (
                <div
                  key={i}
                  className="flex items-center gap-4 px-4 py-3 border-b border-white/5"
                >
                  <div className="h-4 w-6 rounded bg-white/10 animate-pulse" />
                  <div className="h-5 w-8 rounded bg-white/10 animate-pulse" />
                  <div className="h-4 flex-1 rounded bg-white/10 animate-pulse" />
                  <div className="h-4 w-20 rounded bg-white/10 animate-pulse" />
                  <div className="h-4 w-24 rounded bg-white/10 animate-pulse" />
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Товары не найдены
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground w-10">#</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground w-16">
                      ABC класс
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Наименование
                    </th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                      Категория
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Выручка (₸)
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      % от итого
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Кол-во продано
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Сделок
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Маржа (₸)
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Маржа %
                    </th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">
                      Действия
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((item, idx) => (
                    <tr
                      key={item.item_id}
                      className={`border-b border-white/5 hover:bg-white/[0.02] ${CLASS_ROW[item.abc_class]}`}
                    >
                      <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${CLASS_BADGE[item.abc_class]}`}
                        >
                          {item.abc_class}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium truncate max-w-[200px]">{item.name}</p>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {item.category || '—'}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">
                        {item.revenue > 0 ? formatMoney(item.revenue) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {item.revenue_percent > 0 ? `${item.revenue_percent}%` : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {item.qty > 0 ? formatNum(item.qty) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-muted-foreground">
                        {item.transactions > 0 ? item.transactions : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.margin !== 0 ? (
                          <span
                            className={item.margin > 0 ? 'text-emerald-400' : 'text-rose-400'}
                          >
                            {formatMoney(item.margin)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.margin_percent !== 0 ? (
                          <span
                            className={
                              item.margin_percent < 10
                                ? 'text-rose-400'
                                : item.margin_percent < 25
                                ? 'text-yellow-400'
                                : 'text-emerald-400'
                            }
                          >
                            {item.margin_percent}%
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end items-center gap-1">
                          <Link
                            href={`/store/requests?item_id=${item.item_id}`}
                            title="Создать заявку"
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-sky-400 hover:bg-sky-500/10 transition-colors"
                          >
                            Заявка
                          </Link>
                          <button
                            onClick={() => openEdit(item)}
                            title="Изменить цену"
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-amber-400 hover:bg-amber-500/10 transition-colors"
                          >
                            <Edit2 className="h-3 w-3" />
                            Цена
                          </button>
                          <Link
                            href={`/store/writeoffs?item_id=${item.item_id}`}
                            title="Списать"
                            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-rose-400 hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 className="h-3 w-3" />
                            Списать
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      {!loading && recommendations.length > 0 && (
        <Card className="mt-6 border-amber-500/20 bg-amber-500/[0.04]">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base text-amber-400">
              <Lightbulb className="h-4 w-4" />
              Рекомендации AI
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="space-y-2">
              {recommendations.map((rec, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
                  <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                  {rec}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Price Edit Modal */}
      <Dialog open={!!editItem} onOpenChange={(open) => { if (!open) setEditItem(null) }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Изменить цену продажи</DialogTitle>
          </DialogHeader>
          {editItem && (
            <form onSubmit={(e) => void handleSavePrice(e)} className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
                <p className="font-medium">{editItem.name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Текущая цена: <span className="text-foreground font-semibold">{formatMoney(editItem.sale_price)}</span>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Новая цена (₸)</Label>
                <Input
                  value={editPrice}
                  onChange={(e) => setEditPrice(e.target.value)}
                  placeholder="Например: 1500"
                  type="number"
                  min="0"
                  step="0.01"
                  autoFocus
                />
              </div>
              {editError && <p className="text-sm text-rose-400">{editError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditItem(null)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={editSaving}>
                  {editSaving ? 'Сохранение...' : 'Сохранить'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function AbcAnalysisPage() {
  return <InventoryLegacyRedirect href="/store/abc" />
}
