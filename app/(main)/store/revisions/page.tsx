'use client'

import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Loader2, Package, RefreshCw, ScanSearch, Search, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

type InventoryLocation = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
  company?: { id: string; name: string; code: string | null } | null
}

type InventoryItem = {
  id: string
  name: string
  barcode: string
  unit: string
  item_type: string
  sale_price?: number
  default_purchase_price?: number
}

type InventoryBalance = {
  location_id: string
  item_id: string
  quantity: number
  item?: InventoryItem | null
}

type InventoryRevision = {
  id: string
  counted_at: string
  comment: string | null
  created_by?: string | null
  created_by_staff?: { id: string; full_name: string | null; role: string | null } | null
  location?: InventoryLocation | null
  items?: Array<{
    id: string
    expected_qty: number
    actual_qty: number
    delta_qty: number
    comment: string | null
    item?: InventoryItem | null
  }>
}

type RevisionsResponse = {
  ok: boolean
  data?: {
    items: InventoryItem[]
    locations: InventoryLocation[]
    balances: InventoryBalance[]
    stocktakes: InventoryRevision[]
  }
  error?: string
}

type RevisionLine = {
  item_id: string
  actual_qty: string
  comment: string
}

const emptyLine = (): RevisionLine => ({
  item_id: '',
  actual_qty: '',
  comment: '',
})

function parseQty(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 1000) / 1000
}

function formatQty(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2)
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

function actorLabel(staff: { full_name: string | null } | null | undefined, fallbackId: string | null | undefined) {
  if (staff?.full_name) return staff.full_name
  if (fallbackId) return `ID ${String(fallbackId).slice(0, 8)}`
  return '—'
}

