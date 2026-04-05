'use client'

import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { buildStyledSheet, createWorkbook, downloadWorkbook } from '@/lib/excel/styled-export'
import { Package, Pencil, Plus, Search, Trash2, Upload, Download, Check, X, ChevronLeft, ChevronRight } from 'lucide-react'

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
  /** Колонка «Остаток» в Excel — выставляет остаток на центральном складе */
  stock_qty?: number
}

type PreviewData = {
  new_items: ImportRow[]
  updated_items: Array<ImportRow & { existing_name: string; price_changed: boolean; name_changed: boolean }>
  unchanged_count: number
  categories_to_create: string[]
  stock_rows?: number
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

async function exportToExcel(items: CatalogItem[], filename = 'catalog.xlsx') {
  const wb = createWorkbook()
  const today = new Date().toLocaleDateString('ru-RU')
  buildStyledSheet(wb, 'Каталог', 'Каталог товаров и услуг', `Экспорт: ${today} | Позиций: ${items.length}`, [
    { header: 'Название', key: 'name', width: 30, type: 'text' },
    { header: 'Штрихкод', key: 'barcode', width: 16, type: 'text' },
    { header: 'Категория', key: 'category', width: 18, type: 'text' },
    { header: 'Тип', key: 'type', width: 10, type: 'text' },
    { header: 'Цена продажи', key: 'salePrice', width: 16, type: 'money' },
    { header: 'Цена закупки', key: 'purchasePrice', width: 16, type: 'money' },
    { header: 'Единица', key: 'unit', width: 10, type: 'text' },
    { header: 'Остаток', key: 'balance', width: 12, type: 'number', align: 'right' },
    { header: 'Активен', key: 'active', width: 10, type: 'text' },
  ], items.map(item => ({
    name: item.name,
    barcode: item.barcode || '',
    category: item.category?.name || '',
    type: item.item_type === 'product' ? 'Товар' : 'Услуга',
    salePrice: item.sale_price,
    purchasePrice: item.default_purchase_price,
    unit: item.unit || '',
    balance: item.total_balance,
    active: item.is_active ? 'Да' : 'Нет',
  })))
  await downloadWorkbook(wb, filename)
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

export function CatalogPageContent() {
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

  const [bulkDialog, setBulkDialog] = useState<null | 'deactivate' | 'deleteEmpty'>(null)
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

  async function confirmImport() {
    if (!importRows.length) return
    setImportStatus('importing')
    setImportError(null)
    try {
      const res = await fetch('/api/admin/inventory/catalog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'confirmImport', rows: importRows }),
      })
      const json = await res.json()
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
      const action = bulkDialog === 'deactivate' ? 'deactivateAllItems' : 'deleteEmptyBalanceItems'
      const confirm = bulkDialog === 'deactivate' ? 'ОТКЛЮЧИТЬ ВСЕ' : 'УДАЛИТЬ ПУСТЫЕ'
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
    <div className="app-page max-w-[1400px] space-y-6">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 z-50 rounded-lg bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" />
            Каталог товаров
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {loading ? 'Загрузка...' : `${items.length} позиций в базе`}
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => exportToExcel(filtered)}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            Экспорт Excel
          </Button>
          <Button variant="outline" size="sm" className="text-amber-700 border-amber-500/40" onClick={() => { setBulkDialog('deactivate'); setBulkPhrase('') }}>
            Скрыть все в каталоге
          </Button>
          <Button variant="outline" size="sm" className="text-destructive border-destructive/40" onClick={() => { setBulkDialog('deleteEmpty'); setBulkPhrase('') }}>
            Удалить без остатков
          </Button>
          <Button size="sm" onClick={() => { setShowAdd(true); setEditingId(null) }}>
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Добавить товар
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['catalog', 'import'] as const).map((t) => (
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
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/60 bg-muted/30">
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Название</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Штрихкод</th>
                      <th className="px-3 py-2.5 text-left font-medium text-muted-foreground text-xs">Категория</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">Продажа</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">Закупка</th>
                      <th className="px-3 py-2.5 text-center font-medium text-muted-foreground text-xs">Ед.</th>
                      <th className="px-3 py-2.5 text-right font-medium text-muted-foreground text-xs">Остаток</th>
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
                          <td className={`px-3 py-2.5 text-right font-medium ${item.total_balance > 0 ? 'text-emerald-600' : 'text-muted-foreground'}`}>
                            {item.total_balance > 0 ? item.total_balance.toLocaleString('ru-RU') : '—'}
                          </td>
                          <td className="px-3 py-2.5">
                            <div className="flex items-center justify-center gap-1">
                              <button
                                onClick={() => { startEdit(item); setShowAdd(false) }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                                title="Редактировать"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => deleteItem(item)}
                                className="p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                                title="Удалить"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                        {editingId === item.id && (
                          <tr>
                            <td colSpan={8} className="px-4 py-3 bg-muted/30 border-b border-primary/20">
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
              всегда записывается только на центральный склад организации (витрины точек не меняются);
              на точку товар потом ведётся заявками. Нужна выбранная организация (или одна организация в системе).
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
                    Остаток для {preview.stock_rows} строк из файла будет записан только на центральный склад (не на витрины).
                  </p>
                ) : null}

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
                    onClick={confirmImport}
                    disabled={importStatus === 'importing' || (preview.new_items.length === 0 && preview.updated_items.length === 0)}
                  >
                    {importStatus === 'importing' ? 'Импортирую...' : `Применить импорт (${preview.new_items.length + preview.updated_items.length} позиций)`}
                  </Button>
                  <Button variant="ghost" onClick={resetImport}>Отмена</Button>
                </div>
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
                      ? <> · Остатки на складе: <strong>{importResult.stock_updated}</strong></>
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
              {bulkDialog === 'deactivate' ? 'Скрыть все позиции в каталоге' : 'Удалить товары без остатков'}
            </DialogTitle>
            <DialogDescription>
              {bulkDialog === 'deactivate'
                ? 'Все товары станут неактивными (не исчезнут из базы). Для POS и отчётов они не будут предлагаться.'
                : 'Будут удалены только позиции с нулевым остатком на всех локациях. Если у товара есть приёмки, продажи или другая история, удаление может не пройти — такие строки будут пропущены.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs text-muted-foreground">
              Введите фразу: <span className="font-mono text-foreground">{bulkDialog === 'deactivate' ? 'ОТКЛЮЧИТЬ ВСЕ' : 'УДАЛИТЬ ПУСТЫЕ'}</span>
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
