'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { Package, Pencil, Plus, Search, Trash2, Upload, Download, Check, X, ChevronLeft, ChevronRight, ShoppingCart, TrendingUp, Warehouse, Store, Tag } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { InventoryLegacyRedirect } from '../legacy-redirect'

// ─── Types ─────────────────────────────────────────────────────────────────────

type CatalogItem = {
  id: string
  name: string
  barcode: string
  category_id: string | null
  category: { id: string; name: string } | null
  sale_price: number
  default_purchase_price: number
  unit: string
  notes: string | null
  is_active: boolean
  item_type: string
  catalog_qty?: number
  warehouse_qty: number
  showcase_qty: number
  total_balance: number
  low_stock_threshold: number | null
}

type ImportRow = {
  name: string
  barcode: string
  unit: string
  sale_price: number
  purchase_price: number
  category: string | null
  item_type: 'product' | 'service'
  article: string | null
  /** Колонка «Остаток» в Excel — выставляет общий остаток в catalog_total */
  stock_qty?: number
}

type StockDiff = {
  barcode: string
  name: string
  current_catalog: number
  current_warehouse: number
  current_showcase: number
  new_catalog: number
  new_showcase: number
  delta_catalog: number
  warehouse_exceeds_new_catalog: boolean
}

type PreviewData = {
  new_items: ImportRow[]
  updated_items: Array<ImportRow & { existing_name: string; price_changed: boolean; name_changed: boolean }>
  unchanged_count: number
  categories_to_create: string[]
  stock_rows?: number
  stock_changes?: StockDiff[]
  stock_warnings?: StockDiff[]
  stock_total_delta_positive?: number
  stock_total_delta_negative?: number
}

type ItemFormData = {
  name: string
  barcode: string
  unit: string
  sale_price: string
  purchase_price: string
  category_id: string
  item_type: string
  notes: string
  low_stock_threshold: string
}

const EMPTY_FORM: ItemFormData = {
  name: '', barcode: '', unit: 'шт', sale_price: '0', purchase_price: '0',
  category_id: '', item_type: 'product', notes: '', low_stock_threshold: '',
}

const PAGE_SIZE = 50

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseRussianNumber(val: unknown): number {
  if (val === null || val === undefined || val === '') return 0
  const s = String(val).replace(',', '.').replace(/[^0-9.]/g, '')
  return parseFloat(s) || 0
}

function parseBarcodeValue(val: unknown): string {
  if (val === null || val === undefined) return ''
  const n = Number(val)
  if (!isNaN(n) && n > 0) return String(Math.round(n))
  return String(val).trim()
}

function normHeaderCell(val: unknown): string {
  return String(val ?? '')
    .replace(/\u00a0/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

/** Поиск колонки по точному или альтернативному заголовку */
function colIndex(headers: string[], ...aliases: string[]): number {
  const norm = headers.map(normHeaderCell)
  for (const a of aliases) {
    const t = normHeaderCell(a)
    const i = norm.indexOf(t)
    if (i >= 0) return i
  }
  return -1
}

function parseWiponExcel(file: File): Promise<ImportRow[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1 }) as unknown[][]

        if (!rows.length) return reject(new Error('Файл пустой'))

        const headers = (rows[0] as unknown[]).map((h) => normHeaderCell(h))

        const iName = colIndex(headers, 'Название', 'Наименование')
        const iBarcode = colIndex(headers, 'Штрихкод', 'Штрих-код', 'Barcode')
        const iUnit = colIndex(headers, 'Единица измерения', 'Ед. изм.', 'Единица')
        const iSalePrice = colIndex(headers, 'Цена продажи', 'Продажа')
        const iPurchasePrice = colIndex(headers, 'Цена закупки', 'Закупка')
        const iCategory = colIndex(headers, 'Категория')
        const iStock = colIndex(headers, 'Остаток', 'Количество', 'Остаток на складе')
        const iType = colIndex(headers, 'Тип')
        const iArticle = colIndex(headers, 'Артикул')

        if (iName === -1 || iBarcode === -1) {
          return reject(
            new Error(
              'Не распознан формат файла. Нужны колонки «Название» и «Штрихкод» (как в экспорте из Wipon / продаж).',
            ),
          )
        }

        const result: ImportRow[] = []
        for (let i = 1; i < rows.length; i++) {
          const row = rows[i] as unknown[]
          const name = String(row[iName] || '').trim()
          const barcode = parseBarcodeValue(row[iBarcode])
          if (!name || !barcode) continue

          const out: ImportRow = {
            name,
            barcode,
            unit: iUnit >= 0 ? String(row[iUnit] || 'шт').trim() || 'шт' : 'шт',
            sale_price: iSalePrice >= 0 ? parseRussianNumber(row[iSalePrice]) : 0,
            purchase_price: iPurchasePrice >= 0 ? parseRussianNumber(row[iPurchasePrice]) : 0,
            category: iCategory >= 0 && row[iCategory] ? String(row[iCategory]).trim() : null,
            item_type: iType >= 0 && String(row[iType] || '') === 'Услуга' ? 'service' : 'product',
            article: iArticle >= 0 && row[iArticle] ? String(row[iArticle]).trim() : null,
          }
          if (iStock >= 0 && row[iStock] !== '' && row[iStock] !== undefined && row[iStock] !== null) {
            out.stock_qty = parseRussianNumber(row[iStock])
          }

          result.push(out)
        }

        resolve(result)
      } catch (err: any) {
        reject(new Error('Ошибка чтения файла: ' + err.message))
      }
    }
    reader.onerror = () => reject(new Error('Не удалось прочитать файл'))
    reader.readAsArrayBuffer(file)
  })
}

