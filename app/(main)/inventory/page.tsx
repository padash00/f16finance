'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Boxes,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Loader2,
  PackagePlus,
  RefreshCw,
  Store,
  Tag,
  Truck,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/core/format'

type InventoryCategory = { id: string; name: string; description: string | null; is_active: boolean }
type InventorySupplier = { id: string; name: string; contact_name: string | null; phone: string | null; notes: string | null }
type InventoryItem = {
  id: string
  name: string
  barcode: string
  category_id: string | null
  sale_price: number
  default_purchase_price: number
  unit: string
  is_active: boolean
  category?: { id: string; name: string } | null
}
type InventoryLocation = {
  id: string
  company_id: string | null
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
  is_active: boolean
  company?: { id: string; name: string; code: string | null } | null
}
type InventoryBalance = {
  location_id: string
  item_id: string
  quantity: number
  item?: { id: string; name: string; barcode: string } | null
  location?: InventoryLocation | null
}
type InventoryReceipt = {
  id: string
  received_at: string
  total_amount: number
  status: string
  invoice_number: string | null
  comment: string | null
  location?: InventoryLocation | null
  supplier?: { id: string; name: string } | null
  items?: Array<{
    id: string
    quantity: number
    unit_cost: number
    total_cost: number
    item?: { id: string; name: string; barcode: string } | null
  }>
}
type InventoryRequest = {
  id: string
  status: string
  comment: string | null
  decision_comment: string | null
  created_at: string
  approved_at: string | null
  company?: { id: string; name: string; code: string | null } | null
  source_location?: InventoryLocation | null
  target_location?: InventoryLocation | null
  items?: Array<{
    id: string
    requested_qty: number
    approved_qty: number | null
    comment: string | null
    item?: { id: string; name: string; barcode: string } | null
  }>
}

type InventoryResponse = {
  ok: boolean
  data?: {
    categories: InventoryCategory[]
    suppliers: InventorySupplier[]
    items: InventoryItem[]
    locations: InventoryLocation[]
    balances: InventoryBalance[]
    receipts: InventoryReceipt[]
    requests: InventoryRequest[]
    companies: Array<{ id: string; name: string; code: string | null }>
  }
  error?: string
}

type ReceiptLine = {
  item_id: string
  quantity: string
  unit_cost: string
  comment: string
}

type RequestLine = {
  item_id: string
  requested_qty: string
  comment: string
}

type DecisionDraft = {
  decisionComment: string
  quantities: Record<string, string>
}

const emptyReceiptLine = (): ReceiptLine => ({
  item_id: '',
  quantity: '',
  unit_cost: '',
  comment: '',
})

const emptyRequestLine = (): RequestLine => ({
  item_id: '',
  requested_qty: '',
  comment: '',
})

function parseMoney(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 100) / 100
}

function formatQty(value: number) {
  const normalized = Number(value || 0)
  return Number.isInteger(normalized) ? String(normalized) : normalized.toFixed(3)
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

function requestStatusLabel(status: string) {
  if (status === 'approved_full') return 'Одобрена полностью'
  if (status === 'approved_partial') return 'Одобрена частично'
  if (status === 'rejected') return 'Отклонена'
  return 'Новая'
}

function requestStatusClass(status: string) {
  if (status === 'approved_full') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'approved_partial') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (status === 'rejected') return 'border-red-500/30 bg-red-500/10 text-red-200'
  return 'border-blue-500/30 bg-blue-500/10 text-blue-200'
}

function createDecisionDraft(request: InventoryRequest): DecisionDraft {
  return {
    decisionComment: '',
    quantities: Object.fromEntries((request.items || []).map((item) => [item.id, formatQty(item.requested_qty)])),
  }
}

