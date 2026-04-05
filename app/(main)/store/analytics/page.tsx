'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Boxes, RefreshCw, Store } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { formatMoney } from '@/lib/core/format'

type InventoryLocation = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
  company?: { id: string; name: string; code: string | null } | null
}

type InventoryBalance = {
  location_id: string
  item_id: string
  quantity: number
  item?: { id: string; name: string; barcode: string; unit?: string | null; low_stock_threshold?: number | null } | null
  location?: InventoryLocation | null
}

type InventoryMovement = {
  id: string
  movement_type: string
  quantity: number
  total_amount: number | null
  created_at: string
  item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  from_location?: InventoryLocation | null
  to_location?: InventoryLocation | null
}

type AnalyticsResponse = {
  ok: boolean
  data?: {
    locations: InventoryLocation[]
    balances: InventoryBalance[]
    movements: InventoryMovement[]
  }
  error?: string
}

function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T) || null
  return value ?? null
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

export default function StoreAnalyticsPage() {
  const [data, setData] = useState<AnalyticsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/store/analytics', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as AnalyticsResponse | null
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить аналитику')

      setData({
        locations: (json.data.locations || []).map((location) => ({
          ...location,
          company: firstOrSelf(location.company),
        })),
        balances: (json.data.balances || []).map((balance) => ({
          ...balance,
          quantity: Number(balance.quantity || 0),
          item: firstOrSelf(balance.item),
          location: firstOrSelf(balance.location),
        })),
        movements: (json.data.movements || []).map((movement) => ({
          ...movement,
          quantity: Number(movement.quantity || 0),
          total_amount: movement.total_amount == null ? null : Number(movement.total_amount || 0),
          item: firstOrSelf(movement.item),
          from_location: firstOrSelf(movement.from_location),
          to_location: firstOrSelf(movement.to_location),
        })),
      })
    } catch (err: any) {
      setData(null)
      setError(err?.message || 'Не удалось загрузить аналитику')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const pointLocations = useMemo(
    () => (data?.locations || []).filter((location) => location.location_type === 'point_display'),
    [data?.locations],
  )

  const pointAnalytics = useMemo(() => {
    const summary = new Map<string, {
      location: InventoryLocation
      stockQty: number
      stockItems: number
      incomingQty: number
      incomingAmount: number
      saleQty: number
      saleAmount: number
      debtQty: number
      debtAmount: number
      returnQty: number
      returnAmount: number
      writeoffQty: number
      writeoffAmount: number
      adjustmentQty: number
      lastMovementAt: string | null
    }>()

    for (const location of pointLocations) {
      summary.set(location.id, {
        location,
        stockQty: 0,
        stockItems: 0,
        incomingQty: 0,
        incomingAmount: 0,
        saleQty: 0,
        saleAmount: 0,
        debtQty: 0,
        debtAmount: 0,
        returnQty: 0,
        returnAmount: 0,
        writeoffQty: 0,
        writeoffAmount: 0,
        adjustmentQty: 0,
        lastMovementAt: null,
      })
    }

    for (const balance of data?.balances || []) {
      const point = balance.location?.location_type === 'point_display' ? summary.get(balance.location_id) : null
      if (!point) continue
      point.stockQty += Number(balance.quantity || 0)
      point.stockItems += 1
    }

    for (const movement of data?.movements || []) {
      const qty = Number(movement.quantity || 0)
      const amount = Number(movement.total_amount || 0)
      const fromPoint = movement.from_location?.location_type === 'point_display' ? summary.get(movement.from_location.id) : null
      const toPoint = movement.to_location?.location_type === 'point_display' ? summary.get(movement.to_location.id) : null

      if (fromPoint && (!fromPoint.lastMovementAt || new Date(movement.created_at).getTime() > new Date(fromPoint.lastMovementAt).getTime())) {
        fromPoint.lastMovementAt = movement.created_at
      }
      if (toPoint && (!toPoint.lastMovementAt || new Date(movement.created_at).getTime() > new Date(toPoint.lastMovementAt).getTime())) {
        toPoint.lastMovementAt = movement.created_at
      }

      if (movement.movement_type === 'transfer_to_point' && toPoint) {
        toPoint.incomingQty += qty
        toPoint.incomingAmount += amount
      }
      if (movement.movement_type === 'sale' && fromPoint) {
        fromPoint.saleQty += qty
        fromPoint.saleAmount += amount
      }
      if (movement.movement_type === 'debt' && fromPoint) {
        fromPoint.debtQty += qty
        fromPoint.debtAmount += amount
      }
      if (movement.movement_type === 'return' && toPoint) {
        toPoint.returnQty += qty
        toPoint.returnAmount += amount
      }
      if (movement.movement_type === 'writeoff' && fromPoint) {
        fromPoint.writeoffQty += qty
        fromPoint.writeoffAmount += amount
      }
      if (movement.movement_type === 'inventory_adjustment') {
        if (fromPoint) fromPoint.adjustmentQty -= qty
        if (toPoint) toPoint.adjustmentQty += qty
      }
    }

    return [...summary.values()].sort((a, b) => {
      if (b.saleAmount !== a.saleAmount) return b.saleAmount - a.saleAmount
      return (a.location.company?.name || a.location.name).localeCompare(b.location.company?.name || b.location.name, 'ru')
    })
  }, [data?.balances, data?.movements, pointLocations])

  const riskyBalances = useMemo(() => {
    return (data?.balances || [])
      .filter((balance) => balance.location?.location_type === 'point_display')
      .filter((balance) => {
        const threshold = Number(balance.item?.low_stock_threshold || 0)
        return threshold > 0 && Number(balance.quantity || 0) <= threshold
      })
      .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0))
      .slice(0, 12)
  }, [data?.balances])

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
              <Store className="h-3.5 w-3.5" />
              Аналитика точек
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Как двигается товар по витринам</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              На этой странице видно, что пришло на каждую точку, сколько продали, сколько ушло в долг, сколько вернули и где уже есть риск по остаткам.
            </p>
          </div>

          <Button variant="outline" onClick={() => void load()} disabled={loading} className="rounded-2xl">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </Card>

      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_400px]">
        <Card className="border-white/10 p-5">
          <div className="flex items-center gap-2">
            <Boxes className="h-4 w-4 text-cyan-300" />
            <h2 className="text-lg font-semibold text-foreground">Сводка по витринам</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Главные цифры по каждой точке без лишней детализации.</p>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">Загружаем аналитику точек...</div>
            ) : pointAnalytics.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">Витрины пока пустые, поэтому аналитика ещё не собралась.</div>
            ) : (
              pointAnalytics.map((point) => (
                <div key={point.location.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{point.location.company?.name || point.location.name}</p>
                      <p className="text-xs text-muted-foreground">Последнее движение: {formatDateTime(point.lastMovementAt)}</p>
                    </div>
                    <div className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-muted-foreground">
                      {point.stockItems} SKU
                    </div>
                  </div>
                  <div className="mt-4 grid gap-2 md:grid-cols-4">
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">На витрине</p>
                      <p className="mt-1 font-semibold text-foreground">{formatQty(point.stockQty)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Пришло</p>
                      <p className="mt-1 font-semibold text-foreground">{formatQty(point.incomingQty)}</p>
                      <p className="text-xs text-muted-foreground">{formatMoney(point.incomingAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Продано</p>
                      <p className="mt-1 font-semibold text-foreground">{formatQty(point.saleQty)}</p>
                      <p className="text-xs text-muted-foreground">{formatMoney(point.saleAmount)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">В долг</p>
                      <p className="mt-1 font-semibold text-foreground">{formatQty(point.debtQty)}</p>
                      <p className="text-xs text-muted-foreground">{formatMoney(point.debtAmount)}</p>
                    </div>
                  </div>
                  <div className="mt-2 grid gap-2 md:grid-cols-3">
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Возвраты</p>
                      <p className="mt-1 font-semibold text-foreground">{formatQty(point.returnQty)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Списания</p>
                      <p className="mt-1 font-semibold text-foreground">{formatQty(point.writeoffQty)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Корректировка</p>
                      <p className="mt-1 font-semibold text-foreground">{formatQty(point.adjustmentQty)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-white/10 p-5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-300" />
            <h2 className="text-lg font-semibold text-foreground">Риск по витринам</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Товары на точках, которые уже подошли к порогу остатка.</p>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">Проверяем риски...</div>
            ) : riskyBalances.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">Критичных остатков на витринах сейчас нет.</div>
            ) : (
              riskyBalances.map((balance) => (
                <div key={`${balance.location_id}:${balance.item_id}`} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{balance.item?.name || 'Товар'}</p>
                      <p className="text-xs text-muted-foreground">{balance.location?.company?.name || balance.location?.name || 'Точка'}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground">{formatQty(Number(balance.quantity || 0))} {balance.item?.unit || 'шт'}</p>
                      <p className="text-xs text-amber-200">Порог: {Number(balance.item?.low_stock_threshold || 0)}</p>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </section>
    </div>
  )
}
