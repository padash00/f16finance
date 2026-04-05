'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArchiveX,
  Boxes,
  Building2,
  Check,
  ChevronsUpDown,
  ClipboardCheck,
  ClipboardList,
  History,
  Loader2,
  PackagePlus,
  Pencil,
  RefreshCw,
  ScanSearch,
  Store,
  Tag,
  Truck,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/core/format'
import { InventoryLegacyRedirect } from './legacy-redirect'

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
  notes: string | null
  is_active: boolean
  item_type: string
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
    item?: { id: string; name: string; barcode: string } | null
  }>
}
type InventoryStocktake = {
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
    item?: { id: string; name: string; barcode: string } | null
  }>
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
  item?: { id: string; name: string; barcode: string } | null
  from_location?: InventoryLocation | null
  to_location?: InventoryLocation | null
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
    writeoffs: InventoryWriteoff[]
    stocktakes: InventoryStocktake[]
    movements: InventoryMovement[]
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

type WriteoffLine = {
  item_id: string
  quantity: string
  comment: string
}

type StocktakeLine = {
  item_id: string
  actual_qty: string
  comment: string
}

type DecisionDraft = {
  decisionComment: string
  quantities: Record<string, string>
}

type InventoryView =
  | 'overview'
  | 'catalog'
  | 'receipts'
  | 'requests'
  | 'analytics'
  | 'writeoffs'
  | 'stocktakes'
  | 'movements'