export default function StoreRevisionsPage() {
  const [data, setData] = useState<RevisionsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [locationId, setLocationId] = useState('')
  const [countedAt, setCountedAt] = useState(new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<RevisionLine[]>([])
  const [scope, setScope] = useState<'all' | 'warehouse' | 'showcase'>('all')
  const [formSheetOpen, setFormSheetOpen] = useState(false)
  const [revisionSearch, setRevisionSearch] = useState('')
  const [formPrefilled, setFormPrefilled] = useState(false)
  const [barcodeQuery, setBarcodeQuery] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/revisions?scope=${scope}`, { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as RevisionsResponse | null
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить ревизии')
      setData(json.data)
      setLocationId((current) => current || json.data?.locations?.[0]?.id || '')
    } catch (err: any) {
      setData(null)
      setError(err?.message || 'Не удалось загрузить ревизии')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [scope])

  const activeLocations = data?.locations || []
  const selectedLocation = activeLocations.find((location) => location.id === locationId) || null
  const selectedBalances = useMemo(() => {
    return (data?.balances || [])
      .filter((balance) => balance.location_id === locationId)
      .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
  }, [data?.balances, locationId])
  const itemById = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const item of data?.items || []) map.set(item.id, item)
    return map
  }, [data?.items])
  const itemByBarcode = useMemo(() => {
    const map = new Map<string, InventoryItem>()
    for (const item of data?.items || []) {
      const barcode = String(item.barcode || '').trim()
      if (!barcode) continue
      map.set(barcode, item)
    }
    return map
  }, [data?.items])

  const loadFromBalances = () => {
    setLines(
      selectedBalances
        .filter((balance) => Number(balance.quantity || 0) > 0)
        .map((balance) => ({
          item_id: balance.item_id,
          actual_qty: formatQty(Number(balance.quantity || 0)),
          comment: '',
        })),
    )
  }

  useEffect(() => {
    if (!formSheetOpen || !locationId || !selectedBalances.length || formPrefilled) return
    loadFromBalances()
    setFormPrefilled(true)
  }, [formSheetOpen, locationId, selectedBalances, formPrefilled])

  const totals = useMemo(() => {
    const rows = lines
      .map((line) => {
        const expected = Number(selectedBalances.find((item) => item.item_id === line.item_id)?.quantity || 0)
        const actual = parseQty(line.actual_qty)
        return { expected, actual, delta: actual - expected }
      })
      .filter((line) => line.expected > 0 || line.actual > 0)

    return {
      count: rows.length,
      shortage: rows.filter((line) => line.delta < 0).reduce((sum, line) => sum + Math.abs(line.delta), 0),
      surplus: rows.filter((line) => line.delta > 0).reduce((sum, line) => sum + line.delta, 0),
    }
  }, [lines, selectedBalances])

  const createRevision = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payloadItems = lines
      .map((line) => ({
        item_id: line.item_id,
        actual_qty: parseQty(line.actual_qty),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.actual_qty >= 0)

    if (!locationId) return setError('Выберите локацию для ревизии')
    if (!payloadItems.length) return setError('Загрузите или добавьте строки ревизии')

    setSaving(true)
    try {
      const response = await fetch('/api/admin/store/revisions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createRevision',
          payload: {
            location_id: locationId,
            counted_at: countedAt,
            comment: comment.trim() || null,
            items: payloadItems,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось провести ревизию')

      setComment('')
      setLines([])
      setSuccess('Ревизия проведена, расхождения записаны')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось провести ревизию')
    } finally {
      setSaving(false)
    }
  }

  const addItemByBarcode = () => {
    const barcode = barcodeQuery.trim()
    if (!barcode) return
    const found = itemByBarcode.get(barcode)
    if (!found) {
      setError('Товар с таким штрихкодом не найден в каталоге')
      return
    }
    const alreadyAdded = lines.some((line) => line.item_id === found.id)
    if (alreadyAdded) {
      setError('Этот товар уже добавлен в акт')
      return
    }
    const expectedQty = Number(selectedBalances.find((b) => b.item_id === found.id)?.quantity || 0)
    setLines((current) => [
      ...current,
      {
        item_id: found.id,
        actual_qty: formatQty(expectedQty),
        comment: '',
      },
    ])
    setBarcodeQuery('')
    setError(null)
  }

  const filteredRevisions = useMemo(() => {
    const q = revisionSearch.trim().toLowerCase()
    const list = data?.stocktakes || []
    if (!q) return list
    return list.filter((r) => {
      const parts = [
        r.location?.company?.name,
        r.location?.name,
        r.comment,
        ...(r.items || []).map((i) => i.item?.name || ''),
      ]
      return parts.filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [data?.stocktakes, revisionSearch])

  const revisionsStats = useMemo(() => {
    const list = data?.stocktakes || []
    const withMismatch = list.filter((r) => (r.items || []).some((i) => Number(i.delta_qty || 0) !== 0)).length
    const totalShortage = list.reduce((s, r) => s + (r.items || []).reduce((s2, i) => s2 + (Number(i.delta_qty || 0) < 0 ? Math.abs(Number(i.delta_qty || 0)) : 0), 0), 0)
    const totalSurplus = list.reduce((s, r) => s + (r.items || []).reduce((s2, i) => s2 + (Number(i.delta_qty || 0) > 0 ? Number(i.delta_qty || 0) : 0), 0), 0)
    return { count: list.length, withMismatch, totalShortage, totalSurplus }
  }, [data?.stocktakes])

  return (
    <TooltipProvider delayDuration={200}>
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-500/20 bg-cyan-500/10">
            <ScanSearch className="h-5 w-5 text-cyan-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">Ревизии</h1>
            <p className="truncate text-xs text-muted-foreground">Сверка фактических остатков с системой</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
            {(['all', 'warehouse', 'showcase'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1.5 transition ${scope === s ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {s === 'all' ? 'Все' : s === 'warehouse' ? 'Подсобка' : 'Витрина'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button
            size="sm"
            onClick={() => {
              setFormPrefilled(false)
              setFormSheetOpen(true)
            }}
            className="h-9 gap-1.5 bg-cyan-600 hover:bg-cyan-700"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Новый акт
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Актов</p>
          <p className="mt-1 text-xl font-semibold">{revisionsStats.count}</p>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-300/70">С расхождениями</p>
          <p className="mt-1 text-xl font-semibold text-amber-200">{revisionsStats.withMismatch}</p>
        </Card>
        <Card className="border-rose-500/20 bg-rose-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-rose-300/70">Недостача (всего)</p>
          <p className="mt-1 text-xl font-semibold text-rose-200">{formatQty(revisionsStats.totalShortage)}</p>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">Излишек (всего)</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{formatQty(revisionsStats.totalSurplus)}</p>
        </Card>
      </div>

      {error ? <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div> : null}
      {success ? <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">{success}</div> : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={revisionSearch}
            onChange={(e) => setRevisionSearch(e.target.value)}
            placeholder="Поиск по локации, товару, комментарию..."
            className="h-9 pl-9"
          />
        </div>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading ? (
          <div className="flex h-60 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredRevisions.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Package className="h-8 w-8 opacity-50" />
            {revisionSearch ? 'Ничего не найдено' : 'Ревизий пока нет — нажмите «Новый акт»'}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-380px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-24 py-2.5 pl-4 pr-2 font-normal">Дата</th>
                  <th className="w-40 py-2.5 px-2 font-normal">Провел</th>
                  <th className="w-48 py-2.5 px-2 font-normal">Локация</th>
                  <th className="py-2.5 px-2 font-normal">Комментарий</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal">Позиций</th>
                  <th className="w-24 py-2.5 px-2 text-right font-normal">Недостача</th>
                  <th className="w-24 py-2.5 px-2 pr-4 text-right font-normal">Излишек</th>
                  <th className="w-28 py-2.5 px-2 text-right font-normal">Сумма (прод.)</th>
                  <th className="w-28 py-2.5 px-2 pr-4 text-right font-normal">Сумма (закуп.)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredRevisions.map((revision) => {
                  const items = revision.items || []
                  const shortage = items.reduce((s, i) => s + (Number(i.delta_qty || 0) < 0 ? Math.abs(Number(i.delta_qty || 0)) : 0), 0)
                  const surplus = items.reduce((s, i) => s + (Number(i.delta_qty || 0) > 0 ? Number(i.delta_qty || 0) : 0), 0)
                  const saleAmount = items.reduce((s, i) => {
                    const deltaAbs = Math.abs(Number(i.delta_qty || 0))
                    const salePrice = Number(i.item?.sale_price || 0)
                    return s + deltaAbs * salePrice
                  }, 0)
                  const purchaseAmount = items.reduce((s, i) => {
                    const deltaAbs = Math.abs(Number(i.delta_qty || 0))
                    const purchasePrice = Number(i.item?.default_purchase_price || 0)
                    return s + deltaAbs * purchasePrice
                  }, 0)
                  const mismatches = items.filter((i) => Number(i.delta_qty || 0) !== 0)
                  return (
                    <tr key={revision.id} className="transition hover:bg-white/[0.02]">
                      <td className="w-24 py-2.5 pl-4 pr-2 align-middle">
                        <span className="text-xs text-muted-foreground">{formatDate(revision.counted_at)}</span>
                      </td>
                      <td className="w-40 py-2.5 px-2 align-middle">
                        <span className="line-clamp-1 text-xs text-muted-foreground">
                          {actorLabel(revision.created_by_staff, revision.created_by || null)}
                        </span>
                      </td>
                      <td className="w-48 py-2.5 px-2 align-middle">
                        <span className="line-clamp-1 text-xs text-muted-foreground">{revision.location?.company?.name || revision.location?.name || '—'}</span>
                      </td>
                      <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="truncate text-sm">{revision.comment || <span className="text-muted-foreground">Без комментария</span>}</p>
                          </TooltipTrigger>
                          <TooltipContent side="top" align="start" className="max-w-md">
                            {revision.comment || 'Без комментария'}
                            {mismatches.length ? (
                              <div className="mt-1 text-xs text-muted-foreground">
                                {mismatches.map((i) => `${i.item?.name || 'Товар'}: ${Number(i.delta_qty) > 0 ? '+' : ''}${formatQty(Number(i.delta_qty || 0))}`).join(', ')}
                              </div>
                            ) : null}
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="w-20 py-2.5 px-2 text-right align-middle">
                        <span className="text-sm font-semibold">{items.length}</span>
                      </td>
                      <td className="w-24 py-2.5 px-2 text-right align-middle">
                        <span className={`text-sm font-semibold ${shortage > 0 ? 'text-rose-300' : 'text-muted-foreground'}`}>
                          {shortage > 0 ? `-${formatQty(shortage)}` : '—'}
                        </span>
                      </td>
                      <td className="w-24 py-2.5 px-2 pr-4 text-right align-middle">
                        <span className={`text-sm font-semibold ${surplus > 0 ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                          {surplus > 0 ? `+${formatQty(surplus)}` : '—'}
                        </span>
                      </td>
                      <td className="w-28 py-2.5 px-2 text-right align-middle">
                        <span className={`text-sm font-semibold ${saleAmount > 0 ? 'text-amber-200' : 'text-muted-foreground'}`}>
                          {saleAmount > 0 ? `${Math.round(saleAmount).toLocaleString('ru-RU')} ₸` : '—'}
                        </span>
                      </td>
                      <td className="w-28 py-2.5 px-2 pr-4 text-right align-middle">
                        <span className={`text-sm font-semibold ${purchaseAmount > 0 ? 'text-cyan-200' : 'text-muted-foreground'}`}>
                          {purchaseAmount > 0 ? `${Math.round(purchaseAmount).toLocaleString('ru-RU')} ₸` : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create revision dialog */}
      <Dialog
        open={formSheetOpen}
        onOpenChange={(open) => {
          setFormSheetOpen(open)
          if (!open) setFormPrefilled(false)
        }}
      >
        <DialogContent className="flex h-[90vh] !w-[96vw] !max-w-[96vw] sm:!max-w-[1400px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-white/10 p-5 text-left">
            <DialogTitle className="flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-cyan-300" />
              Новый акт ревизии
            </DialogTitle>
            <DialogDescription>
              Подтяни остатки системы, исправь факт и проведи один чистый акт.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={createRevision} className="flex-1 space-y-5 overflow-y-auto p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Локация</Label>
                <Select
                  value={locationId}
                  onValueChange={(value) => {
                    setLocationId(value)
                    setFormPrefilled(false)
                    setLines([])
                  }}
                >
                  <SelectTrigger><SelectValue placeholder="Выберите локацию" /></SelectTrigger>
                  <SelectContent>
                    {activeLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.location_type === 'warehouse' ? 'Подсобка' : 'Витрина'} · {location.company?.name || location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Дата ревизии</Label>
                <Input type="date" value={countedAt} onChange={(event) => setCountedAt(event.target.value)} />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Кто проверял и что важно зафиксировать" rows={2} />
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-muted-foreground">
              <span>
                Локация: <span className="font-medium text-foreground">{selectedLocation?.company?.name || selectedLocation?.name || '—'}</span>
              </span>
              <span>Позиций в системе: <span className="font-medium text-foreground">{selectedBalances.length}</span></span>
              <Button type="button" variant="outline" size="sm" className="ml-auto" onClick={loadFromBalances}>
                Подтянуть остатки
              </Button>
            </div>

            <div className="flex flex-wrap items-end gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="min-w-[220px] flex-1 space-y-1.5">
                <Label>Добавить по штрихкоду</Label>
                <Input
                  value={barcodeQuery}
                  onChange={(event) => setBarcodeQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addItemByBarcode()
                    }
                  }}
                  placeholder="Сканируй или введи штрихкод"
                />
              </div>
              <Button type="button" variant="outline" onClick={addItemByBarcode}>
                Добавить по штрихкоду
              </Button>
            </div>

            <div className="space-y-3">
              {lines.length ? lines.map((line, index) => {
                const expectedQty = Number(selectedBalances.find((item) => item.item_id === line.item_id)?.quantity || 0)
                const actualQty = parseQty(line.actual_qty)
                const deltaQty = actualQty - expectedQty
                const lineItem = line.item_id ? itemById.get(line.item_id) || null : null
                const isManualLine = !line.item_id
                return (
                  <div key={`revision-${index}`} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 md:grid-cols-[minmax(0,1.35fr)_100px_100px_minmax(0,1fr)_110px_auto]">
                    <div className="space-y-1.5">
                      <Label>Товар</Label>
                      {isManualLine ? (
                        <Select
                          value={line.item_id || `__empty__revision_${index}`}
                          onValueChange={(value) =>
                            setLines((current) => {
                              const nextItemId = value.startsWith('__empty__') ? '' : value
                              if (!nextItemId) {
                                return current.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, item_id: '' } : item,
                                )
                              }
                              const duplicateExists = current.some((item, itemIndex) => itemIndex !== index && item.item_id === nextItemId)
                              if (duplicateExists) {
                                setError('Этот товар уже добавлен в акт')
                                return current
                              }
                              setError(null)
                              return current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, item_id: nextItemId } : item,
                              )
                            })
                          }
                        >
                          <SelectTrigger className="min-w-0"><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={`__empty__revision_${index}`}>Выберите товар</SelectItem>
                            {(data?.items || []).map((item) => (
                              <SelectItem key={`${index}-${item.id}`} value={item.id} title={`${item.name} · ${item.barcode}`}>
                                <span className="block max-w-[420px] truncate">
                                  {item.name} · {item.barcode}
                                </span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div
                          className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground"
                          title={`${lineItem?.name || 'Товар'} · ${lineItem?.barcode || '—'}`}
                        >
                          <span className="block truncate">
                            {lineItem?.name || 'Товар'} · {lineItem?.barcode || '—'}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <Label>Система</Label>
                      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-foreground">{formatQty(expectedQty)}</div>
                    </div>

                    <div className="space-y-1.5">
                      <Label>Факт</Label>
                      <Input value={line.actual_qty} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, actual_qty: event.target.value } : item))} placeholder="0" />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Комментарий</Label>
                      <Input value={line.comment} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Причина расхождения" />
                    </div>

                    <div className="space-y-1.5">
                      <Label>Δ</Label>
                      <div className={`rounded-xl border px-3 py-2 text-center text-sm ${deltaQty === 0 ? 'border-white/10 bg-white/[0.03] text-muted-foreground' : deltaQty > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
                        {deltaQty === 0 ? '—' : `${deltaQty > 0 ? '+' : ''}${formatQty(deltaQty)}`}
                      </div>
                    </div>

                    <div className="flex items-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              }) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-muted-foreground">
                  Пока нет строк. Подтяни остатки системы или добавь строки вручную.
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>
                Добавить строку
              </Button>
              <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                <span>Строк: <span className="font-semibold text-foreground">{totals.count}</span></span>
                <span>Недостача: <span className="font-semibold text-rose-300">{formatQty(totals.shortage)}</span></span>
                <span>Излишек: <span className="font-semibold text-emerald-300">{formatQty(totals.surplus)}</span></span>
              </div>
            </div>

            <Button type="submit" disabled={saving} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
              Провести ревизию
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
