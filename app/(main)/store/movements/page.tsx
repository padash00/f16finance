'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArchiveX, History, RefreshCw, Search } from 'lucide-react'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/core/format'

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
  if (type === 'transfer_to_point') return 'Выдача на точку'
  if (type === 'sale') return 'Продажа'
  if (type === 'debt') return 'Долг'
  if (type === 'return') return 'Возврат'
  if (type === 'writeoff') return 'Списание'
  if (type === 'inventory_adjustment') return 'Корректировка'
  return type
}

function movementTypeClass(type: string) {
  if (type === 'receipt') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (type === 'transfer_to_point') return 'border-blue-500/30 bg-blue-500/10 text-blue-200'
  if (type === 'sale') return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-200'
  if (type === 'debt') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (type === 'return') return 'border-violet-500/30 bg-violet-500/10 text-violet-200'
  if (type === 'writeoff') return 'border-red-500/30 bg-red-500/10 text-red-200'
  return 'border-white/10 bg-white/[0.05] text-muted-foreground'
}

export default function StoreMovementsPage() {
  const [data, setData] = useState<MovementsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<'all' | string>('all')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/store/movements', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as MovementsResponse | null
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
      setData(null)
      setError(err?.message || 'Не удалось загрузить движения')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const filteredMovements = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (data?.movements || []).filter((movement) => {
      if (typeFilter !== 'all' && movement.movement_type !== typeFilter) return false
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
  }, [data?.movements, query, typeFilter])

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-violet-400/20 bg-violet-500/10 px-3 py-1 text-xs text-violet-200">
              <History className="h-3.5 w-3.5" />
              Журнал движений
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Все товарные операции в одном потоке</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Здесь удобно смотреть приёмки, выдачу на точки, продажи, долги, возвраты и корректировки без лишних карточек от других разделов.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Link href="/store/writeoffs">
              <Button variant="outline" className="rounded-2xl gap-2">
                <ArchiveX className="h-4 w-4" />
                Создать списание
              </Button>
            </Link>
            <Button variant="outline" onClick={() => void load()} disabled={loading} className="rounded-2xl">
              <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              Обновить
            </Button>
          </div>
        </div>
      </Card>

      <Card className="border-white/10 p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по товару, точке, штрихкоду или комментарию" className="pl-10" />
          </div>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue placeholder="Все операции" /></SelectTrigger>
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
        </div>
      </Card>

      {error ? (
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      ) : null}

      <Card className="border-white/10 p-5">
        <div className="space-y-3">
          {loading ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">Загружаем движения...</div>
          ) : filteredMovements.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">По этим фильтрам движений не найдено.</div>
          ) : (
            filteredMovements.map((movement) => (
              <div key={movement.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${movementTypeClass(movement.movement_type)}`}>
                        {movementTypeLabel(movement.movement_type)}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDateTime(movement.created_at)}</span>
                    </div>
                    <div className="mt-2 text-sm font-semibold text-foreground">{movement.item?.name || 'Товар'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(movement.from_location?.company?.name || movement.from_location?.name || '—')} → {(movement.to_location?.company?.name || movement.to_location?.name || '—')}
                    </div>
                    {movement.comment ? <div className="mt-2 text-sm text-muted-foreground">{movement.comment}</div> : null}
                  </div>

                  <div className="grid min-w-[220px] gap-2 md:text-right">
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Количество</p>
                      <p className="mt-1 font-semibold text-foreground">{formatQty(movement.quantity)} {movement.item?.unit || 'шт'}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2">
                      <p className="text-xs text-muted-foreground">Сумма</p>
                      <p className="mt-1 font-semibold text-foreground">{formatMoney(Number(movement.total_amount || 0))}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  )
}
