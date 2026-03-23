'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  ClipboardList,
  History,
  PackagePlus,
  RefreshCw,
  ScanSearch,
  Store,
} from 'lucide-react'

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

type InventoryRequest = {
  id: string
  status: string
  comment: string | null
  created_at: string
  company?: { id: string; name: string; code: string | null } | null
  source_location?: InventoryLocation | null
  target_location?: InventoryLocation | null
  items?: Array<{
    id: string
    requested_qty: number
    approved_qty: number | null
    item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  }>
}

type InventoryReceipt = {
  id: string
  received_at: string
  total_amount: number
  invoice_number: string | null
  supplier?: { id: string; name: string } | null
  location?: InventoryLocation | null
  items?: Array<{
    id: string
    quantity: number
    total_cost: number
    item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  }>
}

type InventoryMovement = {
  id: string
  movement_type: string
  quantity: number
  total_amount: number | null
  comment: string | null
  created_at: string
  item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  from_location?: InventoryLocation | null
  to_location?: InventoryLocation | null
}

type StoreOverviewResponse = {
  ok: boolean
  data?: {
    items: Array<{ id: string; name: string; barcode: string; unit: string; low_stock_threshold?: number | null }>
    locations: InventoryLocation[]
    balances: InventoryBalance[]
    requests: InventoryRequest[]
    receipts: InventoryReceipt[]
    movements: InventoryMovement[]
  }
  error?: string
}

function firstOrSelf<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return (value[0] as T) || null
  return value ?? null
}

function asArray<T>(value: T[] | T | null | undefined): T[] {
  if (Array.isArray(value)) return value
  if (value == null) return []
  return [value]
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

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsed)
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
}

function requestStatusLabel(status: string) {
  if (status === 'approved_full') return 'Одобрена полностью'
  if (status === 'approved_partial') return 'Одобрена частично'
  if (status === 'issued') return 'Выдана'
  if (status === 'received') return 'Получена'
  if (status === 'rejected') return 'Отклонена'
  if (status === 'disputed') return 'Спор'
  return 'Новая'
}

function requestStatusClass(status: string) {
  if (status === 'approved_full') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'approved_partial') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (status === 'issued') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
  if (status === 'received') return 'border-blue-500/30 bg-blue-500/10 text-blue-200'
  if (status === 'rejected') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (status === 'disputed') return 'border-orange-500/30 bg-orange-500/10 text-orange-200'
  return 'border-violet-500/30 bg-violet-500/10 text-violet-200'
}

function movementLabel(type: string) {
  if (type === 'receipt') return 'Приемка'
  if (type === 'transfer_to_point') return 'Выдача на точку'
  if (type === 'sale') return 'Продажа'
  if (type === 'debt') return 'Долг'
  if (type === 'return') return 'Возврат'
  if (type === 'writeoff') return 'Списание'
  if (type === 'inventory_adjustment') return 'Корректировка'
  return type
}

function actionLink(href: string, title: string, description: string, icon: ComponentType<{ className?: string }>) {
  const Icon = icon
  return (
    <Link
      key={href}
      href={href}
      className="group rounded-2xl border border-white/10 bg-white/[0.03] p-4 transition hover:border-emerald-400/30 hover:bg-white/[0.05]"
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-xl bg-emerald-500/10 p-2 text-emerald-300">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="font-medium text-foreground">{title}</p>
            <ArrowRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
    </Link>
  )
}

