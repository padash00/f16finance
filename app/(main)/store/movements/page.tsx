'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { ArchiveX, ArrowRight, History, Loader2, Package, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatMoney } from '@/lib/core/format'
import { StoreDataTableSkeleton } from '@/components/store/store-data-table-skeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { useDebouncedValue, useUrlState } from '@/lib/hooks/use-url-state'
import { isAbortError } from '@/lib/is-abort-error'

type InventoryLocation = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
  company?: { id: string; name: string; code: string | null } | null
}

type InventoryMovement = {
  id: string
  movement_type: string
  quantity: number
  unit_cost: number | null
  total_amount: number | null
  reference_type: string
  comment: string | null
  created_at: string
  item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  from_location?: InventoryLocation | null
  to_location?: InventoryLocation | null
}

type MovementsResponse = {
  ok: boolean
  data?: {
    movements: InventoryMovement[]
    locations: InventoryLocation[]
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
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed)
}

function movementTypeLabel(type: string) {
  if (type === 'receipt') return 'Приемка'
  if (type === 'receipt_cancel') return 'Отмена приёмки'
  if (type === 'transfer_to_point') return 'Выдача на точку'
  if (type === 'transfer_cancel') return 'Откат выдачи'
  if (type === 'transfer_warehouse_to_showcase') return 'Получение точкой'
  if (type === 'transfer_showcase_to_warehouse') return 'Возврат на склад'
  if (type === 'reservation') return 'Резерв'
  if (type === 'reservation_release') return 'Снятие резерва'
  if (type === 'sale') return 'Продажа'
  if (type === 'debt') return 'Долг'
  if (type === 'return') return 'Возврат с кассы'
  if (type === 'writeoff') return 'Списание'
  if (type === 'inventory_adjustment') return 'Корректировка'
  if (type === 'set_stock') return 'Синхронизация'
  if (type === 'posting') return 'Оприходование'
  if (type === 'migration_initial') return 'Миграция'
  if (type === 'auto_warehouse_to_showcase') return 'Авто-перенос'
  return type
}

function movementTypeClass(type: string) {
  if (type === 'receipt') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (type === 'receipt_cancel') return 'border-rose-500/30 bg-rose-500/10 text-rose-200'
  if (type === 'transfer_to_point' || type === 'transfer_warehouse_to_showcase') return 'border-blue-500/30 bg-blue-500/10 text-blue-200'
  if (type === 'transfer_cancel' || type === 'transfer_showcase_to_warehouse') return 'border-orange-500/30 bg-orange-500/10 text-orange-200'
  if (type === 'reservation') return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-200'
  if (type === 'reservation_release') return 'border-yellow-500/20 bg-yellow-500/5 text-yellow-300'
  if (type === 'sale') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (type === 'debt') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (type === 'return') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (type === 'writeoff') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (type === 'posting') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (type === 'migration_initial') return 'border-slate-500/30 bg-slate-500/10 text-slate-300'
  return 'border-white/10 bg-white/[0.05] text-muted-foreground'
}

