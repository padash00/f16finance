'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertTriangle,
  ArrowRight,
  Package,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'

// ==================== TYPES ====================

type DashboardData = {
  today: {
    total: number
    count: number
    cash: number
    kaspi: number
    card: number
    online: number
  }
  yesterday: { total: number }
  change_percent: number | null
  month_total: number
  week_by_day: Record<string, number>
  top_items: Array<{ item_id: string; name: string; qty: number }>
  low_stock: Array<{ id: string; name: string; threshold: number; balance: number }>
  recent_sales: Array<{
    id: string
    sold_at: string
    total_amount: number
    payment_method: string | null
    items_count: number
  }>
}

// ==================== HELPERS ====================

function fmt(n: number): string {
  return n.toLocaleString('ru-KZ', { maximumFractionDigits: 0 })
}

function fmtTime(isoStr: string): string {
  try {
    const d = new Date(isoStr)
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return isoStr
  }
}

const DAY_LABELS: Record<number, string> = {
  0: 'Вс',
  1: 'Пн',
  2: 'Вт',
  3: 'Ср',
  4: 'Чт',
  5: 'Пт',
  6: 'Сб',
}

function getDayLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00')
    return DAY_LABELS[d.getDay()] ?? dateStr.slice(5)
  } catch {
    return dateStr.slice(5)
  }
}

const PAYMENT_LABELS: Record<string, string> = {
  cash: 'Наличные',
  kaspi: 'Kaspi',
  card: 'Карта',
  online: 'Онлайн',
  mixed: 'Смешанный',
}

function getPaymentLabel(method: string | null): string {
  if (!method) return 'Не указан'
  return PAYMENT_LABELS[method] ?? method
}

const PAYMENT_COLORS: Record<string, string> = {
  cash: 'bg-emerald-100 text-emerald-800',
  kaspi: 'bg-orange-100 text-orange-800',
  card: 'bg-blue-100 text-blue-800',
  online: 'bg-purple-100 text-purple-800',
  mixed: 'bg-gray-100 text-gray-800',
}

function getPaymentBadgeClass(method: string | null): string {
  if (!method) return 'bg-gray-100 text-gray-600'
  return PAYMENT_COLORS[method] ?? 'bg-gray-100 text-gray-600'
}

const RANK_CLASSES = [
  'bg-yellow-400 text-yellow-900',  // 1st - gold
  'bg-gray-300 text-gray-800',       // 2nd - silver
  'bg-amber-600 text-amber-50',      // 3rd - bronze
]

// ==================== SUB-COMPONENTS ====================