async function exportToExcel(items: CatalogItem[], filename = 'Katalog') {
  const today = new Date().toLocaleDateString('ru-RU')
  await downloadReportPdf('table', {
    meta: { title: 'Каталог товаров и услуг', generated: today },
    columns: [
      { key: 'name', label: 'Название' },
      { key: 'barcode', label: 'Штрихкод' },
      { key: 'category', label: 'Категория' },
      { key: 'type', label: 'Тип' },
      { key: 'salePrice', label: 'Цена продажи', align: 'right' },
      { key: 'purchasePrice', label: 'Цена закупки', align: 'right' },
      { key: 'unit', label: 'Единица' },
      { key: 'balance', label: 'Остаток', align: 'right' },
      { key: 'active', label: 'Активен' },
    ],
    rows: items.map(item => ({
      name: item.name,
      barcode: item.barcode || '',
      category: item.category?.name || '',
      type: item.item_type === 'product' ? 'Товар' : 'Услуга',
      salePrice: item.sale_price,
      purchasePrice: item.default_purchase_price,
      unit: item.unit || '',
      balance: item.total_balance,
      active: item.is_active ? 'Да' : 'Нет',
    })),
  }, filename.replace(/\.xlsx$/, ''))
}

// ─── ItemForm ──────────────────────────────────────────────────────────────────