function StoreMovementsPageContent() {
  const [data, setData] = useState<MovementsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useUrlState({
    q: '',
    type: 'all',
    place: 'all',
  })
  const [queryInput, setQueryInput] = useState(filters.q)
  const debouncedQuery = useDebouncedValue(queryInput, 300)

  const load = async (signal?: AbortSignal, opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft)
    if (soft) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const scope =
        filters.place === 'warehouse' ? 'warehouse' : filters.place === 'showcase' ? 'showcase' : 'all'
      const response = await fetch(`/api/admin/store/movements?scope=${scope}`, { cache: 'no-store', signal })
      const json = (await response.json().catch(() => null)) as MovementsResponse | null
      if (signal?.aborted) return
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить движения')

      setData({
        locations: (json.data.locations || []).map((location) => ({
          ...location,
          company: firstOrSelf(location.company),
        })),
        movements: (json.data.movements || []).map((movement) => ({
          ...movement,
          quantity: Number(movement.quantity || 0),
          unit_cost: movement.unit_cost == null ? null : Number(movement.unit_cost || 0),
          total_amount: movement.total_amount == null ? null : Number(movement.total_amount || 0),
          item: firstOrSelf(movement.item),
          from_location: firstOrSelf(movement.from_location),
          to_location: firstOrSelf(movement.to_location),
        })),
      })
    } catch (err: any) {
      if (isAbortError(err) || signal?.aborted) return
      if (!soft) setData(null)
      setError(err?.message || 'Не удалось загрузить движения')
    } finally {
      if (!signal?.aborted) {
        if (soft) setRefreshing(false)
        else setLoading(false)
      }
    }
  }

  useEffect(() => {
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
  }, [filters.place])

  useEffect(() => {
    setQueryInput(filters.q)
  }, [filters.q])

  useEffect(() => {
    setFilters({ q: debouncedQuery })
  }, [debouncedQuery, setFilters])

  const filteredMovements = useMemo(() => {
    const q = filters.q.trim().toLowerCase()
    return (data?.movements || []).filter((movement) => {
      if (filters.type !== 'all' && movement.movement_type !== filters.type) return false
      if (filters.place !== 'all') {
        const fromType = movement.from_location?.location_type || null
        const toType = movement.to_location?.location_type || null
        if (filters.place === 'warehouse' && fromType !== 'warehouse' && toType !== 'warehouse') return false
        if (filters.place === 'showcase' && fromType !== 'point_display' && toType !== 'point_display') return false
        if (
          filters.place === 'between' &&
          !((fromType === 'warehouse' && toType === 'point_display') || (fromType === 'point_display' && toType === 'warehouse'))
        ) return false
      }
      if (!q) return true
      const haystack = [
        movement.item?.name,
        movement.item?.barcode,
        movement.from_location?.company?.name,
        movement.from_location?.name,
        movement.to_location?.company?.name,
        movement.to_location?.name,
        movement.comment,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })
  }, [data?.movements, filters])

  const stats = useMemo(() => {
    const list = filteredMovements
    const total = list.reduce((s, m) => s + Number(m.total_amount || 0), 0)
    const receipts = list.filter((m) => m.movement_type === 'receipt').length
    const transfers = list.filter((m) => m.movement_type === 'transfer_to_point').length
    return { count: list.length, total, receipts, transfers }
  }, [filteredMovements])

  return (
    <TooltipProvider delayDuration={200}>
    <div className="app-page-wide space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10">
            <History className="h-5 w-5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">Журнал движений</h1>
            <p className="truncate text-xs text-muted-foreground">Приёмки, выдачи, продажи, долги, возвраты и корректировки</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Link href="/store/writeoffs">
            <Button variant="outline" size="sm" className="h-9 gap-1.5">
              <ArchiveX className="h-3.5 w-3.5" />
              Списание
            </Button>
          </Link>
          <Button variant="outline" size="sm" onClick={() => void load(undefined, { soft: true })} disabled={loading || refreshing} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Всего движений</p>
          {loading ? <Skeleton className="mt-1 h-7 w-12" /> : <p className="mt-1 text-xl font-semibold">{stats.count}</p>}
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">Приёмок</p>
          {loading ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="mt-1 text-xl font-semibold text-emerald-200">{stats.receipts}</p>}
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-300/70">Выдач на точку</p>
          {loading ? <Skeleton className="mt-1 h-7 w-10" /> : <p className="mt-1 text-xl font-semibold text-amber-200">{stats.transfers}</p>}
        </Card>
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Сумма</p>
          {loading ? <Skeleton className="mt-1 h-7 w-24" /> : (
            <p className="mt-1 truncate text-xl font-semibold" title={formatMoney(stats.total)}>{formatMoney(stats.total)}</p>
          )}
        </Card>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={queryInput} onChange={(event) => setQueryInput(event.target.value)} placeholder="Поиск по товару, точке, штрихкоду или комментарию" className="h-9 pl-9" />
        </div>
        <Select value={filters.type} onValueChange={(value) => setFilters({ type: value })}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue placeholder="Все операции" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все операции</SelectItem>
            <SelectItem value="receipt">Приемка</SelectItem>
            <SelectItem value="transfer_to_point">Выдача на точку</SelectItem>
            <SelectItem value="sale">Продажа</SelectItem>
            <SelectItem value="debt">Долг</SelectItem>
            <SelectItem value="return">Возврат</SelectItem>
            <SelectItem value="writeoff">Списание</SelectItem>
            <SelectItem value="inventory_adjustment">Корректировка</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filters.place} onValueChange={(value) => setFilters({ place: value })}>
          <SelectTrigger className="h-9 w-[200px]"><SelectValue placeholder="Все места" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все места</SelectItem>
            <SelectItem value="warehouse">В подсобке</SelectItem>
            <SelectItem value="showcase">На витрине</SelectItem>
            <SelectItem value="between">Между подсобкой и витриной</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading && filteredMovements.length === 0 ? (
          <StoreDataTableSkeleton columns={6} />
        ) : filteredMovements.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Package className="h-8 w-8 opacity-50" />
            По этим фильтрам движений не найдено
          </div>
        ) : (
          <div className="relative max-h-[calc(100vh-340px)] overflow-auto">
            {refreshing ? (
              <div className="absolute inset-0 z-20 flex items-start justify-center bg-background/35 pt-10 backdrop-blur-[0.5px]">
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Обновление…
                </div>
              </div>
            ) : null}
            <div className={refreshing ? 'pointer-events-none opacity-50' : undefined}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-36 py-2.5 pl-4 pr-2 font-normal">Дата</th>
                  <th className="w-40 py-2.5 px-2 font-normal">Тип</th>
                  <th className="py-2.5 px-2 font-normal">Товар</th>
                  <th className="py-2.5 px-2 font-normal">Направление</th>
                  <th className="w-24 py-2.5 px-2 text-right font-normal">Кол-во</th>
                  <th className="w-32 py-2.5 px-2 pr-4 text-right font-normal">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredMovements.map((movement) => {
                  const from = movement.from_location?.company?.name || movement.from_location?.name || '—'
                  const to = movement.to_location?.company?.name || movement.to_location?.name || '—'
                  return (
                    <tr key={movement.id} className="transition hover:bg-white/[0.02]">
                      <td className="w-36 py-2.5 pl-4 pr-2 align-middle">
                        <span className="text-xs text-muted-foreground">{formatDateTime(movement.created_at)}</span>
                      </td>
                      <td className="w-40 py-2.5 px-2 align-middle">
                        <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${movementTypeClass(movement.movement_type)}`}>
                          {movementTypeLabel(movement.movement_type)}
                        </span>
                      </td>
                      <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="truncate text-sm font-medium">{movement.item?.name || 'Товар'}</p>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="max-w-md">
                            {movement.item?.name || 'Товар'}
                            {movement.comment ? <div className="mt-1 text-xs text-muted-foreground">{movement.comment}</div> : null}
                          </TooltipContent>
                        </Tooltip>
                        {movement.comment ? <p className="truncate text-[11px] text-muted-foreground">{movement.comment}</p> : null}
                      </td>
                      <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                              <span className="truncate">{from}</span>
                              <ArrowRight className="h-3 w-3 shrink-0 opacity-60" />
                              <span className="truncate">{to}</span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="max-w-md">
                            {from} → {to}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="w-24 py-2.5 px-2 text-right align-middle">
                        <span className="text-sm font-semibold">{formatQty(movement.quantity)} <span className="text-xs text-muted-foreground">{movement.item?.unit || 'шт'}</span></span>
                      </td>
                      <td className="w-32 py-2.5 px-2 pr-4 text-right align-middle">
                        <span className="text-sm font-semibold">{formatMoney(Number(movement.total_amount || 0))}</span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </Card>
    </div>
    </TooltipProvider>
  )
}

export default function StoreMovementsPage() {
  return (
    <Suspense fallback={null}>
      <StoreMovementsPageContent />
    </Suspense>
  )
}