function StatCard({
  label,
  value,
  sub,
  icon,
  alert,
}: {
  label: string
  value: string
  sub?: React.ReactNode
  icon: React.ReactNode
  alert?: boolean
}) {
  return (
    <div className={`bg-white rounded-2xl shadow-sm border p-5 flex flex-col gap-2 ${alert ? 'border-red-200 bg-red-50' : 'border-gray-100'}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500 font-medium">{label}</span>
        <span className={`p-2 rounded-xl ${alert ? 'bg-red-100 text-red-600' : 'bg-gray-50 text-gray-400'}`}>
          {icon}
        </span>
      </div>
      <div className={`text-2xl font-bold tracking-tight ${alert ? 'text-red-700' : 'text-gray-900'}`}>
        {value}
      </div>
      {sub && <div className="text-xs">{sub}</div>}
    </div>
  )
}

function PaymentBreakdown({ today }: { today: DashboardData['today'] }) {
  const total = today.total || 1
  const items = [
    { label: 'Наличные', amount: today.cash, color: 'bg-emerald-500' },
    { label: 'Kaspi', amount: today.kaspi, color: 'bg-orange-500' },
    { label: 'Карта', amount: today.card, color: 'bg-blue-500' },
    { label: 'Онлайн', amount: today.online, color: 'bg-purple-500' },
  ]

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Оплата сегодня</h3>
      <div className="space-y-3">
        {items.map((item) => {
          const pct = total > 0 ? Math.round((item.amount / total) * 100) : 0
          return (
            <div key={item.label}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">{item.label}</span>
                <span className="font-medium text-gray-800">{fmt(item.amount)} ₸ <span className="text-gray-400 font-normal">({pct}%)</span></span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div
                  className={`${item.color} h-2 rounded-full transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekChart({ weekByDay }: { weekByDay: Record<string, number> }) {
  const entries = Object.entries(weekByDay).sort(([a], [b]) => a.localeCompare(b))
  const maxVal = Math.max(...entries.map(([, v]) => v), 1)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Выручка за 7 дней</h3>
      {entries.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Нет данных</p>
      ) : (
        <div className="flex items-end gap-2 h-28">
          {entries.map(([date, val]) => {
            const heightPct = Math.max((val / maxVal) * 100, 4)
            return (
              <div key={date} className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <span className="text-xs text-gray-500 truncate hidden sm:block">{fmt(val)}</span>
                <div className="w-full flex items-end justify-center" style={{ height: 72 }}>
                  <div
                    className="w-full rounded-t-md bg-indigo-400 hover:bg-indigo-500 transition-colors"
                    style={{ height: `${heightPct}%` }}
                    title={`${date}: ${fmt(val)} ₸`}
                  />
                </div>
                <span className="text-xs text-gray-500">{getDayLabel(date)}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TopItems({ items }: { items: DashboardData['top_items'] }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Топ-5 товаров за неделю</h3>
      {items.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Нет данных</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item, idx) => (
            <li key={item.item_id} className="flex items-center gap-3">
              <span
                className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold flex-shrink-0 ${
                  RANK_CLASSES[idx] ?? 'bg-gray-100 text-gray-600'
                }`}
              >
                {idx + 1}
              </span>
              <span className="flex-1 text-sm text-gray-700 truncate">{item.name}</span>
              <span className="text-sm font-semibold text-gray-900 flex-shrink-0">{fmt(item.qty)} шт</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function LowStockAlerts({ items }: { items: DashboardData['low_stock'] }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700">Низкий остаток</h3>
        {items.length > 0 && (
          <Link href="/inventory/requests">
            <Button variant="outline" size="sm" className="text-xs h-7 gap-1">
              Создать заявку <ArrowRight className="w-3 h-3" />
            </Button>
          </Link>
        )}
      </div>
      {items.length === 0 ? (
        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3">
          <span className="text-lg">✓</span>
          <span className="text-sm font-medium">Всё в порядке — склад в норме</span>
        </div>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.id} className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-3 py-2 gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                <span className="text-sm text-gray-800 truncate">{item.name}</span>
              </div>
              <div className="text-xs text-red-700 flex-shrink-0 text-right">
                <span className="font-semibold">{fmt(item.balance)}</span>
                <span className="text-red-400"> / {fmt(item.threshold)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function RecentSales({ sales }: { sales: DashboardData['recent_sales'] }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">Последние продажи</h3>
      {sales.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">Нет продаж</p>
      ) : (
        <div className="overflow-y-auto max-h-72 space-y-1 pr-1">
          {sales.map((sale) => (
            <div key={sale.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
              <span className="text-xs text-gray-400 w-10 flex-shrink-0">{fmtTime(sale.sold_at)}</span>
              <span className="font-semibold text-gray-900 text-sm flex-1">{fmt(sale.total_amount)} ₸</span>
              <span className={`text-xs px-2 py-0.5 rounded-md font-medium flex-shrink-0 ${getPaymentBadgeClass(sale.payment_method)}`}>
                {getPaymentLabel(sale.payment_method)}
              </span>
              <span className="text-xs text-gray-400 flex-shrink-0">{sale.items_count} шт</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ==================== MAIN PAGE ====================

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      setError(null)
      const res = await fetch('/api/admin/dashboard', { credentials: 'include' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Ошибка загрузки')
      setData(json.data as DashboardData)
      setLastUpdated(new Date())
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, 60_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [load])

  const handleRefresh = () => {
    setLoading(true)
    load()
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Дашборд</h1>
          {lastUpdated && (
            <p className="text-xs text-gray-400 mt-0.5">
              Обновлено в {fmtTime(lastUpdated.toISOString())}
            </p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-5 animate-pulse h-28" />
          ))}
        </div>
      )}

      {data && (
        <>
          {/* Row 1: Stat cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Сегодня"
              value={`${fmt(data.today.total)} ₸`}
              icon={<TrendingUp className="w-5 h-5" />}
              sub={
                data.change_percent !== null ? (
                  <span className={data.change_percent >= 0 ? 'text-emerald-600 font-semibold' : 'text-red-600 font-semibold'}>
                    {data.change_percent >= 0 ? '↑' : '↓'} {Math.abs(data.change_percent)}% vs вчера
                  </span>
                ) : (
                  <span className="text-gray-400">Нет данных за вчера</span>
                )
              }
            />
            <StatCard
              label="Продаж сегодня"
              value={String(data.today.count)}
              icon={<ShoppingCart className="w-5 h-5" />}
              sub={
                data.today.count > 0 ? (
                  <span className="text-gray-500">
                    ~{fmt(Math.round(data.today.total / data.today.count))} ₸ / продажа
                  </span>
                ) : undefined
              }
            />
            <StatCard
              label="Месяц"
              value={`${fmt(data.month_total)} ₸`}
              icon={<TrendingUp className="w-5 h-5" />}
            />
            <StatCard
              label="Низкий остаток"
              value={String(data.low_stock.length)}
              icon={
                data.low_stock.length > 0
                  ? <AlertTriangle className="w-5 h-5" />
                  : <Package className="w-5 h-5" />
              }
              alert={data.low_stock.length > 0}
              sub={
                data.low_stock.length > 0 ? (
                  <span className="text-red-600 font-medium">Требуется пополнение</span>
                ) : (
                  <span className="text-emerald-600 font-medium">Всё в норме</span>
                )
              }
            />
          </div>

          {/* Row 2: Payment breakdown + Week chart */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <PaymentBreakdown today={data.today} />
            <WeekChart weekByDay={data.week_by_day} />
          </div>

          {/* Row 3: Top items + Low stock */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TopItems items={data.top_items} />
            <LowStockAlerts items={data.low_stock} />
          </div>

          {/* Row 4: Recent sales (full width) */}
          <RecentSales sales={data.recent_sales} />
        </>
      )}
    </div>
  )
}