export default function StoreOverviewPage() {
  const [overview, setOverview] = useState<StoreOverviewResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/store/overview', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as StoreOverviewResponse | null
      if (!response.ok || !json?.ok || !json.data) {
        throw new Error(json?.error || 'Не удалось загрузить центр магазина')
      }

      setOverview({
        ...json.data,
        locations: asArray(json.data.locations).map((location) => ({
          ...location,
          company: firstOrSelf(location.company),
        })),
        balances: asArray(json.data.balances).map((balance) => ({
          ...balance,
          quantity: Number(balance.quantity || 0),
          item: firstOrSelf(balance.item),
          location: firstOrSelf(balance.location),
        })),
        requests: asArray(json.data.requests).map((request) => ({
          ...request,
          company: firstOrSelf(request.company),
          source_location: firstOrSelf(request.source_location),
          target_location: firstOrSelf(request.target_location),
          items: asArray(request.items).map((item) => ({
            ...item,
            requested_qty: Number(item.requested_qty || 0),
            approved_qty: item.approved_qty == null ? null : Number(item.approved_qty || 0),
            item: firstOrSelf(item.item),
          })),
        })),
        receipts: asArray(json.data.receipts).map((receipt) => ({
          ...receipt,
          total_amount: Number(receipt.total_amount || 0),
          supplier: firstOrSelf(receipt.supplier),
          location: firstOrSelf(receipt.location),
          items: asArray(receipt.items).map((item) => ({
            ...item,
            quantity: Number(item.quantity || 0),
            total_cost: Number(item.total_cost || 0),
            item: firstOrSelf(item.item),
          })),
        })),
        movements: asArray(json.data.movements).map((movement) => ({
          ...movement,
          quantity: Number(movement.quantity || 0),
          total_amount: movement.total_amount == null ? null : Number(movement.total_amount || 0),
          item: firstOrSelf(movement.item),
          from_location: firstOrSelf(movement.from_location),
          to_location: firstOrSelf(movement.to_location),
        })),
      })
    } catch (err: any) {
      setOverview(null)
      setError(err?.message || 'Не удалось загрузить центр магазина')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const warehouseLocation = useMemo(
    () => overview?.locations.find((location) => location.location_type === 'warehouse') || null,
    [overview?.locations],
  )

  const pointLocations = useMemo(
    () => (overview?.locations || []).filter((location) => location.location_type === 'point_display'),
    [overview?.locations],
  )

  const pendingRequests = useMemo(
    () => (overview?.requests || []).filter((request) => ['new', 'disputed'].includes(request.status)),
    [overview?.requests],
  )

  const warehouseLowStock = useMemo(() => {
    if (!warehouseLocation) return []
    return (overview?.balances || [])
      .filter((balance) => balance.location_id === warehouseLocation.id)
      .filter((balance) => {
        const threshold = Number(balance.item?.low_stock_threshold || 0)
        return threshold > 0 && Number(balance.quantity || 0) <= threshold
      })
      .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0))
      .slice(0, 8)
  }, [overview?.balances, warehouseLocation])

  const pointCards = useMemo(() => {
    return pointLocations
      .map((location) => {
        const balances = (overview?.balances || []).filter((balance) => balance.location_id === location.id)
        const lowCount = balances.filter((balance) => {
          const threshold = Number(balance.item?.low_stock_threshold || 0)
          return threshold > 0 && Number(balance.quantity || 0) <= threshold
        }).length
        const quantityTotal = balances.reduce((sum, balance) => sum + Number(balance.quantity || 0), 0)
        const pending = pendingRequests.filter((request) => request.target_location?.id === location.id).length
        return {
          location,
          skuCount: balances.length,
          quantityTotal,
          lowCount,
          pending,
        }
      })
      .sort((a, b) => {
        if (b.pending !== a.pending) return b.pending - a.pending
        if (b.lowCount !== a.lowCount) return b.lowCount - a.lowCount
        return a.location.name.localeCompare(b.location.name, 'ru')
      })
  }, [overview?.balances, pendingRequests, pointLocations])

  const stats = useMemo(() => {
    const requestedQty = pendingRequests.reduce(
      (sum, request) => sum + asArray(request.items).reduce((acc, item) => acc + Number(item.requested_qty || 0), 0),
      0,
    )
    const receiptAmount = (overview?.receipts || []).reduce((sum, receipt) => sum + Number(receipt.total_amount || 0), 0)
    const movementAmount = (overview?.movements || []).reduce(
      (sum, movement) => sum + Number(movement.total_amount || 0),
      0,
    )
    return {
      pendingRequests: pendingRequests.length,
      requestedQty,
      lowStockCount: warehouseLowStock.length,
      activeDisplays: pointLocations.length,
      receiptAmount,
      movementAmount,
    }
  }, [overview?.movements, overview?.receipts, pendingRequests, pointLocations.length, warehouseLowStock.length])

  return (
    <div className="space-y-6">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_420px]">
        <Card className="border-white/10 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent p-6">
          <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="max-w-2xl">
                <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
                  <Boxes className="h-3.5 w-3.5" />
                  Центр магазина
                </div>
                <h1 className="text-3xl font-semibold tracking-tight text-foreground">Склад, витрины и заявки в одном ритме</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
                  Здесь видно, что нужно принять, что уже запросили точки, где заканчивается товар и какие движения были последними.
                  Это главный рабочий экран руководителя магазина.
                </p>
              </div>

              <Button variant="outline" onClick={() => void load()} disabled={loading} className="rounded-2xl">
                <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
                Обновить
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {actionLink('/store/requests', 'Заявки', 'Открыть очередь запросов от точек и быстро принять решение.', ClipboardList)}
              {actionLink('/store/receipts', 'Приемка', 'Оформить приход товара на центральный склад.', PackagePlus)}
              {actionLink('/store/movements', 'Движения', 'Проверить последние продажи, списания и выдачи.', History)}
              {actionLink('/store/revisions', 'Ревизия', 'Провести проверку склада или витрины точки.', ScanSearch)}
            </div>
          </div>
        </Card>

        <Card className="border-white/10 bg-black/20 p-6">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Новые заявки</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{stats.pendingRequests}</p>
              <p className="mt-1 text-sm text-muted-foreground">Сейчас ждут решения по выдаче товара</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Запрошено позиций</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{stats.requestedQty}</p>
              <p className="mt-1 text-sm text-muted-foreground">Общий объём новых запросов от точек</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Риск по складу</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{stats.lowStockCount}</p>
              <p className="mt-1 text-sm text-muted-foreground">SKU на центральном складе уже у порога</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Активные витрины</p>
              <p className="mt-2 text-3xl font-semibold text-foreground">{stats.activeDisplays}</p>
              <p className="mt-1 text-sm text-muted-foreground">Точки, по которым сейчас есть витрина</p>
            </div>
          </div>
        </Card>
      </section>

      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_420px]">
        <Card className="border-white/10 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Очередь заявок</h2>
              <p className="text-sm text-muted-foreground">Самые свежие запросы, которые сейчас нужно принять или отклонить.</p>
            </div>
            <Link href="/store/requests" className="text-sm font-medium text-emerald-300 hover:text-emerald-200">
              Открыть все
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
                Загружаем очередь магазина...
              </div>
            ) : pendingRequests.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
                Новых заявок сейчас нет. Магазин работает спокойно.
              </div>
            ) : (
              pendingRequests.slice(0, 6).map((request) => (
                <div key={request.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-foreground">{request.company?.name || request.target_location?.name || 'Точка'}</p>
                        <span className={`rounded-full border px-2 py-0.5 text-xs ${requestStatusClass(request.status)}`}>
                          {requestStatusLabel(request.status)}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {request.target_location?.name || 'Витрина точки'} • создано {formatDateTime(request.created_at)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Позиции</p>
                      <p className="font-semibold text-foreground">{asArray(request.items).length}</p>
                    </div>
                  </div>

                  {request.comment ? (
                    <p className="mt-3 text-sm text-muted-foreground">{request.comment}</p>
                  ) : null}

                  <div className="mt-4 grid gap-2">
                    {asArray(request.items).slice(0, 3).map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{item.item?.name || 'Товар'}</p>
                          <p className="text-xs text-muted-foreground">{item.item?.barcode || 'Без штрихкода'}</p>
                        </div>
                        <div className="text-right font-semibold text-foreground">
                          {formatQty(Number(item.requested_qty || 0))} {item.item?.unit || 'шт'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/10 p-5">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-300" />
              <h2 className="text-lg font-semibold text-foreground">Низкий остаток на складе</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Товары на центральном складе, которые уже подошли к своему порогу.</p>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  Проверяем остатки склада...
                </div>
              ) : warehouseLowStock.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  На центральном складе нет критичных остатков.
                </div>
              ) : (
                warehouseLowStock.map((balance) => (
                  <div key={`${balance.location_id}:${balance.item_id}`} className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{balance.item?.name || 'Товар'}</p>
                        <p className="text-xs text-muted-foreground">{balance.item?.barcode || 'Без штрихкода'}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold text-foreground">{formatQty(Number(balance.quantity || 0))} {balance.item?.unit || 'шт'}</p>
                        <p className="text-xs text-amber-200">Порог: {Number(balance.item?.low_stock_threshold || 0)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="border-white/10 p-5">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-cyan-300" />
              <h2 className="text-lg font-semibold text-foreground">Витрины точек</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">Короткая сводка по точкам: сколько SKU лежит на витрине, есть ли риск и висят ли заявки.</p>

            <div className="mt-4 space-y-3">
              {loading ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  Собираем витрины точек...
                </div>
              ) : pointCards.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  Витрины точек пока ещё не наполнены.
                </div>
              ) : (
                pointCards.map((point) => (
                  <div key={point.location.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium text-foreground">{point.location.company?.name || point.location.name}</p>
                        <p className="text-xs text-muted-foreground">{point.location.name}</p>
                      </div>
                      {point.pending > 0 ? (
                        <span className="rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-xs text-violet-200">
                          {point.pending} заяв.
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-xs text-muted-foreground">SKU</p>
                        <p className="mt-1 font-semibold text-foreground">{point.skuCount}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-xs text-muted-foreground">Остаток</p>
                        <p className="mt-1 font-semibold text-foreground">{formatQty(point.quantityTotal)}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                        <p className="text-xs text-muted-foreground">Риск</p>
                        <p className="mt-1 font-semibold text-foreground">{point.lowCount}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_420px]">
        <Card className="border-white/10 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-foreground">Последние движения</h2>
              <p className="text-sm text-muted-foreground">Что реально происходило в магазине: приемка, выдача на точки, продажи и возвраты.</p>
            </div>
            <Link href="/store/movements" className="text-sm font-medium text-emerald-300 hover:text-emerald-200">
              Полный журнал
            </Link>
          </div>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
                Загружаем движения...
              </div>
            ) : (overview?.movements || []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
                Движений пока нет.
              </div>
            ) : (
              overview?.movements.map((movement) => (
                <div key={movement.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-xs text-muted-foreground">
                          {movementLabel(movement.movement_type)}
                        </span>
                        <p className="truncate font-medium text-foreground">{movement.item?.name || 'Товар'}</p>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {movement.from_location?.name || '—'} → {movement.to_location?.name || '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-foreground">{formatQty(Number(movement.quantity || 0))} {movement.item?.unit || 'шт'}</p>
                      <p className="text-xs text-muted-foreground">{formatDateTime(movement.created_at)}</p>
                    </div>
                  </div>
                  {movement.comment ? (
                    <p className="mt-3 text-sm text-muted-foreground">{movement.comment}</p>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="border-white/10 p-5">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-emerald-300" />
            <h2 className="text-lg font-semibold text-foreground">Последние приемки</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Свежие приходы на склад, чтобы быстро проверить суммы и поставщиков.</p>

          <div className="mt-4 space-y-3">
            {loading ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                Загружаем приемки...
              </div>
            ) : (overview?.receipts || []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                Документов приемки пока нет.
              </div>
            ) : (
              overview?.receipts.map((receipt) => (
                <div key={receipt.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{receipt.supplier?.name || 'Без поставщика'}</p>
                      <p className="text-sm text-muted-foreground">{receipt.invoice_number || 'Без номера накладной'}</p>
                    </div>
                    <p className="font-semibold text-foreground">{formatMoney(Number(receipt.total_amount || 0))}</p>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                    <span>{formatDate(receipt.received_at)}</span>
                    <span>{asArray(receipt.items).length} позиций</span>
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