const inventoryViewMeta: Record<InventoryView, { title: string; description: string }> = {
  overview: {
    title: 'Магазин',
    description:
      'Центральный склад организации и витрины только на тех точках, где вы их включили. Заявки, приёмка и движения товара.',
  },
  catalog: {
    title: 'Каталог магазина',
    description: 'Товары, категории и поставщики, с которыми дальше работает складской контур.',
  },
  receipts: {
    title: 'Приемка товара',
    description: 'Оформление прихода на центральный склад: поставщик, цены закупа, количество и сумма.',
  },
  requests: {
    title: 'Заявки точек',
    description: 'Запросы от кассиров, одобрение руководителем и выдача товара на витрины точек.',
  },
  analytics: {
    title: 'Аналитика по точкам',
    description: 'Остатки на витринах, поступления, продажи, долги, возвраты и чистое движение по точкам.',
  },
  writeoffs: {
    title: 'Списания',
    description: 'Брак, потери и служебное потребление по складу и витринам.',
  },
  stocktakes: {
    title: 'Ревизия склада и витрин',
    description: 'Полная проверка склада или витрины точки с фиксацией расхождений и корректировкой остатков.',
  },
  movements: {
    title: 'Журнал движений',
    description: 'Все товарные операции: приемка, выдача на точку, продажа, долг, возврат и корректировки.',
  },
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

const emptyWriteoffLine = (): WriteoffLine => ({
  item_id: '',
  quantity: '',
  comment: '',
})

const emptyStocktakeLine = (): StocktakeLine => ({
  item_id: '',
  actual_qty: '',
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
  if (status === 'issued') return 'Выдана'
  if (status === 'received') return 'Получена'
  if (status === 'disputed') return 'Спор'
  return 'Новая'
}

function requestStatusClass(status: string) {
  if (status === 'approved_full') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'approved_partial') return 'border-amber-500/30 bg-amber-500/10 text-amber-200'
  if (status === 'rejected') return 'border-red-500/30 bg-red-500/10 text-red-200'
  if (status === 'issued') return 'border-purple-500/30 bg-purple-500/10 text-purple-200'
  if (status === 'received') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
  if (status === 'disputed') return 'border-red-500/30 bg-red-500/10 text-red-200'
  return 'border-blue-500/30 bg-blue-500/10 text-blue-200'
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
  if (type === 'inventory_adjustment') return 'border-orange-500/30 bg-orange-500/10 text-orange-200'
  return 'border-border/70 bg-background/60 text-muted-foreground'
}

function createDecisionDraft(request: InventoryRequest): DecisionDraft {
  return {
    decisionComment: '',
    quantities: Object.fromEntries((request.items || []).map((item) => [item.id, formatQty(item.requested_qty)])),
  }
}

function ItemCombobox({
  items,
  value,
  onChange,
  placeholder = 'Выберите товар',
}: {
  items: InventoryItem[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const selected = items.find((item) => item.id === value)
  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    if (!q) return items
    return items.filter((item) => item.name.toLowerCase().includes(q) || item.barcode.includes(q))
  }, [items, search])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="h-9 w-full justify-between font-normal">
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск по названию или штрихкоду..." value={search} onValueChange={setSearch} />
          <CommandList>
            <CommandEmpty>Товар не найден</CommandEmpty>
            <CommandGroup>
              {filtered.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={() => { onChange(item.id); setSearch(''); setOpen(false) }}
                >
                  <Check className={`mr-2 h-4 w-4 ${value === item.id ? 'opacity-100' : 'opacity-0'}`} />
                  <span className="flex-1 truncate">{item.name}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">{item.barcode}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function InventoryPageContent({ forcedView = 'overview' }: { forcedView?: InventoryView }) {
  const [data, setData] = useState<InventoryResponse['data'] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [decisionDrafts, setDecisionDrafts] = useState<Record<string, DecisionDraft>>({})

  // Edit state
  const [editingCategory, setEditingCategory] = useState<InventoryCategory | null>(null)
  const [editingSupplier, setEditingSupplier] = useState<InventorySupplier | null>(null)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)

  // Pagination
  const [receiptsPage, setReceiptsPage] = useState(5)
  const [requestsPage, setRequestsPage] = useState(5)
  const [writeoffsPage, setWriteoffsPage] = useState(5)
  const [stocktakesPage, setStocktakesPage] = useState(5)
  const [movementsPage, setMovementsPage] = useState(20)

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
  const [itemType, setItemType] = useState<'product' | 'consumable'>('product')
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
  const [writeoffLocationId, setWriteoffLocationId] = useState('')
  const [writeoffDate, setWriteoffDate] = useState(new Date().toISOString().slice(0, 10))
  const [writeoffReason, setWriteoffReason] = useState('')
  const [writeoffComment, setWriteoffComment] = useState('')
  const [writeoffLines, setWriteoffLines] = useState<WriteoffLine[]>([emptyWriteoffLine()])
  const [stocktakeLocationId, setStocktakeLocationId] = useState('')
  const [stocktakeDate, setStocktakeDate] = useState(new Date().toISOString().slice(0, 10))
  const [stocktakeComment, setStocktakeComment] = useState('')
  const [stocktakeLines, setStocktakeLines] = useState<StocktakeLine[]>([])

  const inventoryView = forcedView

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
    setWriteoffLocationId((current) => current || defaultWarehouseId)
    setStocktakeLocationId((current) => current || defaultWarehouseId)

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

  const lowWarehouseBalances = useMemo(() => {
    return [...warehouseBalances]
      .sort((a, b) => Number(a.quantity || 0) - Number(b.quantity || 0))
      .slice(0, 8)
  }, [warehouseBalances])

  const pendingRequests = useMemo(
    () => (data?.requests || []).filter((item) => item.status === 'new'),
    [data?.requests],
  )

  const recentReceipts = useMemo(() => (data?.receipts || []).slice(0, 5), [data?.receipts])
  const recentMovements = useMemo(() => (data?.movements || []).slice(0, 8), [data?.movements])
  const warehouseStockQty = useMemo(
    () =>
      (data?.balances || [])
        .filter((item) => item.location?.location_type === 'warehouse')
        .reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [data?.balances],
  )
  const pointStockQty = useMemo(
    () => groupedPointBalances.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
    [groupedPointBalances],
  )

  const selectedTargetLocation = useMemo(
    () => pointLocations.find((item) => item.company_id === requestCompanyId) || null,
    [pointLocations, requestCompanyId],
  )

  const activeLocations = useMemo(
    () => (data?.locations || []).filter((item) => item.is_active),
    [data?.locations],
  )

  const selectedWriteoffLocation = useMemo(
    () => activeLocations.find((item) => item.id === writeoffLocationId) || null,
    [activeLocations, writeoffLocationId],
  )

  const selectedStocktakeLocation = useMemo(
    () => activeLocations.find((item) => item.id === stocktakeLocationId) || null,
    [activeLocations, stocktakeLocationId],
  )

  const balancesByLocation = useMemo(() => {
    const map = new Map<string, InventoryBalance[]>()
    for (const balance of data?.balances || []) {
      if (!map.has(balance.location_id)) map.set(balance.location_id, [])
      map.get(balance.location_id)!.push(balance)
    }
    return map
  }, [data?.balances])

  const selectedWriteoffBalances = useMemo(
    () => (writeoffLocationId ? balancesByLocation.get(writeoffLocationId) || [] : []),
    [balancesByLocation, writeoffLocationId],
  )

  const selectedStocktakeBalances = useMemo(
    () => (stocktakeLocationId ? balancesByLocation.get(stocktakeLocationId) || [] : []),
    [balancesByLocation, stocktakeLocationId],
  )

  const receiptTotal = useMemo(
    () => receiptLines.reduce((sum, line) => sum + parseMoney(line.quantity) * parseMoney(line.unit_cost), 0),
    [receiptLines],
  )

  const writeoffTotal = useMemo(() => {
    const priceMap = new Map((data?.items || []).map((item) => [item.id, Number(item.default_purchase_price || 0)]))
    return writeoffLines.reduce((sum, line) => sum + parseMoney(line.quantity) * Number(priceMap.get(line.item_id) || 0), 0)
  }, [data?.items, writeoffLines])

  const pointMovementAnalytics = useMemo(() => {
    const summary = new Map<string, {
      location: InventoryLocation
      stock_qty: number
      stock_items: number
      incoming_qty: number
      incoming_amount: number
      sale_qty: number
      sale_amount: number
      debt_qty: number
      debt_amount: number
      return_qty: number
      return_amount: number
      writeoff_qty: number
      writeoff_amount: number
      adjustment_in_qty: number
      adjustment_out_qty: number
      net_issue_qty: number
      last_movement_at: string | null
    }>()

    for (const location of pointLocations) {
      const balances = balancesByLocation.get(location.id) || []
      summary.set(location.id, {
        location,
        stock_qty: balances.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        stock_items: balances.filter((item) => Number(item.quantity || 0) > 0).length,
        incoming_qty: 0,
        incoming_amount: 0,
        sale_qty: 0,
        sale_amount: 0,
        debt_qty: 0,
        debt_amount: 0,
        return_qty: 0,
        return_amount: 0,
        writeoff_qty: 0,
        writeoff_amount: 0,
        adjustment_in_qty: 0,
        adjustment_out_qty: 0,
        net_issue_qty: 0,
        last_movement_at: null,
      })
    }

    for (const movement of data?.movements || []) {
      const fromPoint = movement.from_location?.location_type === 'point_display' ? summary.get(movement.from_location.id) : null
      const toPoint = movement.to_location?.location_type === 'point_display' ? summary.get(movement.to_location.id) : null
      const qty = Number(movement.quantity || 0)
      const amount = Number(movement.total_amount || 0)

      if (fromPoint) {
        if (!fromPoint.last_movement_at || new Date(movement.created_at).getTime() > new Date(fromPoint.last_movement_at).getTime()) {
          fromPoint.last_movement_at = movement.created_at
        }
      }

      if (toPoint) {
        if (!toPoint.last_movement_at || new Date(movement.created_at).getTime() > new Date(toPoint.last_movement_at).getTime()) {
          toPoint.last_movement_at = movement.created_at
        }
      }

      if (movement.movement_type === 'transfer_to_point' && toPoint) {
        toPoint.incoming_qty += qty
        toPoint.incoming_amount += amount
      }

      if (movement.movement_type === 'sale' && fromPoint) {
        fromPoint.sale_qty += qty
        fromPoint.sale_amount += amount
      }

      if (movement.movement_type === 'debt' && fromPoint) {
        fromPoint.debt_qty += qty
        fromPoint.debt_amount += amount
      }

      if (movement.movement_type === 'return' && toPoint) {
        toPoint.return_qty += qty
        toPoint.return_amount += amount
      }

      if (movement.movement_type === 'writeoff' && fromPoint) {
        fromPoint.writeoff_qty += qty
        fromPoint.writeoff_amount += amount
      }

      if (movement.movement_type === 'inventory_adjustment') {
        if (toPoint) toPoint.adjustment_in_qty += qty
        if (fromPoint) fromPoint.adjustment_out_qty += qty
      }
    }

    return Array.from(summary.values())
      .map((item) => ({
        ...item,
        net_issue_qty:
          item.sale_qty +
          item.debt_qty +
          item.writeoff_qty +
          item.adjustment_out_qty -
          item.return_qty -
          item.adjustment_in_qty,
      }))
      .sort((a, b) =>
        (a.location.company?.name || a.location.name).localeCompare(b.location.company?.name || b.location.name),
      )
  }, [balancesByLocation, data?.movements, pointLocations])

  const showOverview = inventoryView === 'overview'
  const showCatalog = inventoryView === 'catalog'
  const showReceipts = inventoryView === 'receipts'
  const showRequests = inventoryView === 'requests'
  const showAnalytics = inventoryView === 'analytics'
  const showWriteoffs = inventoryView === 'writeoffs'
  const showStocktakes = inventoryView === 'stocktakes'
  const showMovements = inventoryView === 'movements'
  const viewMeta = inventoryViewMeta[inventoryView]

  function loadStocktakeLinesFromBalances() {
    if (!selectedStocktakeBalances.length) {
      setStocktakeLines([])
      return
    }

    setStocktakeLines(
      selectedStocktakeBalances
        .filter((item) => Number(item.quantity || 0) > 0)
        .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
        .map((item) => ({
          item_id: item.item_id,
          actual_qty: formatQty(Number(item.quantity || 0)),
          comment: '',
        })),
    )
  }

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
          item_type: itemType,
        },
      })
      setItemName('')
      setItemBarcode('')
      setItemCategoryId('')
      setItemSalePrice('')
      setItemPurchasePrice('')
      setItemUnit('шт')
      setItemNotes('')
      setItemType('product')
      setSuccess('Товар создан')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать товар')
    } finally {
      setSaving(false)
    }
  }

  function startEditCategory(category: InventoryCategory) {
    setEditingCategory(category)
    setCategoryName(category.name)
    setCategoryDescription(category.description || '')
  }

  function cancelEditCategory() {
    setEditingCategory(null)
    setCategoryName('')
    setCategoryDescription('')
  }

  async function handleUpdateCategory() {
    if (!editingCategory) return
    if (!categoryName.trim()) return setError('Введите название категории')
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({ action: 'updateCategory', id: editingCategory.id, payload: { name: categoryName.trim(), description: categoryDescription.trim() || null } })
      cancelEditCategory()
      setSuccess('Категория обновлена')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось обновить категорию')
    } finally {
      setSaving(false)
    }
  }

  function startEditSupplier(supplier: InventorySupplier) {
    setEditingSupplier(supplier)
    setSupplierName(supplier.name)
    setSupplierContact(supplier.contact_name || '')
    setSupplierPhone(supplier.phone || '')
    setSupplierNotes(supplier.notes || '')
  }

  function cancelEditSupplier() {
    setEditingSupplier(null)
    setSupplierName('')
    setSupplierContact('')
    setSupplierPhone('')
    setSupplierNotes('')
  }

  async function handleUpdateSupplier() {
    if (!editingSupplier) return
    if (!supplierName.trim()) return setError('Введите название поставщика')
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'updateSupplier',
        id: editingSupplier.id,
        payload: { name: supplierName.trim(), contact_name: supplierContact.trim() || null, phone: supplierPhone.trim() || null, notes: supplierNotes.trim() || null },
      })
      cancelEditSupplier()
      setSuccess('Поставщик обновлён')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось обновить поставщика')
    } finally {
      setSaving(false)
    }
  }

  function startEditItem(item: InventoryItem) {
    setEditingItem(item)
    setItemName(item.name)
    setItemBarcode(item.barcode)
    setItemCategoryId(item.category_id || '')
    setItemSalePrice(String(item.sale_price || ''))
    setItemPurchasePrice(String(item.default_purchase_price || ''))
    setItemUnit(item.unit || 'шт')
    setItemNotes(item.notes || '')
    setItemType((item.item_type as 'product' | 'consumable') || 'product')
  }

  function cancelEditItem() {
    setEditingItem(null)
    setItemName('')
    setItemBarcode('')
    setItemCategoryId('')
    setItemSalePrice('')
    setItemPurchasePrice('')
    setItemUnit('шт')
    setItemNotes('')
    setItemType('product')
  }

  async function handleUpdateItem() {
    if (!editingItem) return
    if (!itemName.trim()) return setError('Введите название товара')
    if (!itemBarcode.trim()) return setError('Введите штрихкод')
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'updateItem',
        id: editingItem.id,
        payload: {
          name: itemName.trim(),
          barcode: itemBarcode.trim(),
          category_id: itemCategoryId || null,
          sale_price: parseMoney(itemSalePrice),
          default_purchase_price: parseMoney(itemPurchasePrice),
          unit: itemUnit.trim() || 'шт',
          notes: itemNotes.trim() || null,
          item_type: editingItem?.item_type || 'product',
        },
      })
      cancelEditItem()
      setSuccess('Товар обновлён')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось обновить товар')
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

  async function handleCreateWriteoff() {
    if (!writeoffLocationId) return setError('Выберите локацию для списания')
    if (!writeoffReason.trim()) return setError('Укажите причину списания')

    const items = writeoffLines
      .map((line) => ({
        item_id: line.item_id,
        quantity: parseMoney(line.quantity),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.quantity > 0)

    if (items.length === 0) return setError('Добавьте хотя бы одну позицию в списание')

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'createWriteoff',
        payload: {
          location_id: writeoffLocationId,
          written_at: writeoffDate,
          reason: writeoffReason.trim(),
          comment: writeoffComment.trim() || null,
          items,
        },
      })
      setWriteoffReason('')
      setWriteoffComment('')
      setWriteoffLines([emptyWriteoffLine()])
      setSuccess('Списание проведено, остатки обновлены')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось провести списание')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateStocktake() {
    if (!stocktakeLocationId) return setError('Выберите локацию для ревизии')

    const items = stocktakeLines
      .map((line) => ({
        item_id: line.item_id,
        actual_qty: parseMoney(line.actual_qty),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.actual_qty >= 0)

    if (items.length === 0) return setError('Загрузите или добавьте строки ревизии')

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      await mutate({
        action: 'createStocktake',
        payload: {
          location_id: stocktakeLocationId,
          counted_at: stocktakeDate,
          comment: stocktakeComment.trim() || null,
          items,
        },
      })
      setStocktakeComment('')
      setStocktakeLines([])
      setSuccess('Ревизия проведена, расхождения записаны в движения')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось провести ревизию')
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
    <div className={inventoryView === 'overview' ? 'app-page max-w-[1680px] space-y-6' : 'app-page max-w-[1180px] space-y-6'}>
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">{viewMeta.title}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{viewMeta.description}</p>
        </div>
        <Button type="button" variant="outline" className="gap-2" onClick={() => void loadData()} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Обновить
        </Button>
      </div>

      {error ? <Card className="border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card> : null}
      {success ? <Card className="border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-200">{success}</Card> : null}

      {showOverview ? (
        <>
          {data?.companies?.length ? (
            <ShowcaseTogglesCard
              companies={data.companies}
              locations={data?.locations || []}
              loadData={loadData}
              setSuccess={setSuccess}
              setError={setError}
            />
          ) : null}
          <InventoryOverviewCenter
            itemsCount={data?.items.length || 0}
            pendingRequests={pendingRequests}
            recentReceipts={recentReceipts}
            recentMovements={recentMovements}
            groupedPointBalances={groupedPointBalances}
            lowWarehouseBalances={lowWarehouseBalances}
            pointStockQty={pointStockQty}
            warehouseStockQty={warehouseStockQty}
            stocktakesCount={data?.stocktakes.length || 0}
          />
        </>
      ) : null}

      <div className={inventoryView === 'overview' ? 'grid gap-6 xl:grid-cols-[1.1fr_0.9fr]' : 'grid gap-6 xl:grid-cols-1'}>
        <div className="space-y-6">
          <Card className={`border-border/70 p-5 ${showReceipts ? '' : 'hidden'}`}>
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
                    <ItemCombobox
                      items={data?.items || []}
                      value={line.item_id}
                      onChange={(value) => setReceiptLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, item_id: value } : item))}
                    />
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

          <Card className={`border-border/70 p-5 ${showWriteoffs ? '' : 'hidden'}`}>
            <SectionTitle icon={ArchiveX} title="Списание" subtitle="Брак, служебное потребление, потери и любые непригодные остатки по складу или витрине." />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Локация">
                <Select value={writeoffLocationId} onValueChange={setWriteoffLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите локацию" /></SelectTrigger>
                  <SelectContent>
                    {activeLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.location_type === 'warehouse' ? 'Склад' : 'Витрина'} · {location.company?.name || location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Дата списания">
                <Input type="date" value={writeoffDate} onChange={(event) => setWriteoffDate(event.target.value)} />
              </Field>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Field label="Причина">
                <Input value={writeoffReason} onChange={(event) => setWriteoffReason(event.target.value)} placeholder="Брак, просрочка, служебное использование..." />
              </Field>
              <Field label="Комментарий">
                <Textarea value={writeoffComment} onChange={(event) => setWriteoffComment(event.target.value)} placeholder="Подробности по документу" />
              </Field>
            </div>

            <div className="mt-3 rounded-2xl border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
              Доступно в локации: <span className="font-medium text-foreground">{selectedWriteoffLocation?.company?.name || selectedWriteoffLocation?.name || '—'}</span>
              {' · '}
              {selectedWriteoffBalances.filter((item) => Number(item.quantity || 0) > 0).length} товарных позиций
            </div>

            <div className="mt-5 space-y-3">
              {writeoffLines.map((line, index) => (
                <LineCard key={`writeoff-${index}`}>
                  <Field label={index === 0 ? 'Товар' : undefined}>
                    <Select
                      value={line.item_id || `__empty__writeoff_${index}`}
                      onValueChange={(value) =>
                        setWriteoffLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__empty__writeoff_${index}`}>Выберите товар</SelectItem>
                        {selectedWriteoffBalances
                          .filter((item) => Number(item.quantity || 0) > 0)
                          .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
                          .map((item) => (
                            <SelectItem key={item.item_id} value={item.item_id}>
                              {item.item?.name || 'Товар'} · {formatQty(item.quantity)}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={index === 0 ? 'Списать' : undefined}>
                    <Input value={line.quantity} onChange={(event) => setWriteoffLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="0" />
                  </Field>
                  <Field label={index === 0 ? 'Комментарий' : undefined} className="md:col-span-2">
                    <Input value={line.comment} onChange={(event) => setWriteoffLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Например, брак или служебный расход" />
                  </Field>
                  <div className="flex items-end">
                    <Button type="button" variant="outline" className="w-full" onClick={() => setWriteoffLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>
                      Убрать
                    </Button>
                  </div>
                </LineCard>
              ))}
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" onClick={() => setWriteoffLines((current) => [...current, emptyWriteoffLine()])}>Добавить строку</Button>
              <div className="text-sm text-muted-foreground">
                Сумма списания: <span className="font-semibold text-foreground">{formatMoney(writeoffTotal)}</span>
              </div>
            </div>

            <div className="mt-4">
              <Button type="button" className="gap-2" onClick={handleCreateWriteoff} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveX className="h-4 w-4" />}
                Провести списание
              </Button>
            </div>
          </Card>

          <Card className={`border-border/70 p-5 ${showStocktakes ? '' : 'hidden'}`}>
            <SectionTitle icon={ScanSearch} title="Ревизия" subtitle="Проверка склада или витрины с фиксацией факта и автоматической корректировкой расхождений." />
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Локация">
                <Select value={stocktakeLocationId} onValueChange={setStocktakeLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите локацию" /></SelectTrigger>
                  <SelectContent>
                    {activeLocations.map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.location_type === 'warehouse' ? 'Склад' : 'Витрина'} · {location.company?.name || location.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Дата ревизии">
                <Input type="date" value={stocktakeDate} onChange={(event) => setStocktakeDate(event.target.value)} />
              </Field>
            </div>

            <Field label="Комментарий" className="mt-4">
              <Textarea value={stocktakeComment} onChange={(event) => setStocktakeComment(event.target.value)} placeholder="Например, вечерняя ревизия витрины" />
            </Field>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" variant="outline" onClick={loadStocktakeLinesFromBalances}>
                Загрузить текущие остатки
              </Button>
              <Button type="button" variant="outline" onClick={() => setStocktakeLines((current) => [...current, emptyStocktakeLine()])}>
                Добавить строку вручную
              </Button>
            </div>

            <div className="mt-5 space-y-3">
              {stocktakeLines.map((line, index) => {
                const expected = selectedStocktakeBalances.find((item) => item.item_id === line.item_id)?.quantity || 0
                return (
                  <LineCard key={`stocktake-${index}`}>
                    <Field label={index === 0 ? 'Товар' : undefined}>
                      <Select
                        value={line.item_id || `__empty__stocktake_${index}`}
                        onValueChange={(value) =>
                          setStocktakeLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                            ),
                          )
                        }
                      >
                        <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={`__empty__stocktake_${index}`}>Выберите товар</SelectItem>
                          {(data?.items || []).map((item) => (
                            <SelectItem key={item.id} value={item.id}>{item.name} · {item.barcode}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <div className="rounded-xl border border-border/60 px-3 py-2 text-sm">
                      <div className="text-xs text-muted-foreground">По системе</div>
                      <div className="font-semibold">{formatQty(expected)}</div>
                    </div>
                    <Field label={index === 0 ? 'По факту' : undefined}>
                      <Input value={line.actual_qty} onChange={(event) => setStocktakeLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, actual_qty: event.target.value } : item))} placeholder="0" />
                    </Field>
                    <Field label={index === 0 ? 'Комментарий' : undefined} className="md:col-span-2">
                      <Input value={line.comment} onChange={(event) => setStocktakeLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Например, нашли лишнюю банку или недостачу" />
                    </Field>
                    <div className="flex items-end">
                      <Button type="button" variant="outline" className="w-full" onClick={() => setStocktakeLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        Убрать
                      </Button>
                    </div>
                  </LineCard>
                )
              })}
            </div>

            {!stocktakeLines.length ? (
              <div className="mt-4 rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                Сначала загрузите текущие остатки локации или добавьте строки вручную.
              </div>
            ) : null}

            <div className="mt-4">
              <Button type="button" className="gap-2" onClick={handleCreateStocktake} disabled={saving}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                Провести ревизию
              </Button>
            </div>
          </Card>

          <Card className={`border-border/70 p-5 ${showRequests ? '' : 'hidden'}`}>
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
                    <ItemCombobox
                      items={data?.items || []}
                      value={line.item_id}
                      onChange={(value) => setRequestLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, item_id: value } : item))}
                    />
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
          <Card className={`border-border/70 p-5 ${showRequests ? '' : 'hidden'}`}>
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

          <Card className={`border-border/70 p-5 ${showAnalytics ? '' : 'hidden'}`}>
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

          <Card className={`border-border/70 p-5 ${showAnalytics ? '' : 'hidden'}`}>
            <SectionTitle
              icon={History}
              title="Глубокая аналитика по точкам"
              subtitle="Сводка по витринам на основе журнала последних 300 движений: поступления, продажи, долги, возвраты, списания и ручные корректировки."
            />
            <div className="space-y-3">
              {pointMovementAnalytics.map((point) => (
                <div key={point.location.id} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-base font-semibold">{point.location.company?.name || point.location.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Текущий остаток: {formatQty(point.stock_qty)} шт. · {point.stock_items} активных позиций
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Последнее движение: {point.last_movement_at ? formatDate(point.last_movement_at) : '—'}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-blue-500/20 bg-blue-500/10 px-4 py-3 text-right">
                      <div className="text-xs uppercase tracking-[0.18em] text-blue-200">Чистый расход витрины</div>
                      <div className="mt-1 text-2xl font-bold text-foreground">{formatQty(point.net_issue_qty)}</div>
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                    <PointMetricCard label="Поступило на витрину" qty={point.incoming_qty} amount={point.incoming_amount} tone="emerald" />
                    <PointMetricCard label="Продано" qty={point.sale_qty} amount={point.sale_amount} tone="cyan" />
                    <PointMetricCard label="Выдано в долг" qty={point.debt_qty} amount={point.debt_amount} tone="amber" />
                    <PointMetricCard label="Возвращено" qty={point.return_qty} amount={point.return_amount} tone="violet" />
                    <PointMetricCard label="Списано" qty={point.writeoff_qty} amount={point.writeoff_amount} tone="red" />
                    <PointMetricCard label="Корректировка +" qty={point.adjustment_in_qty} tone="orange" />
                    <PointMetricCard label="Корректировка -" qty={point.adjustment_out_qty} tone="orange" />
                    <PointMetricCard label="Остаток сейчас" qty={point.stock_qty} tone="slate" />
                  </div>
                </div>
              ))}
              {!pointMovementAnalytics.length ? (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  Пока нет движений по витринам точек. Они появятся после заявок, продаж, долгов, возвратов и списаний.
                </div>
              ) : null}
            </div>
          </Card>

          <Card className={`border-border/70 p-5 ${showCatalog ? '' : 'hidden'}`}>
            <SectionTitle icon={Tag} title="Категории товара" subtitle="Категории создаются на сайте и потом используются в общем каталоге." />
            <div className="space-y-3">
              <Field label="Название категории">
                <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Напитки, снеки, кухня..." />
              </Field>
              <Field label="Описание">
                <Textarea value={categoryDescription} onChange={(event) => setCategoryDescription(event.target.value)} placeholder="Необязательно" />
              </Field>
              <div className="flex gap-2">
                {editingCategory ? (
                  <>
                    <Button type="button" onClick={handleUpdateCategory} disabled={saving}>Сохранить</Button>
                    <Button type="button" variant="outline" onClick={cancelEditCategory} disabled={saving}><X className="h-4 w-4" /></Button>
                  </>
                ) : (
                  <Button type="button" onClick={handleCreateCategory} disabled={saving}>Создать категорию</Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {(data?.categories || []).map((category) => (
                  <span key={category.id} className={`flex items-center gap-1 rounded-full border px-3 py-1 text-xs ${editingCategory?.id === category.id ? 'border-blue-500/50 bg-blue-500/10' : 'border-border/70'}`}>
                    {category.name}
                    <button type="button" onClick={() => startEditCategory(category)} className="ml-1 opacity-50 hover:opacity-100">
                      <Pencil className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </Card>

          <Card className={`border-border/70 p-5 ${showCatalog ? '' : 'hidden'}`}>
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
              <div className="flex gap-2">
                {editingSupplier ? (
                  <>
                    <Button type="button" onClick={handleUpdateSupplier} disabled={saving}>Сохранить</Button>
                    <Button type="button" variant="outline" onClick={cancelEditSupplier} disabled={saving}><X className="h-4 w-4" /></Button>
                  </>
                ) : (
                  <Button type="button" onClick={handleCreateSupplier} disabled={saving}>Добавить поставщика</Button>
                )}
              </div>
              {(data?.suppliers || []).length > 0 && (
                <div className="mt-1 space-y-2">
                  {(data?.suppliers || []).map((supplier) => (
                    <div key={supplier.id} className={`flex items-center justify-between rounded-xl border px-3 py-2 text-sm ${editingSupplier?.id === supplier.id ? 'border-blue-500/50 bg-blue-500/10' : 'border-border/70'}`}>
                      <div>
                        <div className="font-medium">{supplier.name}</div>
                        {supplier.contact_name || supplier.phone ? (
                          <div className="text-xs text-muted-foreground">{[supplier.contact_name, supplier.phone].filter(Boolean).join(' · ')}</div>
                        ) : null}
                      </div>
                      <button type="button" onClick={() => startEditSupplier(supplier)} className="ml-3 opacity-50 hover:opacity-100">
                        <Pencil className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className={`border-border/70 p-5 ${showCatalog ? '' : 'hidden'}`}>
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
              <Field label="Тип">
                <Select value={itemType} onValueChange={(v) => setItemType(v as 'product' | 'consumable')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product">Товар (для продажи)</SelectItem>
                    <SelectItem value="consumable">Расходник (внутреннее использование)</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Единица">
                <Input value={itemUnit} onChange={(event) => setItemUnit(event.target.value)} placeholder="шт" />
              </Field>
              <Field label="Комментарий">
                <Textarea value={itemNotes} onChange={(event) => setItemNotes(event.target.value)} placeholder="Необязательно" />
              </Field>
              <div className="flex gap-2">
                {editingItem ? (
                  <>
                    <Button type="button" onClick={handleUpdateItem} disabled={saving}>Сохранить изменения</Button>
                    <Button type="button" variant="outline" onClick={cancelEditItem} disabled={saving}><X className="h-4 w-4" /></Button>
                  </>
                ) : (
                  <Button type="button" onClick={handleCreateItem} disabled={saving}>Создать товар</Button>
                )}
              </div>
              {(data?.items || []).length > 0 && (
                <div className="mt-2 space-y-1 border-t border-border/50 pt-3">
                  <div className="mb-2 text-xs text-muted-foreground">Каталог товаров ({data?.items.length})</div>
                  {(data?.items || []).map((item) => (
                    <div key={item.id} className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${editingItem?.id === item.id ? 'border-blue-500/50 bg-blue-500/10' : 'border-border/50 hover:border-border'}`}>
                      <div className="min-w-0 flex-1">
                        <span className="font-medium">{item.name}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{item.barcode}</span>
                        {item.category?.name ? <span className="ml-2 text-xs text-muted-foreground">· {item.category.name}</span> : null}
                      </div>
                      <div className="ml-3 flex items-center gap-3 shrink-0">
                        <span className="text-xs text-muted-foreground">{formatMoney(item.sale_price)}</span>
                        <button type="button" onClick={() => startEditItem(item)} className="opacity-50 hover:opacity-100">
                          <Pencil className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className={`border-border/70 p-5 ${showReceipts ? '' : 'hidden'}`}>
          <SectionTitle icon={PackagePlus} title="Последние приемки" subtitle="Журнал последних складских приходов." />
          <div className="space-y-3">
            {(data?.receipts || []).slice(0, receiptsPage).map((receipt) => (
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
            {(data?.receipts || []).length > receiptsPage && (
              <Button type="button" variant="outline" className="w-full" onClick={() => setReceiptsPage((p) => p + 5)}>
                Показать ещё ({(data?.receipts || []).length - receiptsPage} осталось)
              </Button>
            )}
          </div>
        </Card>

        <Card className={`border-border/70 p-5 ${showRequests ? '' : 'hidden'}`}>
          <SectionTitle icon={ClipboardList} title="Последние заявки" subtitle="История заявок точек, включая уже одобренные и отклонённые." />
          <div className="space-y-3">
            {(data?.requests || []).slice(0, requestsPage).map((request) => (
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
            {(data?.requests || []).length > requestsPage && (
              <Button type="button" variant="outline" className="w-full" onClick={() => setRequestsPage((p) => p + 5)}>
                Показать ещё ({(data?.requests || []).length - requestsPage} осталось)
              </Button>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card className={`border-border/70 p-5 ${showWriteoffs ? '' : 'hidden'}`}>
          <SectionTitle icon={ArchiveX} title="Списание" subtitle="Брак, служебное потребление, потери и любые непригодные остатки по складу или витрине." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Локация">
              <Select value={writeoffLocationId} onValueChange={setWriteoffLocationId}>
                <SelectTrigger><SelectValue placeholder="Выберите локацию" /></SelectTrigger>
                <SelectContent>
                  {activeLocations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.location_type === 'warehouse' ? 'Склад' : 'Витрина'} · {location.company?.name || location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Дата списания">
              <Input type="date" value={writeoffDate} onChange={(event) => setWriteoffDate(event.target.value)} />
            </Field>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Field label="Причина">
              <Input value={writeoffReason} onChange={(event) => setWriteoffReason(event.target.value)} placeholder="Брак, просрочка, служебное использование..." />
            </Field>
            <Field label="Комментарий">
              <Textarea value={writeoffComment} onChange={(event) => setWriteoffComment(event.target.value)} placeholder="Подробности по документу" />
            </Field>
          </div>

          <div className="mt-3 rounded-2xl border border-border/70 bg-background/40 p-3 text-sm text-muted-foreground">
            Доступно в локации: <span className="font-medium text-foreground">{selectedWriteoffLocation?.company?.name || selectedWriteoffLocation?.name || '—'}</span>
            {' · '}
            {selectedWriteoffBalances.filter((item) => Number(item.quantity || 0) > 0).length} товарных позиций
          </div>

          <div className="mt-5 space-y-3">
            {writeoffLines.map((line, index) => (
              <LineCard key={`writeoff-${index}`}>
                <Field label={index === 0 ? 'Товар' : undefined}>
                  <Select
                    value={line.item_id || `__empty__writeoff_${index}`}
                    onValueChange={(value) =>
                      setWriteoffLines((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                        ),
                      )
                    }
                  >
                    <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={`__empty__writeoff_${index}`}>Выберите товар</SelectItem>
                      {selectedWriteoffBalances
                        .filter((item) => Number(item.quantity || 0) > 0)
                        .sort((a, b) => (a.item?.name || '').localeCompare(b.item?.name || ''))
                        .map((item) => (
                          <SelectItem key={item.item_id} value={item.item_id}>
                            {item.item?.name || 'Товар'} · {formatQty(item.quantity)}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label={index === 0 ? 'Списать' : undefined}>
                  <Input value={line.quantity} onChange={(event) => setWriteoffLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="0" />
                </Field>
                <Field label={index === 0 ? 'Комментарий' : undefined} className="md:col-span-2">
                  <Input value={line.comment} onChange={(event) => setWriteoffLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Например, брак или служебный расход" />
                </Field>
                <div className="flex items-end">
                  <Button type="button" variant="outline" className="w-full" onClick={() => setWriteoffLines((current) => current.length === 1 ? current : current.filter((_, itemIndex) => itemIndex !== index))}>
                    Убрать
                  </Button>
                </div>
              </LineCard>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button type="button" variant="outline" onClick={() => setWriteoffLines((current) => [...current, emptyWriteoffLine()])}>Добавить строку</Button>
            <div className="text-sm text-muted-foreground">
              Сумма списания: <span className="font-semibold text-foreground">{formatMoney(writeoffTotal)}</span>
            </div>
          </div>

          <div className="mt-4">
            <Button type="button" className="gap-2" onClick={handleCreateWriteoff} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArchiveX className="h-4 w-4" />}
              Провести списание
            </Button>
          </div>
        </Card>

        <Card className={`border-border/70 p-5 ${showStocktakes ? '' : 'hidden'}`}>
          <SectionTitle icon={ScanSearch} title="Ревизия" subtitle="Проверка склада или витрины с фиксацией факта и автоматической корректировкой расхождений." />
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Локация">
              <Select value={stocktakeLocationId} onValueChange={setStocktakeLocationId}>
                <SelectTrigger><SelectValue placeholder="Выберите локацию" /></SelectTrigger>
                <SelectContent>
                  {activeLocations.map((location) => (
                    <SelectItem key={location.id} value={location.id}>
                      {location.location_type === 'warehouse' ? 'Склад' : 'Витрина'} · {location.company?.name || location.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Дата ревизии">
              <Input type="date" value={stocktakeDate} onChange={(event) => setStocktakeDate(event.target.value)} />
            </Field>
          </div>

          <Field label="Комментарий" className="mt-4">
            <Textarea value={stocktakeComment} onChange={(event) => setStocktakeComment(event.target.value)} placeholder="Например, вечерняя ревизия витрины" />
          </Field>

          <div className="mt-4 flex flex-wrap gap-3">
            <Button type="button" variant="outline" onClick={loadStocktakeLinesFromBalances}>
              Загрузить текущие остатки
            </Button>
            <Button type="button" variant="outline" onClick={() => setStocktakeLines((current) => [...current, emptyStocktakeLine()])}>
              Добавить строку вручную
            </Button>
          </div>

          <div className="mt-5 space-y-3">
            {stocktakeLines.map((line, index) => {
              const expected = selectedStocktakeBalances.find((item) => item.item_id === line.item_id)?.quantity || 0
              return (
                <LineCard key={`stocktake-${index}`}>
                  <Field label={index === 0 ? 'Товар' : undefined}>
                    <Select
                      value={line.item_id || `__empty__stocktake_${index}`}
                      onValueChange={(value) =>
                        setStocktakeLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, item_id: value.startsWith('__empty__') ? '' : value } : item,
                          ),
                        )
                      }
                    >
                      <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__empty__stocktake_${index}`}>Выберите товар</SelectItem>
                        {(data?.items || []).map((item) => (
                          <SelectItem key={item.id} value={item.id}>{item.name} · {item.barcode}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="rounded-xl border border-border/60 px-3 py-2 text-sm">
                    <div className="text-xs text-muted-foreground">По системе</div>
                    <div className="font-semibold">{formatQty(expected)}</div>
                  </div>
                  <Field label={index === 0 ? 'По факту' : undefined}>
                    <Input value={line.actual_qty} onChange={(event) => setStocktakeLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, actual_qty: event.target.value } : item))} placeholder="0" />
                  </Field>
                  <Field label={index === 0 ? 'Комментарий' : undefined} className="md:col-span-2">
                    <Input value={line.comment} onChange={(event) => setStocktakeLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, comment: event.target.value } : item))} placeholder="Например, нашли лишнюю банку или недостачу" />
                  </Field>
                  <div className="flex items-end">
                    <Button type="button" variant="outline" className="w-full" onClick={() => setStocktakeLines((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                      Убрать
                    </Button>
                  </div>
                </LineCard>
              )
            })}
          </div>

          {!stocktakeLines.length ? (
            <div className="mt-4 rounded-2xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
              Сначала загрузите текущие остатки локации или добавьте строки вручную.
            </div>
          ) : null}

          <div className="mt-4">
            <Button type="button" className="gap-2" onClick={handleCreateStocktake} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
              Провести ревизию
            </Button>
          </div>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className={`border-border/70 p-5 ${showMovements ? '' : 'hidden'}`}>
          <SectionTitle icon={ArchiveX} title="Последние списания" subtitle="Что и откуда списали в последних документах." />
          <div className="space-y-3">
            {(data?.writeoffs || []).slice(0, writeoffsPage).map((writeoff) => (
              <div key={writeoff.id} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{writeoff.location?.company?.name || writeoff.location?.name || 'Локация'} · {formatDate(writeoff.written_at)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{writeoff.reason}</div>
                    {writeoff.comment ? <div className="mt-1 text-xs text-muted-foreground">{writeoff.comment}</div> : null}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold">{formatMoney(writeoff.total_amount || 0)}</div>
                    <div className="text-xs text-muted-foreground">{writeoff.items?.length || 0} строк</div>
                  </div>
                </div>
              </div>
            ))}
            {!data?.writeoffs?.length ? <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">Пока нет списаний.</div> : null}
            {(data?.writeoffs || []).length > writeoffsPage && (
              <Button type="button" variant="outline" className="w-full" onClick={() => setWriteoffsPage((p) => p + 5)}>
                Показать ещё ({(data?.writeoffs || []).length - writeoffsPage} осталось)
              </Button>
            )}
          </div>
        </Card>

        <Card className={`border-border/70 p-5 ${showStocktakes ? '' : 'hidden'}`}>
          <SectionTitle icon={ScanSearch} title="Последние ревизии" subtitle="Акты проверки и количество строк с расхождениями." />
          <div className="space-y-3">
            {(data?.stocktakes || []).slice(0, stocktakesPage).map((stocktake) => {
              const changedCount = (stocktake.items || []).filter((item) => Number(item.delta_qty || 0) !== 0).length
              return (
                <div key={stocktake.id} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{stocktake.location?.company?.name || stocktake.location?.name || 'Локация'} · {formatDate(stocktake.counted_at)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {stocktake.items?.length || 0} строк · {changedCount} корректировок
                      </div>
                      {stocktake.comment ? <div className="mt-1 text-xs text-muted-foreground">{stocktake.comment}</div> : null}
                    </div>
                  </div>
                </div>
              )
            })}
            {!data?.stocktakes?.length ? <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">Пока нет ревизий.</div> : null}
            {(data?.stocktakes || []).length > stocktakesPage && (
              <Button type="button" variant="outline" className="w-full" onClick={() => setStocktakesPage((p) => p + 5)}>
                Показать ещё ({(data?.stocktakes || []).length - stocktakesPage} осталось)
              </Button>
            )}
          </div>
        </Card>

        <Card className={`border-border/70 p-5 ${showMovements ? '' : 'hidden'}`}>
          <SectionTitle icon={History} title="Журнал движений" subtitle="Последние операции по складу, витринам и корректировкам." />
          <div className="space-y-3">
            {(data?.movements || []).slice(0, movementsPage).map((movement) => (
              <div key={movement.id} className="rounded-2xl border border-border/70 bg-background/40 p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${movementTypeClass(movement.movement_type)}`}>
                        {movementTypeLabel(movement.movement_type)}
                      </span>
                      <span className="text-xs text-muted-foreground">{formatDate(movement.created_at)}</span>
                    </div>
                    <div className="mt-2 text-sm font-semibold">{movement.item?.name || 'Товар'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {(movement.from_location?.company?.name || movement.from_location?.name || '—')}
                      {' → '}
                      {(movement.to_location?.company?.name || movement.to_location?.name || '—')}
                    </div>
                    {movement.comment ? <div className="mt-1 text-xs text-muted-foreground">{movement.comment}</div> : null}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatQty(movement.quantity)}</div>
                    <div className="text-xs text-muted-foreground">{movement.total_amount ? formatMoney(movement.total_amount) : movement.reference_type}</div>
                  </div>
                </div>
              </div>
            ))}
            {!data?.movements?.length ? <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">Пока нет движений.</div> : null}
            {(data?.movements || []).length > movementsPage && (
              <Button type="button" variant="outline" className="w-full" onClick={() => setMovementsPage((p) => p + 20)}>
                Показать ещё ({(data?.movements || []).length - movementsPage} осталось)
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function ShowcaseTogglesCard({
  companies,
  locations,
  loadData,
  setSuccess,
  setError,
}: {
  companies: Array<{ id: string; name: string; code: string | null }>
  locations: InventoryLocation[]
  loadData: () => Promise<void>
  setSuccess: (msg: string | null) => void
  setError: (msg: string | null) => void
}) {
  const [busyId, setBusyId] = useState<string | null>(null)

  const pointByCompany = useMemo(() => {
    const m = new Map<string, InventoryLocation>()
    for (const loc of locations) {
      if (loc.location_type === 'point_display' && loc.company_id) {
        m.set(loc.company_id, loc)
      }
    }
    return m
  }, [locations])

  async function applyShowcase(companyId: string, enabled: boolean) {
    setBusyId(companyId)
    setError(null)
    try {
      const res = await fetch('/api/admin/inventory/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_id: companyId, enabled }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Не удалось сохранить')
      await loadData()
      setSuccess(enabled ? 'Витрина для точки включена' : 'Витрина для точки отключена')
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения витрины')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Card className="border-border/70 p-5">
      <SectionTitle
        icon={Store}
        title="Витрина по точкам"
        subtitle="Центральный склад один на организацию. Витрину включайте только там, где касса продаёт со склада точки; иначе POS и терминал не будут показывать эту локацию."
      />
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {companies.map((c) => {
          const loc = pointByCompany.get(c.id)
          const on = Boolean(loc?.is_active)
          return (
            <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{c.name}</div>
                <div className="text-xs text-muted-foreground">
                  {on ? 'Витрина активна' : loc ? 'Витрина выключена' : 'Витрина не создана — включите переключатель'}
                </div>
              </div>
              <Switch
                checked={on}
                disabled={busyId === c.id}
                onCheckedChange={(v) => void applyShowcase(c.id, v)}
              />
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function InventoryOverviewCenter({
  itemsCount,
  pendingRequests,
  recentReceipts,
  recentMovements,
  groupedPointBalances,
  lowWarehouseBalances,
  pointStockQty,
  warehouseStockQty,
  stocktakesCount,
}: {
  itemsCount: number
  pendingRequests: InventoryRequest[]
  recentReceipts: InventoryReceipt[]
  recentMovements: InventoryMovement[]
  groupedPointBalances: Array<{ location: InventoryLocation; quantity: number; itemsCount: number }>
  lowWarehouseBalances: InventoryBalance[]
  pointStockQty: number
  warehouseStockQty: number
  stocktakesCount: number
}) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={ClipboardList} label="Новых заявок" value={String(pendingRequests.length)} note="Ждут решения руководителя" />
        <SummaryCard icon={Boxes} label="Товаров в каталоге" value={String(itemsCount)} note="Весь магазинный каталог" />
        <SummaryCard icon={Store} label="Товар на витринах" value={formatQty(pointStockQty)} note="Суммарный остаток по точкам" />
        <SummaryCard icon={PackagePlus} label="Товар на складе" value={formatQty(warehouseStockQty)} note="Суммарный остаток центрального склада" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className="border-border/70 p-5">
          <SectionTitle icon={ClipboardCheck} title="Центр магазина" subtitle="Главные действия по магазину: заявки, приемка, остатки и ревизия." />

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <QuickLinkCard href="/store/requests" icon={ClipboardCheck} title="Заявки" note={`${pendingRequests.length} новых`} />
            <QuickLinkCard href="/store/receipts" icon={PackagePlus} title="Приемка" note={`${recentReceipts.length} последних документов`} />
            <QuickLinkCard href="/store/analytics" icon={Boxes} title="Остатки точек" note={`${groupedPointBalances.length} витрин`} />
            <QuickLinkCard href="/store/revisions" icon={ScanSearch} title="Ревизия" note={`${stocktakesCount} последних проверок`} />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Новые заявки точек</div>
                  <div className="text-xs text-muted-foreground">То, что требует решения прямо сейчас.</div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/store/requests">Все заявки</Link>
                </Button>
              </div>
              <div className="space-y-3">
                {pendingRequests.slice(0, 5).map((request) => (
                  <div key={request.id} className="rounded-xl border border-border/60 px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium">{request.company?.name || request.target_location?.name || 'Точка'}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {request.source_location?.name || 'Склад'} → {request.target_location?.name || 'Витрина'}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{request.items?.length || 0} позиций · {formatDate(request.created_at)}</div>
                      </div>
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${requestStatusClass(request.status)}`}>
                        {requestStatusLabel(request.status)}
                      </span>
                    </div>
                  </div>
                ))}
                {!pendingRequests.length ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    Сейчас нет новых заявок на одобрение.
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-border/70 bg-background/40 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold">Витрины точек</div>
                  <div className="text-xs text-muted-foreground">Текущий остаток и насыщенность витрин по точкам.</div>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/store/analytics">Открыть аналитику</Link>
                </Button>
              </div>
              <div className="space-y-3">
                {groupedPointBalances.slice(0, 6).map((item) => (
                  <div key={item.location.id} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-3">
                    <div>
                      <div className="text-sm font-medium">{item.location.company?.name || item.location.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{item.itemsCount} товарных позиций</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold">{formatQty(item.quantity)}</div>
                      <div className="text-xs text-muted-foreground">штук в витрине</div>
                    </div>
                  </div>
                ))}
                {!groupedPointBalances.length ? (
                  <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                    Пока нет остатков на витринах. Они появятся после одобренных заявок.
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </Card>

        <div className="space-y-6">
          <Card className="border-border/70 p-5">
            <SectionTitle icon={Boxes} title="Низкий остаток на складе" subtitle="Позиции, которые скоро закончатся на центральном складе." />
            <div className="space-y-3">
              {lowWarehouseBalances.map((balance) => (
                <div key={`${balance.location_id}:${balance.item_id}`} className="flex items-center justify-between rounded-xl border border-border/60 px-3 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{balance.item?.name || 'Товар'}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{balance.item?.barcode || 'Без штрихкода'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatQty(balance.quantity)}</div>
                    <div className="text-xs text-muted-foreground">осталось</div>
                  </div>
                </div>
              ))}
              {!lowWarehouseBalances.length ? (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  На складе пока нет остатков. Начни с приемки товара.
                </div>
              ) : null}
            </div>
          </Card>

          <Card className="border-border/70 p-5">
            <SectionTitle icon={History} title="Последние движения" subtitle="Короткая лента по складу и витринам без лишних форм." />
            <div className="space-y-3">
              {recentMovements.map((movement) => (
                <div key={movement.id} className="rounded-xl border border-border/60 px-3 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-medium ${movementTypeClass(movement.movement_type)}`}>
                      {movementTypeLabel(movement.movement_type)}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatDate(movement.created_at)}</span>
                  </div>
                  <div className="mt-2 text-sm font-medium">{movement.item?.name || 'Товар'}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {(movement.from_location?.company?.name || movement.from_location?.name || '—')} → {(movement.to_location?.company?.name || movement.to_location?.name || '—')}
                  </div>
                </div>
              ))}
              {!recentMovements.length ? (
                <div className="rounded-xl border border-dashed border-border/70 p-4 text-sm text-muted-foreground">
                  Пока нет движений по складу и витринам.
                </div>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function QuickLinkCard({
  href,
  icon: Icon,
  title,
  note,
}: {
  href: string
  icon: typeof Boxes
  title: string
  note: string
}) {
  return (
    <Link href={href} className="rounded-2xl border border-border/70 bg-background/40 p-4 transition hover:border-blue-500/40 hover:bg-blue-500/5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{note}</div>
        </div>
        <div className="rounded-xl border border-border/70 bg-background/60 p-2">
          <Icon className="h-4 w-4 text-blue-300" />
        </div>
      </div>
    </Link>
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

function PointMetricCard({
  label,
  qty,
  amount,
  tone,
}: {
  label: string
  qty: number
  amount?: number
  tone: 'emerald' | 'cyan' | 'amber' | 'violet' | 'red' | 'orange' | 'slate'
}) {
  const toneClass =
    tone === 'emerald'
      ? 'border-emerald-500/20 bg-emerald-500/10'
      : tone === 'cyan'
        ? 'border-cyan-500/20 bg-cyan-500/10'
        : tone === 'amber'
          ? 'border-amber-500/20 bg-amber-500/10'
          : tone === 'violet'
            ? 'border-violet-500/20 bg-violet-500/10'
            : tone === 'red'
              ? 'border-red-500/20 bg-red-500/10'
              : tone === 'orange'
                ? 'border-orange-500/20 bg-orange-500/10'
                : 'border-border/70 bg-background/60'

  return (
    <div className={`rounded-2xl border p-3 ${toneClass}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-2 text-xl font-semibold text-foreground">{formatQty(qty)} шт.</div>
      <div className="mt-1 text-xs text-muted-foreground">
        {typeof amount === 'number' ? formatMoney(amount) : 'Без денежной суммы'}
      </div>
    </div>
  )
}

export default function InventoryPage() {
  return <InventoryLegacyRedirect href="/store" />
}

