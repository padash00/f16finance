'use client'

import { useEffect, useMemo, useState } from 'react'
import { ArchiveX, Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/core/format'

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
  location?: InventoryLocation | null
}

type InventoryWriteoff = {
  id: string
  written_at: string
  reason: string
  comment: string | null
  total_amount: number
  location?: InventoryLocation | null
  items?: Array<{
    id: string
    quantity: number
    unit_cost: number
    total_cost: number
    comment: string | null
    item?: InventoryItem | null
  }>
}

type WriteoffsResponse = {
  ok: boolean
  data?: {
    items: InventoryItem[]
    locations: InventoryLocation[]
    balances: InventoryBalance[]
    writeoffs: InventoryWriteoff[]
  }
  error?: string
}

type WriteoffLine = {
  item_id: string
  quantity: string
  comment: string
}

const emptyLine = (): WriteoffLine => ({
  item_id: '',
  quantity: '',
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

export default function StoreWriteoffsPage() {
  const [data, setData] = useState<WriteoffsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [locationId, setLocationId] = useState('')
  const [writtenAt, setWrittenAt] = useState(new Date().toISOString().slice(0, 10))
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<WriteoffLine[]>([emptyLine()])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/store/writeoffs', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as WriteoffsResponse | null
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить списания')
      setData(json.data)
      setLocationId((current) => current || json.data?.locations?.[0]?.id || '')
    } catch (err: any) {
      setData(null)
      setError(err?.message || 'Не удалось загрузить списания')
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
      .filter((balance) => balance.location_id === locationId && Number(balance.quantity || 0) > 0)
      .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
  }, [data?.balances, locationId])

  const createWriteoff = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payloadItems = lines
      .map((line) => ({
        item_id: line.item_id,
        quantity: parseQty(line.quantity),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.quantity > 0)

    if (!locationId) return setError('Выберите локацию для списания')
    if (!reason.trim()) return setError('Укажите причину списания')
    if (!payloadItems.length) return setError('Добавьте хотя бы одну позицию в списание')

    setSaving(true)
    try {
      const response = await fetch('/api/admin/store/writeoffs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createWriteoff',
          payload: {
            location_id: locationId,
            written_at: writtenAt,
            reason: reason.trim(),
            comment: comment.trim() || null,
            items: payloadItems,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось провести списание')

      setReason('')
      setComment('')
      setLines([emptyLine()])
      setSuccess('Списание проведено, остатки обновлены')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось провести списание')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 pb-8 pt-5 md:px-6">
      <Card className="border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-rose-400/20 bg-rose-500/10 px-3 py-1 text-xs text-rose-200">
              <ArchiveX className="h-3.5 w-3.5" />
              Списания
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Списание склада и витрин</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Отдельный экран для брака, служебного расхода, порчи и любых непригодных остатков по складу или точке.
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
            <h2 className="text-lg font-semibold text-foreground">Новый документ списания</h2>
            <p className="text-sm text-muted-foreground">Сначала локация и причина, потом только нужные позиции.</p>
          </div>

          <form onSubmit={createWriteoff} className="space-y-5">
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
                <Label>Дата списания</Label>
                <Input type="date" value={writtenAt} onChange={(event) => setWrittenAt(event.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Причина</Label>
                <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Брак, просрочка, служебное использование..." />
              </div>

              <div className="space-y-1.5">
                <Label>Комментарий</Label>
                <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Подробности по документу" />
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-muted-foreground">
              Доступно в локации: <span className="font-medium text-foreground">{selectedLocation?.company?.name || selectedLocation?.name || '—'}</span>
              {' · '}
              {selectedBalances.length} товарных позиций
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={`writeoff-${index}`} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.02] p-3 md:grid-cols-[minmax(0,1.5fr)_140px_minmax(0,1fr)_110px]">
                  <div className="space-y-1.5">
                    <Label>Товар</Label>
                    <Select
                      value={line.item_id || `__empty__writeoff_${index}`}
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
                        <SelectItem value={`__empty__writeoff_${index}`}>Выберите товар</SelectItem>
                        {selectedBalances.map((balance) => (
                          <SelectItem key={`${index}-${balance.item_id}`} value={balance.item_id}>
                            {balance.item?.name || 'Товар'} · {formatQty(Number(balance.quantity || 0))}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Списать</Label>
                    <Input value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="0" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Комментарий</Label>
                    <Input value={line.comment} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Например, брак" />
                  </div>

                  <div className="flex items-end">
                    <Button type="button" variant="outline" className="w-full" onClick={() => setLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>
                      Убрать
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setLines((current) => [...current, emptyLine()])}>
                Добавить строку
              </Button>
              <div className="text-sm text-muted-foreground">
                Сумма списаний в истории: <span className="font-semibold text-foreground">{formatMoney((data?.writeoffs || []).reduce((sum, item) => sum + Number(item.total_amount || 0), 0))}</span>
              </div>
            </div>

            <Button type="submit" disabled={saving} className="rounded-2xl">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ArchiveX className="mr-2 h-4 w-4" />}
              Провести списание
            </Button>
          </form>
        </Card>

        <div className="space-y-6">
          <Card className="border-white/10 p-5">
            <h2 className="text-lg font-semibold text-foreground">Последние списания</h2>
            <p className="mt-1 text-sm text-muted-foreground">История по складу и витринам с суммой и причинами.</p>

            <div className="mt-4 space-y-3">
              {(data?.writeoffs || []).length ? (
                data!.writeoffs.slice(0, 10).map((writeoff) => (
                  <div key={writeoff.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-medium text-foreground">{writeoff.location?.company?.name || writeoff.location?.name || 'Локация'}</div>
                        <div className="text-sm text-muted-foreground">{writeoff.reason}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-foreground">{formatMoney(Number(writeoff.total_amount || 0))}</div>
                        <div className="text-xs text-muted-foreground">{formatDate(writeoff.written_at)}</div>
                      </div>
                    </div>
                    {writeoff.comment ? <div className="mt-3 text-sm text-slate-300">{writeoff.comment}</div> : null}
                    <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
                      {(writeoff.items || []).slice(0, 4).map((item) => (
                        <span key={item.id} className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1">
                          {item.item?.name || 'Товар'} · {formatQty(Number(item.quantity || 0))}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-sm text-muted-foreground">
                  Пока нет списаний.
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
