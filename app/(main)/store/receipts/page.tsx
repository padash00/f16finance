'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, PackagePlus, RefreshCw } from 'lucide-react'

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
}

type InventorySupplier = {
  id: string
  name: string
}

type InventoryItem = {
  id: string
  name: string
  barcode: string
  unit: string
  default_purchase_price: number
  item_type: string
  category?: { id: string; name: string } | null
}

type InventoryReceipt = {
  id: string
  received_at: string
  total_amount: number
  invoice_number: string | null
  comment: string | null
  supplier?: InventorySupplier | null
  location?: InventoryLocation | null
  items?: Array<{
    id: string
    quantity: number
    unit_cost: number
    total_cost: number
    item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  }>
}

type ReceiptsResponse = {
  ok: boolean
  data?: {
    items: InventoryItem[]
    suppliers: InventorySupplier[]
    locations: InventoryLocation[]
    receipts: InventoryReceipt[]
  }
  error?: string
}

type ReceiptLine = {
  item_id: string
  quantity: string
  unit_cost: string
  comment: string
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

function normalizeReceipt(raw: any): InventoryReceipt {
  return {
    id: String(raw?.id || ''),
    received_at: raw?.received_at || '',
    total_amount: Number(raw?.total_amount || 0),
    invoice_number: raw?.invoice_number || null,
    comment: raw?.comment || null,
    supplier: firstOrSelf(raw?.supplier),
    location: firstOrSelf(raw?.location),
    items: asArray(raw?.items).map((item: any) => ({
      id: String(item?.id || ''),
      quantity: Number(item?.quantity || 0),
      unit_cost: Number(item?.unit_cost || 0),
      total_cost: Number(item?.total_cost || 0),
      item: firstOrSelf(item?.item),
    })),
  }
}

function parseMoney(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

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

const emptyLine = (): ReceiptLine => ({
  item_id: '',
  quantity: '',
  unit_cost: '',
  comment: '',
})

export default function StoreReceiptsPage() {
  const [data, setData] = useState<ReceiptsResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [locationId, setLocationId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<ReceiptLine[]>([emptyLine()])

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/store/receipts', { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as ReceiptsResponse | null
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить приемку')
      const normalized = {
        items: asArray(json.data.items),
        suppliers: asArray(json.data.suppliers),
        locations: asArray(json.data.locations),
        receipts: asArray(json.data.receipts).map(normalizeReceipt),
      }
      setData(normalized)
      setLocationId((current) => current || normalized.locations?.[0]?.id || '')
    } catch (err: any) {
      setData(null)
      setError(err?.message || 'Не удалось загрузить приемку')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const receiptTotal = useMemo(() => {
    return lines.reduce((sum, line) => sum + parseQty(line.quantity) * parseMoney(line.unit_cost), 0)
  }, [lines])

  const createReceipt = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payloadItems = lines
      .map((line) => ({
        item_id: line.item_id,
        quantity: parseQty(line.quantity),
        unit_cost: parseMoney(line.unit_cost),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.quantity > 0 && line.unit_cost >= 0)

    if (!locationId) {
      setError('Выберите склад для приемки')
      return
    }
    if (!payloadItems.length) {
      setError('Добавьте хотя бы одну товарную строку')
      return
    }

    setSaving(true)
    try {
      const response = await fetch('/api/admin/store/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createReceipt',
          payload: {
            location_id: locationId,
            supplier_id: supplierId || null,
            received_at: receivedAt,
            invoice_number: invoiceNumber.trim() || null,
            comment: comment.trim() || null,
            items: payloadItems,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось провести приемку')

      setSupplierId('')
      setInvoiceNumber('')
      setComment('')
      setLines([emptyLine()])
      setSuccess('Приемка проведена, остатки склада обновлены')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось провести приемку')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-gradient-to-br from-white/[0.05] via-white/[0.03] to-transparent p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-200">
              <PackagePlus className="h-3.5 w-3.5" />
              Приемка
            </div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">Оформление прихода на склад</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              Чистый экран только под приемку: склад, поставщик, цены закупа и товарные строки без лишних блоков от других разделов.
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
      {success ? (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">{success}</div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="border-white/10 p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Новый документ приемки</h2>
            <p className="text-sm text-muted-foreground">Заполняется быстро: склад, поставщик, дата, а дальше только товарные строки.</p>
          </div>

          <form onSubmit={createReceipt} className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Склад</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                  <SelectContent>
                    {(data?.locations || []).map((location) => (
                      <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Поставщик</Label>
                <Select value={supplierId || '__none__'} onValueChange={(value) => setSupplierId(value === '__none__' ? '' : value)}>
                  <SelectTrigger><SelectValue placeholder="Без поставщика" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Без поставщика</SelectItem>
                    {(data?.suppliers || []).map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Дата приемки</Label>
                <Input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Номер накладной</Label>
                <Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Например, INV-104" />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Что важно по этой приемке" rows={3} />
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={index} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:grid-cols-[minmax(0,1.4fr)_120px_140px_minmax(0,1fr)_auto]">
                  <div className="space-y-1.5">
                    <Label>Товар</Label>
                    <Select
                      value={line.item_id || `__empty__${index}`}
                      onValueChange={(value) =>
                        setLines((current) =>
                          current.map((item, itemIndex) => {
                            if (itemIndex !== index) return item
                            const selectedItem = (data?.items || []).find((row) => row.id === value)
                            return {
                              ...item,
                              item_id: value.startsWith('__empty__') ? '' : value,
                              unit_cost: selectedItem ? String(selectedItem.default_purchase_price || '') : item.unit_cost,
                            }
                          }),
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__empty__${index}`}>Выберите товар</SelectItem>
                        {(data?.items || []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.name} · {item.barcode}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <Label>Кол-во</Label>
                    <Input value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="0" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Цена закупа</Label>
                    <Input value={line.unit_cost} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unit_cost: event.target.value } : item))} placeholder="0" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Комментарий</Label>
                    <Input value={line.comment} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Например, акция поставщика" />
                  </div>

                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}
                    >
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
              <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
                <p className="text-xs text-muted-foreground">Сумма приемки</p>
                <p className="mt-1 text-2xl font-semibold text-foreground">{formatMoney(receiptTotal)}</p>
              </div>
            </div>

            <Button type="submit" disabled={saving || loading} className="w-full">
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}
              Провести приемку
            </Button>
          </form>
        </Card>

        <Card className="border-white/10 p-5">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-foreground">Последние документы</h2>
            <p className="text-sm text-muted-foreground">Свежие приходные документы по складу, чтобы быстро проверить сумму и поставщика.</p>
          </div>

          <div className="space-y-3">
            {loading ? (
              <div className="flex h-24 items-center justify-center">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (data?.receipts || []).length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center text-sm text-muted-foreground">
                Документов приемки пока нет.
              </div>
            ) : (
              (data?.receipts || []).map((receipt) => (
                <div key={receipt.id} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-foreground">{receipt.supplier?.name || 'Без поставщика'}</p>
                      <p className="text-xs text-muted-foreground">{receipt.location?.name || 'Склад'} • {formatDate(receipt.received_at)}</p>
                    </div>
                    <p className="font-semibold text-foreground">{formatMoney(receipt.total_amount || 0)}</p>
                  </div>
                  <div className="mt-3 text-xs text-muted-foreground">
                    {receipt.invoice_number || 'Без номера накладной'} • {(receipt.items || []).length} строк
                  </div>
                  {receipt.comment ? <p className="mt-2 text-sm text-muted-foreground">{receipt.comment}</p> : null}
                  <div className="mt-3 space-y-2">
                    {(receipt.items || []).slice(0, 3).map((item) => (
                      <div key={item.id} className="flex items-center justify-between rounded-xl border border-white/10 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{item.item?.name || 'Товар'}</p>
                          <p className="text-xs text-muted-foreground">{item.item?.barcode || 'Без штрихкода'}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-foreground">{formatQty(item.quantity)} {item.item?.unit || 'шт'}</p>
                          <p className="text-xs text-muted-foreground">{formatMoney(item.total_cost || 0)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}
