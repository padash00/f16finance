'use client'

import { useEffect, useMemo, useState } from 'react'
import { ClipboardCheck, Loader2, RefreshCw, ScanSearch } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

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

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/store/revisions', { cache: 'no-store' })
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
  }, [])

  const activeLocations = data?.locations || []
  const selectedLocation = activeLocations.find((location) => location.id === locationId) || null
  const selectedBalances = useMemo(() => {
    return (data?.balances || [])
      .filter((balance) => balance.location_id === locationId)
      .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
  }, [data?.balances, locationId])

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

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 pt-5 md:px-6">
      <Card className="border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
              <ScanSearch className="h-3.5 w-3.5" />
              Ревизия
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Ревизия склада и витрин</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Полная проверка остатков по складу или точке с фиксацией факта и автоматической корректировкой расхождений.
            </p>
          </div>

          <Button variant="outline" onClick={() => void load()} disabled={loading} className="rounded-2xl">
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>
      </Card>

      {error ? <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div> : null}
      {success ? <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{success}</div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="border-white/10 p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Новый акт ревизии</h2>
            <p className="text-sm text-muted-foreground">Подтяни остатки системы, исправь факт и проведи один чистый акт.</p>
          </div>

          <form onSubmit={createRevision} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Локация</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите локацию" /></SelectTrigger>
                  <SelectContent>
                    {activeLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.location_type === 'warehouse' ? 'Склад' : 'Витрина'} · {location.company?.name || location.name}
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
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Кто проверял и что важно зафиксировать" />
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
              <span>
                Локация: <span className="font-medium text-foreground">{selectedLocation?.company?.name || selectedLocation?.name || '—'}</span>
              </span>
              <span>Позиций в системе: <span className="font-medium text-foreground">{selectedBalances.length}</span></span>
              <Button type="button" variant="outline" className="ml-auto" onClick={loadFromBalances}>
                Подтянуть остатки системы
              </Button>
            </div>

            <div className="space-y-3">
              {lines.length ? lines.map((line, index) => {
                const expectedQty = Number(selectedBalances.find((item) => item.item_id === line.item_id)?.quantity || 0)
                const actualQty = parseQty(line.actual_qty)
                const deltaQty = actualQty - expectedQty
                return (
                  <div key={`revision-${index}`} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 md:grid-cols-[minmax(0,1.35fr)_110px_110px_minmax(0,1fr)_110px]">
                    <div className="space-y-1.5">
                      <Label>Товар</Label>
                      <Select
                        value={line.item_id || `__empty__revision_${index}`}
                        onValueChange={(value) =>
                          setLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                            ),
                          )
                        }
                      >
                        <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={`__empty__revision_${index}`}>Выберите товар</SelectItem>
                          {(data?.items || []).map((item) => (
                            <SelectItem key={`${index}-${item.id}`} value={item.id}>
                              {item.name} · {item.barcode}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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

                    <div className="flex flex-col justify-between gap-2">
                      <div className={`rounded-xl border px-3 py-2 text-center text-sm ${deltaQty === 0 ? 'border-white/10 bg-white/[0.03] text-muted-foreground' : deltaQty > 0 ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-rose-500/30 bg-rose-500/10 text-rose-200'}`}>
                        {deltaQty === 0 ? 'Без расхождения' : `${deltaQty > 0 ? '+' : ''}${formatQty(deltaQty)}`}
                      </div>
                      <Button type="button" variant="outline" className="w-full" onClick={() => setLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        Убрать
                      </Button>
                    </div>
                  </div>
                )
              }) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-muted-foreground">
                  Пока нет строк ревизии. Можно подтянуть остатки системы или добавить строки вручную.
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

            <Button type="submit" disabled={saving} className="rounded-2xl">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ClipboardCheck className="mr-2 h-4 w-4" />}
              Провести ревизию
            </Button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/10 p-5">
            <h2 className="text-lg font-semibold text-foreground">Последние ревизии</h2>
            <p className="mt-1 text-sm text-muted-foreground">История актов проверки по складу и витринам.</p>

            <div className="mt-4 space-y-3">
              {(data?.stocktakes || []).length ? (
                data!.stocktakes.slice(0, 10).map((revision) => {
                  const mismatches = (revision.items || []).filter((item) => Number(item.delta_qty || 0) !== 0)
                  return (
                    <div key={revision.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium text-foreground">{revision.location?.company?.name || revision.location?.name || 'Локация'}</div>
                          <div className="text-sm text-muted-foreground">{formatDate(revision.counted_at)}</div>
                        </div>
                        <div className="rounded-full border border-cyan-500/20 bg-cyan-500/10 px-3 py-1 text-xs text-cyan-200">
                          Расхождений: {mismatches.length}
                        </div>
                      </div>
                      {revision.comment ? <div className="mt-3 text-sm text-slate-300">{revision.comment}</div> : null}
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {mismatches.slice(0, 4).map((item) => (
                          <span key={item.id} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
                            {item.item?.name || 'Товар'} · {Number(item.delta_qty || 0) > 0 ? '+' : ''}{formatQty(Number(item.delta_qty || 0))}
                          </span>
                        ))}
                      </div>
                    </div>
                  )
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-muted-foreground">
                  Пока нет ревизий.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