export default function InventoryPage() {
  const [data, setData] = useState<InventoryResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, DecisionDraft>>({})

  const [categoryName, setCategoryName] = useState('')
  const [categoryDescription, setCategoryDescription] = useState('')
  const [supplierName, setSupplierName] = useState('')
  const [supplierContact, setSupplierContact] = useState('')
  const [supplierPhone, setSupplierPhone] = useState('')
  const [supplierNotes, setSupplierNotes] = useState('')
  const [itemName, setItemName] = useState('')
  const [itemBarcode, setItemBarcode] = useState('')
  const [itemCategoryId, setItemCategoryId] = useState('')
  const [itemSalePrice, setItemSalePrice] = useState('')
  const [itemPurchasePrice, setItemPurchasePrice] = useState('')
  const [itemUnit, setItemUnit] = useState('шт')
  const [itemNotes, setItemNotes] = useState('')
  const [receiptLocationId, setReceiptLocationId] = useState('')
  const [receiptSupplierId, setReceiptSupplierId] = useState('')
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10))
  const [receiptInvoice, setReceiptInvoice] = useState('')
  const [receiptComment, setReceiptComment] = useState('')
  const [receiptLines, setReceiptLines] = useState<ReceiptLine[]>([emptyReceiptLine()])
  const [requestCompanyId, setRequestCompanyId] = useState('')
  const [requestSourceLocationId, setRequestSourceLocationId] = useState('')
  const [requestComment, setRequestComment] = useState('')
  const [requestLines, setRequestLines] = useState<RequestLine[]>([emptyRequestLine()])

  async function loadData() {
    setLoading(true)
    setError(null)

    const response = await fetch('/api/admin/inventory', { cache: 'no-store' })
    const json = (await response.json().catch(() => null)) as InventoryResponse | null

    if (!response.ok || !json?.ok || !json.data) {
      setError(json?.error || 'Не удалось загрузить складской контур')
      setLoading(false)
      return
    }

    const payload = json.data
    const defaultWarehouseId = payload.locations.find((item) => item.location_type === 'warehouse')?.id || ''

    setData(payload)
    setReceiptLocationId((current) => current || defaultWarehouseId)
    setRequestSourceLocationId((current) => current || defaultWarehouseId)

    const nextDrafts: Record<string, DecisionDraft> = {}
    for (const request of payload.requests || []) {
      nextDrafts[request.id] = decisionDrafts[request.id] || createDecisionDraft(request)
    }
    setDecisionDrafts(nextDrafts)
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const warehouseLocations = useMemo(
    () => (data?.locations || []).filter((item) => item.location_type === 'warehouse' && item.is_active),
    [data?.locations],
  )

  const pointLocations = useMemo(
    () => (data?.locations || []).filter((item) => item.location_type === 'point_display' && item.is_active),
    [data?.locations],
  )

  const topWarehouse = warehouseLocations[0] || null

  const pointBalancesByLocation = useMemo(() => {
    const map = new Map<string, InventoryBalance[]>()
    for (const balance of data?.balances || []) {
      if (balance.location?.location_type !== 'point_display') continue
      if (!map.has(balance.location_id)) map.set(balance.location_id, [])
      map.get(balance.location_id)!.push(balance)
    }
    return map
  }, [data?.balances])

  const groupedPointBalances = useMemo(() => {
    return pointLocations
      .map((location) => {
        const balances = pointBalancesByLocation.get(location.id) || []
        return {
          location,
          quantity: balances.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
          itemsCount: balances.filter((item) => Number(item.quantity || 0) > 0).length,
        }
      })
      .sort((a, b) => (a.location.name || '').localeCompare(b.location.name || ''))
  }, [pointLocations, pointBalancesByLocation])

  const warehouseBalances = useMemo(() => {
    if (!topWarehouse) return []
    return (data?.balances || [])
      .filter((item) => item.location_id === topWarehouse.id && Number(item.quantity || 0) > 0)
      .sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))
  }, [data?.balances, topWarehouse])

  const pendingRequests = useMemo(
    () => (data?.requests || []).filter((item) => item.status === 'new'),
    [data?.requests],
  )

  const selectedTargetLocation = useMemo(
    () => pointLocations.find((item) => item.company_id === requestCompanyId) || null,
    [pointLocations, requestCompanyId],
  )

  const receiptTotal = useMemo(
    () => receiptLines.reduce((sum, line) => sum + parseMoney(line.quantity) * parseMoney(line.unit_cost), 0),
    [receiptLines],
  )

  async function mutate(payload: unknown) {
    const response = await fetch('/api/admin/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const json = await response.json().catch(() => null)
    if (!response.ok) {
      throw new Error(json?.error || `Ошибка запроса (${response.status})`)
    }

    return json
  }

  async function handleCreateCategory() {
    if (!categoryName.trim()) return setError('Введите название категории')
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({ action: 'createCategory', payload: { name: categoryName.trim(), description: categoryDescription.trim() || null } })
      setCategoryName('')
      setCategoryDescription('')
      setSuccess('Категория товара создана')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать категорию')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateSupplier() {
    if (!supplierName.trim()) return setError('Введите название поставщика')
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'createSupplier',
        payload: {
          name: supplierName.trim(),
          contact_name: supplierContact.trim() || null,
          phone: supplierPhone.trim() || null,
          notes: supplierNotes.trim() || null,
        },
      })
      setSupplierName('')
      setSupplierContact('')
      setSupplierPhone('')
      setSupplierNotes('')
      setSuccess('Поставщик добавлен')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать поставщика')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateItem() {
    if (!itemName.trim()) return setError('Введите название товара')
    if (!itemBarcode.trim()) return setError('Введите штрихкод')
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'createItem',
        payload: {
          name: itemName.trim(),
          barcode: itemBarcode.trim(),
          category_id: itemCategoryId || null,
          sale_price: parseMoney(itemSalePrice),
          default_purchase_price: parseMoney(itemPurchasePrice),
          unit: itemUnit.trim() || 'шт',
          notes: itemNotes.trim() || null,
        },
      })
      setItemName('')
      setItemBarcode('')
      setItemCategoryId('')
      setItemSalePrice('')
      setItemPurchasePrice('')
      setItemUnit('шт')
      setItemNotes('')
      setSuccess('Товар создан')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать товар')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateReceipt() {
    if (!receiptLocationId) return setError('Выберите склад')

    const items = receiptLines
      .map((line) => ({
        item_id: line.item_id,
        quantity: parseMoney(line.quantity),
        unit_cost: parseMoney(line.unit_cost),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.quantity > 0)

    if (items.length === 0) return setError('Добавьте хотя бы одну строку приемки')

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'createReceipt',
        payload: {
          location_id: receiptLocationId,
          supplier_id: receiptSupplierId || null,
          received_at: receiptDate,
          invoice_number: receiptInvoice.trim() || null,
          comment: receiptComment.trim() || null,
          items,
        },
      })
      setReceiptSupplierId('')
      setReceiptInvoice('')
      setReceiptComment('')
      setReceiptLines([emptyReceiptLine()])
      setSuccess('Приемка проведена, остатки обновлены')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось провести приемку')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateRequest() {
    if (!requestCompanyId) return setError('Выберите точку')
    if (!selectedTargetLocation) return setError('Для точки не найдена витрина')
    if (!requestSourceLocationId) return setError('Выберите склад-источник')

    const items = requestLines
      .map((line) => ({
        item_id: line.item_id,
        requested_qty: parseMoney(line.requested_qty),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.requested_qty > 0)

    if (items.length === 0) return setError('Добавьте хотя бы одну строку заявки')

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'createRequest',
        payload: {
          source_location_id: requestSourceLocationId,
          target_location_id: selectedTargetLocation.id,
          requesting_company_id: requestCompanyId,
          comment: requestComment.trim() || null,
          items,
        },
      })
      setRequestCompanyId('')
      setRequestComment('')
      setRequestLines([emptyRequestLine()])
      setSuccess('Заявка точки создана')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать заявку')
    } finally {
      setSaving(false)
    }
  }

  async function handleDecideRequest(request: InventoryRequest, approved: boolean) {
    const draft = decisionDrafts[request.id] || createDecisionDraft(request)

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'decideRequest',
        requestId: request.id,
        approved,
        decision_comment: draft.decisionComment.trim() || null,
        items: (request.items || []).map((item) => ({
          request_item_id: item.id,
          approved_qty: approved ? parseMoney(draft.quantities[item.id] || '0') : 0,
        })),
      })
      setSuccess(approved ? 'Заявка обработана и товар выдан' : 'Заявка отклонена')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось обработать заявку')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="app-page max-w-[1680px] space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Инвентарь и склад</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Центральный склад, витрины точек, приемка, заявки и первое основание под продажи, долги и движение товара.
          </p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={() => void loadData()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </Button>
      </div>

      {error ? <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card> : null}
      {success ? <Card className="border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{success}</Card> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={Boxes} label="Товаров" value={String(data?.items.length || 0)} note="Общий каталог склада и точек" />
        <SummaryCard icon={Store} label="Локаций" value={String(data?.locations.length || 0)} note="Склад и витрины по точкам" />
        <SummaryCard icon={ClipboardList} label="Новых заявок" value={String(pendingRequests.length)} note="Ждут решения руководителя" />
        <SummaryCard icon={PackagePlus} label="Приемок" value={String(data?.receipts.length || 0)} note="Последние документы прихода" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="space-y-6">
          <Card className="border-border/70 p-5">
            <div className="mb-4 flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-emerald-400" />
              <div>
                <h2 className="text-lg font-semibold">Приемка на склад</h2>
                <p className="text-xs text-muted-foreground">
                  Фиксирует приход товара, цену закупа и сразу увеличивает остаток выбранного склада.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Склад">
                <Select value={receiptLocationId} onValueChange={setReceiptLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                  <SelectContent>
                    {warehouseLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Поставщик">
                <Select value={receiptSupplierId || '__none__'} onValueChange={(value) => setReceiptSupplierId(value === '__none__' ? '' : value)}>
                  <SelectTrigger><SelectValue placeholder="Без поставщика" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Без поставщика</SelectItem>
                    {(data?.suppliers || []).map((supplier) => (
                      <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Дата приемки">
                <Input type="date" value={receiptDate} onChange={(event) => setReceiptDate(event.target.value)} />
              </Field>

              <Field label="Номер накладной">
                <Input value={receiptInvoice} onChange={(event) => setReceiptInvoice(event.target.value)} placeholder="Например, INV-245" />
              </Field>
            </div>

            <Field label="Комментарий" className="mt-4">
              <Textarea value={receiptComment} onChange={(event) => setReceiptComment(event.target.value)} placeholder="Поставщик, условия, важные пометки" />
            </Field>

            <div className="mt-5 space-y-3">
              {receiptLines.map((line, index) => (
                <LineCard key={`receipt-${index}`}>
                  <Field label={index === 0 ? 'Товар' : undefined}>
                    <Select
                      value={line.item_id || `__empty__${index}`}
                      onValueChange={(value) =>
                        setReceiptLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__empty__${index}`}>Выберите товар</SelectItem>
                        {(data?.items || []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.name} · {item.barcode}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={index === 0 ? 'Кол-во' : undefined}>
                    <Input value={line.quantity} onChange={(event) => setReceiptLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="0" />
                  </Field>
                  <Field label={index === 0 ? 'Цена закупа' : undefined}>
                    <Input value={line.unit_cost} onChange={(event) => setReceiptLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, unit_cost: event.target.value } : item))} placeholder="0" />
                  </Field>
                  <Field label={index === 0 ? 'Комментарий' : undefined}>
                    <Input value={line.comment} onChange={(event) => setReceiptLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Опционально" />
                  </Field>
                  <div className="flex items-end">
                    <Button type="button" variant="outline" className="w-full" onClick={() => setReceiptLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>
                      Убрать
                    </Button>
                  </div>
                </LineCard>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setReceiptLines((current) => [...current, emptyReceiptLine()])}>Добавить строку</Button>
              <div className="text-sm text-muted-foreground">
                Общая сумма приемки: <span className="font-semibold text-foreground">{formatMoney(receiptTotal)}</span>
              </div>
            </div>

            <div className="mt-4">
              <Button type="button" className="gap-2" onClick={handleCreateReceipt} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
                Провести приемку
              </Button>
            </div>
          </Card>

          <Card className="border-border/70 p-5">
            <div className="mb-4 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 text-blue-400" />
              <div>
                <h2 className="text-lg font-semibold">Заявка точки</h2>
                <p className="text-xs text-muted-foreground">
                  Руководитель или супер-админ может вручную создать заявку точки и сразу отправить её на одобрение.
                </p>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Точка">
                <Select value={requestCompanyId} onValueChange={setRequestCompanyId}>
                  <SelectTrigger><SelectValue placeholder="Выберите точку" /></SelectTrigger>
                  <SelectContent>
                    {(data?.companies || []).map((company) => (
                      <SelectItem key={company.id} value={company.id}>{company.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Склад-источник">
                <Select value={requestSourceLocationId} onValueChange={setRequestSourceLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                  <SelectContent>
                    {warehouseLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            <div className="mt-3 rounded-2xl border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
              Витрина точки: <span className="font-medium text-foreground">{selectedTargetLocation?.name || 'будет выбрана после выбора точки'}</span>
            </div>

            <Field label="Комментарий" className="mt-4">
              <Textarea value={requestComment} onChange={(event) => setRequestComment(event.target.value)} placeholder="Что нужно точке и зачем" />
            </Field>

            <div className="mt-5 space-y-3">
              {requestLines.map((line, index) => (
                <LineCard key={`request-${index}`}>
                  <Field label={index === 0 ? 'Товар' : undefined}>
                    <Select
                      value={line.item_id || `__empty__request_${index}`}
                      onValueChange={(value) =>
                        setRequestLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__empty__request_${index}`}>Выберите товар</SelectItem>
                        {(data?.items || []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.name} · {item.barcode}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={index === 0 ? 'Нужно' : undefined}>
                    <Input value={line.requested_qty} onChange={(event) => setRequestLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, requested_qty: event.target.value } : item))} placeholder="0" />
                  </Field>
                  <Field label={index === 0 ? 'Комментарий' : undefined} className="md:col-span-2">
                    <Input value={line.comment} onChange={(event) => setRequestLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Например, в витрине закончился товар" />
                  </Field>
                  <div className="flex items-end">
                    <Button type="button" variant="outline" className="w-full" onClick={() => setRequestLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>
                      Убрать
                    </Button>
                  </div>
                </LineCard>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={() => setRequestLines((current) => [...current, emptyRequestLine()])}>Добавить позицию</Button>
              <Button type="button" className="gap-2" onClick={handleCreateRequest} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
                Создать заявку
              </Button>
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="border-border/70 p-5">
            <SectionTitle icon={ClipboardCheck} title="Заявки на одобрение" subtitle="Решение по заявке сразу двигает товар со склада на витрину точки." />
            <div className="space-y-4">
              {pendingRequests.map((request) => {
                const draft = decisionDrafts[request.id] || createDecisionDraft(request)
                return (
                  <div key={request.id} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div>
                        <div className="text-sm font-semibold">{request.company?.name || request.target_location?.name || 'Точка'} · {formatDate(request.created_at)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          Со склада: {request.source_location?.name || '—'} → {request.target_location?.name || '—'}
                        </div>
                      </div>
                      <span className={`inline-flex w-fit rounded-full border px-3 py-1 text-xs font-medium ${requestStatusClass(request.status)}`}>
                        {requestStatusLabel(request.status)}
                      </span>
                    </div>

                    {request.comment ? <p className="mt-3 text-sm text-muted-foreground">{request.comment}</p> : null}

                    <div className="mt-4 space-y-3">
                      {(request.items || []).map((item) => (
                        <div key={item.id} className="grid gap-3 rounded-xl border border-border/60 p-3 md:grid-cols-[minmax(0,1.1fr)_130px_130px]">
                          <div>
                            <div className="font-medium">{item.item?.name || 'Товар'}</div>
                            <div className="text-xs text-muted-foreground">{item.item?.barcode || '—'}</div>
                            {item.comment ? <div className="mt-1 text-xs text-muted-foreground">{item.comment}</div> : null}
                          </div>
                          <div className="rounded-xl border border-border/60 px-3 py-2 text-sm">
                            <div className="text-xs text-muted-foreground">Запрошено</div>
                            <div className="font-semibold">{formatQty(item.requested_qty)}</div>
                          </div>
                          <Field label="Одобрить">
                            <Input
                              value={draft.quantities[item.id] ?? formatQty(item.requested_qty)}
                              onChange={(event) =>
                                setDecisionDrafts((current) => ({
                                  ...current,
                                  [request.id]: {
                                    decisionComment: current[request.id]?.decisionComment ?? draft.decisionComment,
                                    quantities: {
                                      ...(current[request.id]?.quantities || draft.quantities),
                                      [item.id]: event.target.value,
                                    },
                                  },
                                }))
                              }
                            />
                          </Field>
                        </div>
                      ))}
                    </div>

                    <Field label="Комментарий решения" className="mt-4">
                      <Textarea
                        value={draft.decisionComment}
                        onChange={(event) =>
                          setDecisionDrafts((current) => ({
                            ...current,
                            [request.id]: {
                              decisionComment: event.target.value,
                              quantities: current[request.id]?.quantities || draft.quantities,
                            },
                          }))
                        }
                        placeholder="Например, часть товара закончилась на складе"
                      />
                    </Field>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button type="button" className="gap-2" onClick={() => void handleDecideRequest(request, true)} disabled={saving}>
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardCheck className="h-4 w-4" />}
                        Одобрить и выдать
                      </Button>
                      <Button type="button" variant="outline" onClick={() => void handleDecideRequest(request, false)} disabled={saving}>
                        Отклонить
                      </Button>
                    </div>
                  </div>
                )
              })}

              {!pendingRequests.length ? (
                <div className="rounded-2xl border border-dashed border-border/70 p-6 text-sm text-muted-foreground">
                  Сейчас нет новых заявок на одобрение.
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="border-border/70 p-5">
            <SectionTitle icon={Boxes} title="Остатки по витринам" subtitle="Сколько товара уже лежит на точках после одобренных заявок." />
            <div className="space-y-2">
              {groupedPointBalances.map((item) => (
                <div key={item.location.id} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">{item.location.company?.name || item.location.name}</div>
                    <div className="text-xs text-muted-foreground">{item.itemsCount} товарных позиций</div>
                  </div>
                  <div className="font-semibold">{formatQty(item.quantity)}</div>
                </div>
              ))}
              {!groupedPointBalances.length ? (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  Пока нет остатков на витринах. Они появятся после одобренных заявок.
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="border-border/70 p-5">
            <SectionTitle icon={Tag} title="Категории товара" subtitle="Категории создаются на сайте и потом используются в общем каталоге." />
            <div className="space-y-3">
              <Field label="Название категории">
                <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Напитки, снеки, кухня..." />
              </Field>
              <Field label="Описание">
                <Textarea value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} placeholder="Необязательно" />
              </Field>
              <Button type="button" onClick={handleCreateCategory} disabled={saving}>Создать категорию</Button>
              <div className="flex flex-wrap gap-2">
                {(data?.categories || []).map((category) => (
                  <span key={category.id} className="rounded-full border border-border/70 px-3 py-1 text-xs">
                    {category.name}
                  </span>
                ))}
              </div>
            </div>
          </Card>

          <Card className="border-border/70 p-5">
            <SectionTitle icon={Truck} title="Поставщики" subtitle="Поставщики и контактные лица для приемки товара." />
            <div className="grid gap-3">
              <Field label="Название поставщика">
                <Input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} placeholder="Например, Pepsi, локальный поставщик" />
              </Field>
              <Field label="Контактное лицо">
                <Input value={supplierContact} onChange={(event) => setSupplierContact(event.target.value)} placeholder="Необязательно" />
              </Field>
              <Field label="Телефон">
                <Input value={supplierPhone} onChange={(event) => setSupplierPhone(event.target.value)} placeholder="+7..." />
              </Field>
              <Field label="Комментарий">
                <Textarea value={supplierNotes} onChange={(event) => setSupplierNotes(event.target.value)} placeholder="Условия поставки, важные заметки" />
              </Field>
              <Button type="button" onClick={handleCreateSupplier} disabled={saving}>Добавить поставщика</Button>
            </div>
          </Card>

          <Card className="border-border/70 p-5">
            <SectionTitle icon={Building2} title="Товарная карточка" subtitle="Товар, штрихкод, категория, цена продажи и закупа." />
            <div className="grid gap-3">
              <Field label="Название">
                <Input value={itemName} onChange={(event) => setItemName(event.target.value)} placeholder="Coca Cola 0.25" />
              </Field>
              <Field label="Штрихкод">
                <Input value={itemBarcode} onChange={(event) => setItemBarcode(event.target.value)} placeholder="5449000008046" />
              </Field>
              <Field label="Категория">
                <Select value={itemCategoryId || '__none__'} onValueChange={(value) => setItemCategoryId(value === '__none__' ? '' : value)}>
                  <SelectTrigger><SelectValue placeholder="Без категории" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Без категории</SelectItem>
                    {(data?.categories || []).map((category) => (
                      <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Цена продажи">
                  <Input value={itemSalePrice} onChange={(event) => setItemSalePrice(event.target.value)} placeholder="0" />
                </Field>
                <Field label="Цена закупа по умолчанию">
                  <Input value={itemPurchasePrice} onChange={(event) => setItemPurchasePrice(event.target.value)} placeholder="0" />
                </Field>
              </div>
              <Field label="Единица">
                <Input value={itemUnit} onChange={(event) => setItemUnit(event.target.value)} placeholder="шт" />
              </Field>
              <Field label="Комментарий">
                <Textarea value={itemNotes} onChange={(event) => setItemNotes(event.target.value)} placeholder="Необязательно" />
              </Field>
              <Button type="button" onClick={handleCreateItem} disabled={saving}>Создать товар</Button>
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className="border-border/70 p-5">
          <SectionTitle icon={PackagePlus} title="Последние приемки" subtitle="Журнал последних складских приходов." />
          <div className="space-y-3">
            {(data?.receipts || []).map((receipt) => (
              <div key={receipt.id} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-semibold">{receipt.location?.name || 'Склад'} · {formatDate(receipt.received_at)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Поставщик: {receipt.supplier?.name || 'не указан'} · Накладная: {receipt.invoice_number || '—'}
                    </div>
                    {receipt.comment ? <div className="mt-1 text-xs text-muted-foreground">{receipt.comment}</div> : null}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">{formatMoney(receipt.total_amount || 0)}</div>
                    <div className="text-xs text-muted-foreground">{receipt.items?.length || 0} строк</div>
                  </div>
                </div>
              </div>
            ))}
            {!data?.receipts?.length ? <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">Пока нет приемок.</div> : null}
          </div>
        </Card>

        <Card className="border-border/70 p-5">
          <SectionTitle icon={ClipboardList} title="Последние заявки" subtitle="История заявок точек, включая уже одобренные и отклонённые." />
          <div className="space-y-3">
            {(data?.requests || []).map((request) => (
              <div key={request.id} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="text-sm font-semibold">{request.company?.name || request.target_location?.name || 'Точка'} · {formatDate(request.created_at)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {request.source_location?.name || 'Склад'} → {request.target_location?.name || 'Витрина'}
                    </div>
                    {request.comment ? <div className="mt-1 text-xs text-muted-foreground">{request.comment}</div> : null}
                    {request.decision_comment ? <div className="mt-1 text-xs text-muted-foreground">Решение: {request.decision_comment}</div> : null}
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${requestStatusClass(request.status)}`}>
                      {requestStatusLabel(request.status)}
                    </span>
                    <span className="text-xs text-muted-foreground">{request.items?.length || 0} позиций</span>
                  </div>
                </div>
              </div>
            ))}
            {!data?.requests?.length ? <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">Пока нет заявок.</div> : null}
          </div>
        </Card>
      </div>
    </div>
  )
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Boxes
  label: string
  value: string
  note: string
}) {
  return (
    <Card className="border-border/70 bg-background/70 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm text-muted-foreground">{label}</div>
          <div className="mt-2 text-3xl font-bold text-foreground">{value}</div>
          <div className="mt-2 text-xs text-muted-foreground">{note}</div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-background/60 p-3">
          <Icon className="h-5 w-5 text-emerald-300" />
        </div>
      </div>
    </Card>
  )
}

function SectionTitle({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: typeof Boxes
  title: string
  subtitle: string
}) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <Icon className="h-5 w-5 text-blue-300" />
      <div>
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function Field({
  label,
  className,
  children,
}: {
  label?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={className}>
      {label ? <Label className="mb-2 block text-sm">{label}</Label> : null}
      {children}
    </div>
  )
}

function LineCard({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-border/70 bg-background/40 p-3 md:grid-cols-[minmax(0,1.2fr)_120px_140px_minmax(0,1fr)_auto]">
      {children}
    </div>
  )
}