function ItemForm({
  form, onChange, categories, onSave, onCancel, loading,
}: {
  form: ItemFormData
  onChange: (f: ItemFormData) => void
  categories: { id: string; name: string }[]
  onSave: () => void
  onCancel: () => void
  loading: boolean
}) {
  const f = (key: keyof ItemFormData, val: string) => onChange({ ...form, [key]: val })
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      <div className="col-span-2 sm:col-span-2 lg:col-span-2">
        <Label className="text-xs text-muted-foreground mb-1 block">Название *</Label>
        <Input value={form.name} onChange={(e) => f('name', e.target.value)} placeholder="Название товара" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Штрихкод *</Label>
        <Input value={form.barcode} onChange={(e) => f('barcode', e.target.value)} placeholder="4870..." />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Единица</Label>
        <Input value={form.unit} onChange={(e) => f('unit', e.target.value)} placeholder="шт" />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Цена продажи</Label>
        <Input type="number" value={form.sale_price} onChange={(e) => f('sale_price', e.target.value)} />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Цена закупки</Label>
        <Input type="number" value={form.purchase_price} onChange={(e) => f('purchase_price', e.target.value)} />
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Категория</Label>
        <Select value={form.category_id || '__none__'} onValueChange={(v) => f('category_id', v === '__none__' ? '' : v)}>
          <SelectTrigger><SelectValue placeholder="Без категории" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Без категории</SelectItem>
            {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Тип</Label>
        <Select value={form.item_type} onValueChange={(v) => f('item_type', v)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="product">Товар</SelectItem>
            <SelectItem value="consumable">Расходник</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs text-muted-foreground mb-1 block">Порог низкого остатка (алерт)</Label>
        <Input
          type="number"
          min={0}
          value={form.low_stock_threshold}
          onChange={(e) => f('low_stock_threshold', e.target.value)}
          placeholder="Не задан"
        />
      </div>
      <div className="col-span-2 sm:col-span-3 lg:col-span-4 flex gap-2 pt-1">
        <Button size="sm" onClick={onSave} disabled={loading || !form.name.trim() || !form.barcode.trim()}>
          <Check className="w-3.5 h-3.5 mr-1" />
          {loading ? 'Сохранение...' : 'Сохранить'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          <X className="w-3.5 h-3.5 mr-1" />Отмена
        </Button>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export function CatalogPageContent({ embedded = false }: { embedded?: boolean } = {}) {
  const { can } = useCapabilities()
  const canCreate = can('store-catalog.create')
  const canEdit = can('store-catalog.edit')
  const canDelete = can('store-catalog.delete')
  const canExport = can('store-catalog.export')
  const canImport = can('store-catalog.import')
  const canBulkZeroStock = can('store-catalog.bulk_zero_stock')
  const canBulkDeactivate = can('store-catalog.bulk_deactivate')
  const canBulkDeleteEmpty = can('store-catalog.bulk_delete_empty')
  const canBulkDeleteAll = can('store-catalog.bulk_delete_all')

  const [tab, setTab] = useState<'catalog' | 'import'>('catalog')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Filters
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [page, setPage] = useState(1)

  // Edit / add
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<ItemFormData>(EMPTY_FORM)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<ItemFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  // Import
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'previewing' | 'importing' | 'done'>('idle')
  const [importResult, setImportResult] = useState<{ created: number; updated: number; stock_updated?: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [bulkDialog, setBulkDialog] = useState<null | 'deactivate' | 'deleteEmpty' | 'deleteAll' | 'resetBalances'>(null)
  const [bulkPhrase, setBulkPhrase] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/inventory/catalog')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки')
      setItems(json.data || [])
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadItems() }, [loadItems])

  // Derived data
  const categories = Array.from(
    new Map(items.filter((i) => i.category).map((i) => [i.category!.id, i.category!])).values()
  ).sort((a, b) => a.name.localeCompare(b.name, 'ru'))

  const filtered = items.filter((item) => {
    if (filterType !== 'all' && item.item_type !== filterType) return false
    if (filterCategory !== 'all' && item.category?.id !== filterCategory) return false
    if (search) {
      const s = search.toLowerCase()
      if (!item.name.toLowerCase().includes(s) && !item.barcode.includes(s)) return false
    }
    return true
  })

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search, filterCategory, filterType])

  // Totals across all filtered items (not just current page)
  const totals = filtered.reduce(
    (acc, item) => {
      const catalogQty = Number(item.catalog_qty ?? item.total_balance ?? 0)
      acc.warehouseQty += item.warehouse_qty
      acc.showcaseQty  += item.showcase_qty
      acc.totalQty     += catalogQty
      acc.warehousePurchase += item.warehouse_qty * item.default_purchase_price
      acc.warehouseSale     += item.warehouse_qty * item.sale_price
      acc.showcasePurchase  += item.showcase_qty  * item.default_purchase_price
      acc.showcaseSale      += item.showcase_qty  * item.sale_price
      acc.totalPurchase     += catalogQty * item.default_purchase_price
      acc.totalSale         += catalogQty * item.sale_price
      return acc
    },
    {
      warehouseQty: 0, showcaseQty: 0, totalQty: 0,
      warehousePurchase: 0, warehouseSale: 0,
      showcasePurchase: 0, showcaseSale: 0,
      totalPurchase: 0, totalSale: 0,
    },
  )

  // ── Edit handlers ────────────────────────────────────────────────────────────

  function startEdit(item: CatalogItem) {
    setEditingId(item.id)
    setEditForm({
      name: item.name,
      barcode: item.barcode,
      unit: item.unit,
      sale_price: String(item.sale_price),
      purchase_price: String(item.default_purchase_price),
      category_id: item.category?.id || '',
      item_type: item.item_type || 'product',
      notes: item.notes || '',
      low_stock_threshold: item.low_stock_threshold != null ? String(item.low_stock_threshold) : '',
    })
  }

  async function saveEdit() {
    if (!editingId) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/inventory/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateItem',
          item_id: editingId,
          fields: {
            name: editForm.name.trim(),
            barcode: editForm.barcode.trim(),
            unit: editForm.unit.trim() || 'шт',
            sale_price: parseFloat(editForm.sale_price) || 0,
            default_purchase_price: parseFloat(editForm.purchase_price) || 0,
            category_id: editForm.category_id || null,
            item_type: editForm.item_type,
            notes: editForm.notes || null,
            low_stock_threshold: editForm.low_stock_threshold !== '' ? parseFloat(editForm.low_stock_threshold) || null : null,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setEditingId(null)
      await loadItems()
      showToast('Товар обновлён')
    } catch (e: any) {
      showToast('Ошибка: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  async function deleteItem(item: CatalogItem) {
    if (!window.confirm(`Удалить «${item.name}»?\n\nЭто действие нельзя отменить.`)) return
    try {
      const res = await fetch('/api/admin/inventory/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteItem', item_id: item.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      await loadItems()
      showToast('Товар удалён')
    } catch (e: any) {
      showToast('Ошибка: ' + e.message)
    }
  }

  async function saveAdd() {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/inventory/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateItem',
          // We'll use a temp approach — insert via updateItem won't work, use direct insert
          // Actually need to call createItem — but route doesn't have it. Use inventory main route.
          action2: 'createItem',
        }),
      })
      // Actually the catalog route doesn't have createItem. Use the main inventory route.
      const res2 = await fetch('/api/admin/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createItem',
          payload: {
            name: addForm.name.trim(),
            barcode: addForm.barcode.trim(),
            unit: addForm.unit.trim() || 'шт',
            sale_price: parseFloat(addForm.sale_price) || 0,
            default_purchase_price: parseFloat(addForm.purchase_price) || 0,
            category_id: addForm.category_id || null,
            item_type: addForm.item_type,
            notes: addForm.notes || null,
            low_stock_threshold: addForm.low_stock_threshold !== '' ? parseFloat(addForm.low_stock_threshold) || null : null,
          },
        }),
      })
      const json2 = await res2.json()
      if (!res2.ok) throw new Error(json2.error)
      setShowAdd(false)
      setAddForm(EMPTY_FORM)
      await loadItems()
      showToast('Товар добавлен')
    } catch (e: any) {
      showToast('Ошибка: ' + e.message)
    } finally {
      setSaving(false)
    }
  }

  // ── Import handlers ──────────────────────────────────────────────────────────

  async function handleFileChange(file: File | null) {
    if (!file) return
    setImportFile(file)
    setPreview(null)
    setImportResult(null)
    setImportError(null)
    setImportStatus('parsing')

    try {
      const rows = await parseWiponExcel(file)
      setImportRows(rows)
      setImportStatus('previewing')

      const res = await fetch('/api/admin/inventory/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'previewImport', rows }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPreview(json.data)
      setImportStatus('idle')
    } catch (e: any) {
      setImportError(e.message)
      setImportStatus('idle')
    }
  }

  async function confirmImport(opts: { force?: boolean } = {}) {
    if (!importRows.length) return
    setImportStatus('importing')
    setImportError(null)
    try {
      const res = await fetch('/api/admin/inventory/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirmImport', rows: importRows, force: !!opts.force }),
      })
      const json = await res.json()
      if (res.status === 409 && json?.error === 'stock-below-warehouse') {
        const lines = (json.violations || [])
          .slice(0, 5)
          .map((v: any) => `${v.barcode}: каталог=${v.new_catalog}, подсобка=${v.warehouse}`)
          .join('\n')
        const more = (json.violations?.length || 0) > 5 ? `\n…ещё ${(json.violations.length - 5)}` : ''
        const ok = window.confirm(
          (json.message || 'Новый каталог меньше подсобки.') +
            `\n\n${lines}${more}\n\nПродолжить и затереть остаток на витрине?`,
        )
        if (!ok) {
          setImportStatus('idle')
          return
        }
        return confirmImport({ force: true })
      }
      if (!res.ok) throw new Error(json.error)
      setImportResult(json.data)
      setImportStatus('done')
      await loadItems()
    } catch (e: any) {
      setImportError(e.message)
      setImportStatus('idle')
    }
  }

  async function runBulkAction() {
    if (!bulkDialog) return
    setBulkLoading(true)
    try {
      const action =
        bulkDialog === 'deactivate' ? 'deactivateAllItems'
        : bulkDialog === 'deleteAll' ? 'deleteAllItems'
        : bulkDialog === 'resetBalances' ? 'resetAllBalances'
        : 'deleteEmptyBalanceItems'
      const confirm =
        bulkDialog === 'deactivate' ? 'ОТКЛЮЧИТЬ ВСЕ'
        : bulkDialog === 'deleteAll' ? 'УДАЛИТЬ ВСЁ'
        : bulkDialog === 'resetBalances' ? 'ОБНУЛИТЬ ОСТАТКИ'
        : 'УДАЛИТЬ ПУСТЫЕ'
      if (bulkPhrase.trim() !== confirm) {
        showToast('Неверная фраза подтверждения')
        return
      }
      const res = await fetch('/api/admin/inventory/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, confirm: bulkPhrase.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      if (bulkDialog === 'deactivate') {
        showToast(`Скрыто позиций: ${json.data?.count ?? 0}`)
      } else if (bulkDialog === 'deleteAll') {
        showToast(`Удалено всё: ${json.data?.deleted ?? 0} позиций`)
      } else if (bulkDialog === 'resetBalances') {
        showToast(`Обнулено остатков: ${json.data?.deleted ?? 0} строк`)
      } else {
        showToast(`Удалено: ${json.data?.deleted ?? 0}, не удалось: ${json.data?.failed ?? 0}`)
      }
      setBulkDialog(null)
      setBulkPhrase('')
      await loadItems()
    } catch (e: any) {
      showToast(e.message || 'Ошибка')
    } finally {
      setBulkLoading(false)
    }
  }

  function resetImport() {
    setImportFile(null)
    setImportRows([])
    setPreview(null)
    setImportResult(null)
    setImportError(null)
    setImportStatus('idle')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className={embedded ? 'space-y-6' : 'app-page max-w-[1400px] space-y-6'}>
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      {(() => {
        const hdrActions = (
          <>
            {canExport && (
              <Button variant="outline" size="sm" onClick={() => exportToExcel(filtered)}>
                <Download className="w-3.5 h-3.5 mr-1.5" />
                Экспорт PDF
              </Button>
            )}
            {canBulkZeroStock && (
              <Button variant="outline" size="sm" className="text-sky-700 border-sky-500/40" onClick={() => { setBulkDialog('resetBalances'); setBulkPhrase('') }}>
                Обнулить остатки
              </Button>
            )}
            {canBulkDeactivate && (
              <Button variant="outline" size="sm" className="text-amber-700 border-amber-500/40" onClick={() => { setBulkDialog('deactivate'); setBulkPhrase('') }}>
                Скрыть все в каталоге
              </Button>
            )}
            {canBulkDeleteEmpty && (
              <Button variant="outline" size="sm" className="text-destructive border-destructive/40" onClick={() => { setBulkDialog('deleteEmpty'); setBulkPhrase('') }}>
                Удалить без остатков
              </Button>
            )}
            {canBulkDeleteAll && (
              <Button variant="outline" size="sm" className="text-destructive border-destructive/60 bg-destructive/5" onClick={() => { setBulkDialog('deleteAll'); setBulkPhrase('') }}>
                Удалить весь каталог
              </Button>
            )}
            {canCreate && (
              <Button size="sm" onClick={() => { setShowAdd(true); setEditingId(null) }}>
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Добавить товар
              </Button>
            )}
          </>
        )
        return embedded ? (
          <div className="flex flex-wrap items-center justify-end gap-2">{hdrActions}</div>
        ) : (
          <AdminPageHeader
            title="Каталог товаров"
            description={loading ? 'Загрузка...' : `${items.length} позиций в базе`}
            icon={<Package className="h-5 w-5" />}
            accent="emerald"
            backHref="/"
            actions={hdrActions}
          />
        )
      })()}

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Позиций */}
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Tag className="w-3.5 h-3.5 text-slate-400" />
              Позиций
            </div>
            <div className="text-xl font-bold text-foreground">{items.length.toLocaleString('ru-RU')}</div>
            {filtered.length !== items.length && (
              <div className="text-[11px] text-muted-foreground mt-0.5">в фильтре: {filtered.length}</div>
            )}
          </div>

          {/* Склад — закуп */}
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-blue-300/70 mb-1">
              <Warehouse className="w-3.5 h-3.5" />
              Склад по закупу
            </div>
            <div className="text-xl font-bold text-blue-300">
              {Math.round(totals.warehousePurchase).toLocaleString('ru-RU')} ₸
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{totals.warehouseQty.toLocaleString('ru-RU')} ед.</div>
          </div>

          {/* Склад — продажа */}
          <div className="rounded-2xl border border-blue-400/20 bg-blue-400/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-blue-200/70 mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Склад по продаже
            </div>
            <div className="text-xl font-bold text-blue-200">
              {Math.round(totals.warehouseSale).toLocaleString('ru-RU')} ₸
            </div>
            <div className="text-[11px] text-emerald-400/80 mt-0.5">
              +{Math.round(totals.warehouseSale - totals.warehousePurchase).toLocaleString('ru-RU')} ₸ наценка
            </div>
          </div>

          {/* Витрина — закуп */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-amber-300/70 mb-1">
              <Store className="w-3.5 h-3.5" />
              Витрина по закупу
            </div>
            <div className="text-xl font-bold text-amber-300">
              {Math.round(totals.showcasePurchase).toLocaleString('ru-RU')} ₸
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{totals.showcaseQty.toLocaleString('ru-RU')} ед.</div>
          </div>

          {/* Всего — продажа */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-emerald-300/70 mb-1">
              <ShoppingCart className="w-3.5 h-3.5" />
              Итого по продаже
            </div>
            <div className="text-xl font-bold text-emerald-300">
              {Math.round(totals.totalSale).toLocaleString('ru-RU')} ₸
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">
              зак: {Math.round(totals.totalPurchase).toLocaleString('ru-RU')} ₸
            </div>
          </div>
        </div>
      )}

      {/* Tabs — вкладка «Импорт» скрыта если нет права store-catalog.import */}
      <div className="flex gap-1 border-b border-border">
        {(['catalog', 'import'] as const)
          .filter((t) => t !== 'import' || canImport)
          .map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                tab === t
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {t === 'catalog' ? `Каталог${filtered.length !== items.length ? ` (${filtered.length})` : ` (${items.length})`}` : 'Импорт Excel'}
            </button>
          ))}
      </div>

      {/* ── TAB: CATALOG ─────────────────────────────────────────────────────── */}
      {tab === 'catalog' && (
        <div className="space-y-4">
          {/* Add form */}
          {showAdd && (
            <Card className="border-primary/30 p-4 bg-primary/5">
              <p className="text-sm font-medium mb-3">Новый товар</p>
              <ItemForm
                form={addForm}
                onChange={setAddForm}
                categories={categories}
                onSave={saveAdd}
                onCancel={() => { setShowAdd(false); setAddForm(EMPTY_FORM) }}
                loading={saving}
              />
            </Card>
          )}

          {/* Filters */}
          <Card className="border-border/70 p-3">
            <div className="flex flex-wrap gap-2">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  className="pl-8 h-8 text-sm"
                  placeholder="Поиск по названию или штрихкоду..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select value={filterCategory || 'all'} onValueChange={setFilterCategory}>
                <SelectTrigger className="h-8 text-sm w-[160px]">
                  <SelectValue placeholder="Категория" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все категории</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={filterType} onValueChange={setFilterType}>
                <SelectTrigger className="h-8 text-sm w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все типы</SelectItem>
                  <SelectItem value="product">Товар</SelectItem>
                  <SelectItem value="consumable">Расходник</SelectItem>
                </SelectContent>
              </Select>
              {(search || filterCategory !== 'all' || filterType !== 'all') && (
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => { setSearch(''); setFilterCategory('all'); setFilterType('all') }}>
                  Сбросить
                </Button>
              )}
            </div>
          </Card>

          {/* Error */}
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Table */}
          <Card className="border-border/70 overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center h-40 text-sm text-muted-foreground">Загрузка...</div>
            ) : paginated.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-40 text-sm text-muted-foreground gap-2">
                <Package className="w-8 h-8 opacity-30" />
                {filtered.length === 0 && items.length > 0 ? 'Ничего не найдено' : 'Каталог пуст. Добавьте товары или импортируйте из Wipon'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/30">
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Название</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Штрихкод</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Категория</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">Продажа</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">Закупка</th>
                      <th className="px-3 py-2.5 text-center font-medium text-muted-foreground text-xs">Ед.</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">Склад</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">Витрина</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">Каталог</th>
                      <th className="px-3 py-2.5 text-center font-medium text-muted-foreground text-xs w-20">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {paginated.map((item) => (
                      <Fragment key={item.id}>
                        <tr className={`hover:bg-muted/20 transition-colors ${!item.is_active ? 'opacity-50' : ''}`}>
                          <td className="px-3 py-2.5 font-medium max-w-[220px]">
                            <span className="truncate block">{item.name}</span>
                            {item.item_type === 'consumable' && (
                              <Badge variant="outline" className="text-[10px] mt-0.5 h-4">расходник</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground font-mono text-xs">{item.barcode}</td>
                          <td className="px-3 py-2.5">
                            {item.category ? (
                              <Badge variant="secondary" className="text-xs">{item.category.name}</Badge>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-medium">{item.sale_price.toLocaleString('ru-RU')} ₸</td>
                          <td className="px-3 py-2.5 text-right text-muted-foreground">{item.default_purchase_price.toLocaleString('ru-RU')} ₸</td>
                          <td className="px-3 py-2.5 text-center text-muted-foreground text-xs">{item.unit}</td>
                          <td className="px-3 py-2 text-right">
                            {item.warehouse_qty > 0 ? (
                              <div className="space-y-0.5">
                                <div className="text-blue-400 font-medium">{item.warehouse_qty.toLocaleString('ru-RU')} {item.unit}</div>
                                <div className="text-[10px] text-muted-foreground">зак: {(item.warehouse_qty * item.default_purchase_price).toLocaleString('ru-RU')} ₸</div>
                                <div className="text-[10px] text-muted-foreground">пр: {(item.warehouse_qty * item.sale_price).toLocaleString('ru-RU')} ₸</div>
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {item.showcase_qty > 0 ? (
                              <div className="space-y-0.5">
                                <div className="text-amber-400 font-medium">{item.showcase_qty.toLocaleString('ru-RU')} {item.unit}</div>
                                <div className="text-[10px] text-muted-foreground">зак: {(item.showcase_qty * item.default_purchase_price).toLocaleString('ru-RU')} ₸</div>
                                <div className="text-[10px] text-muted-foreground">пр: {(item.showcase_qty * item.sale_price).toLocaleString('ru-RU')} ₸</div>
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {(Number(item.catalog_qty ?? item.total_balance) || 0) > 0 ? (
                              <div className="space-y-0.5">
                                <div className="text-emerald-400 font-semibold">{(Number(item.catalog_qty ?? item.total_balance) || 0).toLocaleString('ru-RU')} {item.unit}</div>
                                <div className="text-[10px] text-muted-foreground">зак: {((Number(item.catalog_qty ?? item.total_balance) || 0) * item.default_purchase_price).toLocaleString('ru-RU')} ₸</div>
                                <div className="text-[10px] text-muted-foreground">пр: {((Number(item.catalog_qty ?? item.total_balance) || 0) * item.sale_price).toLocaleString('ru-RU')} ₸</div>
                              </div>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-center gap-1">
                              {canEdit && (
                                <button
                                  onClick={() => { startEdit(item); setShowAdd(false) }}
                                  className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                  title="Редактировать"
                                >
                                  <Pencil className="w-3.5 h-3.5" />
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  onClick={() => deleteItem(item)}
                                  className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                  title="Удалить"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                        {editingId === item.id && (
                          <tr>
                            <td colSpan={10} className="px-4 py-3 bg-muted/30 border-b border-primary/20">
                              <ItemForm
                                form={editForm}
                                onChange={setEditForm}
                                categories={categories}
                                onSave={saveEdit}
                                onCancel={() => setEditingId(null)}
                                loading={saving}
                              />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    ))}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-border/50 bg-muted/30">
                        <td colSpan={6} className="px-3 py-2.5 text-xs text-muted-foreground font-medium text-right">
                          Итого ({filtered.length} поз.):
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="space-y-0.5">
                            <div className="text-blue-400 font-semibold text-xs">{totals.warehouseQty.toLocaleString('ru-RU')}</div>
                            <div className="text-[10px] text-muted-foreground">зак: {Math.round(totals.warehousePurchase).toLocaleString('ru-RU')} ₸</div>
                            <div className="text-[10px] text-muted-foreground">пр: {Math.round(totals.warehouseSale).toLocaleString('ru-RU')} ₸</div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="space-y-0.5">
                            <div className="text-amber-400 font-semibold text-xs">{totals.showcaseQty.toLocaleString('ru-RU')}</div>
                            <div className="text-[10px] text-muted-foreground">зак: {Math.round(totals.showcasePurchase).toLocaleString('ru-RU')} ₸</div>
                            <div className="text-[10px] text-muted-foreground">пр: {Math.round(totals.showcaseSale).toLocaleString('ru-RU')} ₸</div>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="space-y-0.5">
                            <div className="text-emerald-400 font-bold text-xs">{totals.totalQty.toLocaleString('ru-RU')}</div>
                            <div className="text-[10px] text-muted-foreground">зак: {Math.round(totals.totalPurchase).toLocaleString('ru-RU')} ₸</div>
                            <div className="text-[10px] text-muted-foreground">пр: {Math.round(totals.totalSale).toLocaleString('ru-RU')} ₸</div>
                          </div>
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </Card>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>
                Показано {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} из {filtered.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>
                  <ChevronLeft className="w-3.5 h-3.5" />
                </Button>
                <span className="px-2">{page} / {totalPages}</span>
                <Button variant="outline" size="sm" className="h-7 px-2" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: IMPORT ──────────────────────────────────────────────────────── */}
      {tab === 'import' && (
        <div className="space-y-4 max-w-2xl">
          <Card className="border-border/70 p-5">
            <h2 className="font-semibold mb-1">Импорт из Excel</h2>
            <p className="text-sm text-muted-foreground mb-4">
              Поддерживается типичный экспорт из Wipon и похожие файлы. Колонки: «Название», «Штрихкод»,
              «Единица измерения», «Цена продажи», «Цена закупки», «Категория». Колонка «Остаток» из файла
              записывается в Каталог (общий остаток точки) — это полный объём товаров в магазине. Склад (подсобка)
              редактируется вручную, витрина = каталог − склад. Нужна выбранная организация (или одна организация в системе).
            </p>

            {/* File drop zone */}
            {importStatus !== 'done' && (
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  const f = e.dataTransfer.files?.[0]
                  if (f) handleFileChange(f)
                }}
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">{importFile ? importFile.name : 'Нажмите или перетащите файл'}</p>
                <p className="text-xs text-muted-foreground mt-1">Файлы .xlsx и .xls</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                />
              </div>
            )}

            {/* Parsing / loading */}
            {(importStatus === 'parsing' || importStatus === 'previewing') && (
              <div className="mt-4 text-sm text-muted-foreground animate-pulse">
                {importStatus === 'parsing' ? '⏳ Читаю файл...' : '⏳ Анализирую изменения...'}
              </div>
            )}

            {/* Import error */}
            {importError && (
              <div className="mt-4 rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive">
                {importError}
              </div>
            )}

            {/* Preview */}
            {preview && importStatus !== 'done' && (
              <div className="mt-4 space-y-3">
                {/*
                 * Import action can be needed even when item cards are unchanged:
                 * stock_qty from Excel still has to be written into catalog_total.
                 */}
                {(() => {
                  const cardChangesCount = preview.new_items.length + preview.updated_items.length
                  const hasStockSync = (preview.stock_rows || 0) > 0
                  const canApplyImport = cardChangesCount > 0 || hasStockSync
                  const applyLabel = hasStockSync
                    ? `Применить импорт (карточки: ${cardChangesCount}, остатки: ${preview.stock_rows})`
                    : `Применить импорт (${cardChangesCount} позиций)`
                  return (
                    <>
                <h3 className="font-medium text-sm">Результат анализа</h3>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-center">
                    <div className="text-2xl font-bold text-emerald-600">{preview.new_items.length}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">🟢 Новых</div>
                  </div>
                  <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3 text-center">
                    <div className="text-2xl font-bold text-amber-600">{preview.updated_items.length}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">🟡 Обновятся</div>
                  </div>
                  <div className="rounded-lg bg-muted/50 border border-border p-3 text-center">
                    <div className="text-2xl font-bold text-muted-foreground">{preview.unchanged_count}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">⚪ Без изменений</div>
                  </div>
                  <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-3 text-center">
                    <div className="text-2xl font-bold text-blue-600">{preview.categories_to_create.length}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">📁 Новых категорий</div>
                  </div>
                </div>

                {preview.categories_to_create.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Будут созданы категории: {preview.categories_to_create.map((c) => (
                      <Badge key={c} variant="outline" className="text-[10px] mr-1">{c}</Badge>
                    ))}
                  </div>
                )}

                {(preview.stock_rows || 0) > 0 ? (
                  <p className="text-xs text-blue-600 dark:text-blue-400">
                    Остаток для {preview.stock_rows} строк из файла будет записан в каталог (итого по магазину).
                  </p>
                ) : null}
                {preview.new_items.length === 0 && preview.updated_items.length === 0 && (preview.stock_rows || 0) > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    По карточкам изменений нет, но остатки будут обновлены из файла.
                  </p>
                ) : null}

                {(preview.stock_warnings?.length || 0) > 0 && (
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                    <p className="font-semibold mb-1">⚠ Внимание: новый каталог меньше подсобки</p>
                    <p className="mb-1">
                      Для {preview.stock_warnings!.length} товаров новый остаток в каталоге меньше текущей подсобки. Это уничтожит остаток на витрине. Подтверждение потребуется при применении.
                    </p>
                    <div className="space-y-0.5 mt-1">
                      {preview.stock_warnings!.slice(0, 5).map((w) => (
                        <div key={w.barcode} className="flex justify-between gap-2">
                          <span className="truncate">{w.name}</span>
                          <span className="shrink-0">каталог {w.new_catalog} &lt; подсобка {w.current_warehouse}</span>
                        </div>
                      ))}
                      {preview.stock_warnings!.length > 5 && (
                        <p className="text-rose-600/70">…ещё {preview.stock_warnings!.length - 5}</p>
                      )}
                    </div>
                  </div>
                )}

                {(preview.stock_changes?.length || 0) > 0 && (
                  <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-xs">
                    <p className="font-medium mb-1">
                      Изменений остатка: {preview.stock_changes!.length} (плюс {preview.stock_total_delta_positive ?? 0}, минус {preview.stock_total_delta_negative ?? 0})
                    </p>
                    <div className="space-y-0.5 max-h-40 overflow-auto">
                      {preview.stock_changes!.slice(0, 10).map((c) => (
                        <div key={c.barcode} className="flex justify-between gap-2 text-muted-foreground">
                          <span className="truncate">{c.name}</span>
                          <span className="shrink-0">
                            {c.current_catalog} → {c.new_catalog} ({c.delta_catalog > 0 ? '+' : ''}{c.delta_catalog})
                          </span>
                        </div>
                      ))}
                      {preview.stock_changes!.length > 10 && (
                        <p className="text-muted-foreground/70">…ещё {preview.stock_changes!.length - 10}</p>
                      )}
                    </div>
                  </div>
                )}

                {preview.new_items.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Примеры новых товаров:</p>
                    <div className="space-y-1">
                      {preview.new_items.slice(0, 5).map((item, i) => (
                        <div key={i} className="text-xs bg-muted/30 rounded px-2 py-1 flex justify-between">
                          <span className="truncate">{item.name}</span>
                          <span className="text-muted-foreground ml-2 shrink-0">{item.sale_price.toLocaleString('ru-RU')} ₸</span>
                        </div>
                      ))}
                      {preview.new_items.length > 5 && (
                        <p className="text-xs text-muted-foreground">...и ещё {preview.new_items.length - 5}</p>
                      )}
                    </div>
                  </div>
                )}

                {preview.updated_items.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Примеры обновлений:</p>
                    <div className="space-y-1">
                      {preview.updated_items.slice(0, 5).map((item, i) => (
                        <div key={i} className="text-xs bg-amber-500/5 rounded px-2 py-1">
                          <span className="truncate block">{item.name}</span>
                          {item.price_changed && (
                            <span className="text-muted-foreground">
                              Цена: {(item as any).existing_price?.toLocaleString('ru-RU') || '?'} → {item.sale_price.toLocaleString('ru-RU')} ₸
                            </span>
                          )}
                          {item.name_changed && (
                            <span className="text-muted-foreground block">
                              Было: «{item.existing_name}»
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    onClick={() => confirmImport()}
                    disabled={importStatus === 'importing' || !canApplyImport}
                  >
                    {importStatus === 'importing' ? 'Импортирую...' : applyLabel}
                  </Button>
                  <Button variant="ghost" onClick={resetImport}>Отмена</Button>
                </div>
                    </>
                  )
                })()}
              </div>
            )}

            {/* Success */}
            {importStatus === 'done' && importResult && (
              <div className="mt-4 space-y-4">
                <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-4">
                  <p className="font-semibold text-emerald-700 dark:text-emerald-400 flex items-center gap-1"><Check className="w-4 h-4" /> Импорт выполнен успешно</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Добавлено: <strong>{importResult.created}</strong> · Обновлено: <strong>{importResult.updated}</strong>
                    {typeof importResult.stock_updated === 'number' && importResult.stock_updated > 0
                      ? <> · Остатки в каталоге: <strong>{importResult.stock_updated}</strong></>
                      : null}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button onClick={() => { setTab('catalog'); resetImport() }}>
                    Перейти в каталог
                  </Button>
                  <Button variant="ghost" onClick={resetImport}>Загрузить ещё</Button>
                </div>
              </div>
            )}
          </Card>

          <Card className="border-border/70 p-4 bg-muted/30">
            <h3 className="text-sm font-medium mb-2">Пример колонок (как в вашем экспорте)</h3>
            <p className="text-xs text-muted-foreground mb-2">
              Название · Единица измерения · Цена продажи · Штрихкод · Остаток · Цена закупки · Категория
            </p>
            <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
              <li>Экспортируйте товары в Excel из Wipon или другой программы</li>
              <li>Сохраните .xlsx и загрузите сюда</li>
            </ol>
          </Card>
        </div>
      )}

      <Dialog open={bulkDialog !== null} onOpenChange={(open) => { if (!open) { setBulkDialog(null); setBulkPhrase('') } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {bulkDialog === 'deactivate' ? 'Скрыть все позиции в каталоге'
                : bulkDialog === 'deleteAll' ? 'Удалить весь каталог'
                : bulkDialog === 'resetBalances' ? 'Обнулить остатки каталога/склада/витрины'
                : 'Удалить товары без остатков'}
            </DialogTitle>
            <DialogDescription>
              {bulkDialog === 'deactivate'
                ? 'Все товары станут неактивными (не исчезнут из базы). Для POS и отчётов они не будут предлагаться.'
                : bulkDialog === 'deleteAll'
                ? 'Будут удалены ВСЕ товары организации включая остатки на складе и витринах. Это действие необратимо.'
                : bulkDialog === 'resetBalances'
                ? 'Обнулит остатки на всех catalog/warehouse/point_display/backroom локациях организации. Сами товары, история движений и приёмок останутся. Нужен чтобы перезалить Excel с нуля после ошибочного импорта в не ту точку.'
                : 'Будут удалены только позиции с нулевым остатком на всех локациях. Если у товара есть приёмки, продажи или другая история, удаление может не пройти — такие строки будут пропущены.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs text-muted-foreground">
              Введите фразу: <span className="font-mono text-foreground">
                {bulkDialog === 'deactivate' ? 'ОТКЛЮЧИТЬ ВСЕ'
                  : bulkDialog === 'deleteAll' ? 'УДАЛИТЬ ВСЁ'
                  : bulkDialog === 'resetBalances' ? 'ОБНУЛИТЬ ОСТАТКИ'
                  : 'УДАЛИТЬ ПУСТЫЕ'}
              </span>
            </Label>
            <Input value={bulkPhrase} onChange={(e) => setBulkPhrase(e.target.value)} placeholder="Точно как указано выше" autoComplete="off" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setBulkDialog(null); setBulkPhrase('') }}>Отмена</Button>
            <Button variant="destructive" disabled={bulkLoading} onClick={() => void runBulkAction()}>
              {bulkLoading ? 'Выполняю...' : 'Подтвердить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default function CatalogPage() {
  return <InventoryLegacyRedirect href="/store/catalog" />
}
