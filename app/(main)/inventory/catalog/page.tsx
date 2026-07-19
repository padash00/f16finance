'use client'

import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { downloadReportPdf } from '@/lib/client/download-pdf'
import { useApiCache } from '@/lib/client/use-api-cache'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { Package, Pencil, Plus, Printer, Search, Trash2, Upload, Download, Check, X, ChevronLeft, ChevronRight, ShoppingCart, TrendingUp, Warehouse, Store, Tag, Loader2 } from 'lucide-react'

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
import ProductCardModal from '@/components/store/product-card-modal'
import { LabelPrintDialog, type LabelItem } from '@/components/store/label-print-dialog'
import { CopyText } from '@/components/ui/copy-text'
import { usePersistentState } from '@/lib/client/use-persistent-state'
import { useUnsavedGuard } from '@/lib/client/use-unsaved-guard'
import { TableSkeleton } from '@/components/skeleton'
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
  requires_expiry?: boolean
  image_url?: string | null
  created_at?: string | null
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
  requires_expiry: boolean
  /** Фото из распознавания по штрихкоду — проставляется на товар после создания. */
  image_url?: string
}

const EMPTY_FORM: ItemFormData = {
  name: '', barcode: '', unit: 'шт', sale_price: '0', purchase_price: '0',
  category_id: '', item_type: 'product', notes: '', low_stock_threshold: '', requires_expiry: true,
  image_url: '',
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

async function parseWiponExcel(file: File): Promise<ImportRow[]> {
  // xlsx весит сотни КБ — грузим только когда пользователь реально выбрал файл
  const XLSX = await import('xlsx')
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

function genBarcode() {
  // 13-значный внутренний штрихкод (префикс 2 — для внутреннего использования)
  let s = '2'
  for (let i = 0; i < 12; i++) s += Math.floor(Math.random() * 10)
  return s
}

function ItemForm({
  form, onChange, categories, onSave, onCancel, loading,
  existingItems, excludeId, nameInputRef, autoFocusName,
}: {
  form: ItemFormData
  onChange: (f: ItemFormData) => void
  categories: { id: string; name: string }[]
  onSave: () => void
  onCancel: () => void
  loading: boolean
  /** Список товаров каталога для проверки дубля штрихкода на лету */
  existingItems?: { id: string; barcode: string; name: string }[]
  /** id редактируемого товара — не считать его собственный штрихкод дублем */
  excludeId?: string | null
  nameInputRef?: React.Ref<HTMLInputElement>
  autoFocusName?: boolean
}) {
  const f = (key: keyof ItemFormData, val: string) => onChange({ ...form, [key]: val })
  const sectionLabel = 'text-[11px] font-semibold uppercase tracking-wide text-muted-foreground'
  const fieldLabel = 'text-xs text-muted-foreground mb-1 block'

  // Распознавание товара по штрихкоду (открытые базы + AI), результат в кэш.
  const [recog, setRecog] = useState<{ loading: boolean; data: any | null; error: string | null }>({ loading: false, data: null, error: null })
  const runLookup = async () => {
    const code = form.barcode.replace(/\D/g, '')
    if (code.length < 8) { setRecog({ loading: false, data: null, error: 'Введите штрихкод (минимум 8 цифр)' }); return }
    setRecog({ loading: true, data: null, error: null })
    try {
      const res = await fetch(`/api/admin/store/barcode-lookup?code=${encodeURIComponent(code)}`, { cache: 'no-store' })
      const j = await res.json().catch(() => null)
      if (!res.ok) throw new Error(j?.error || 'Не удалось распознать')
      setRecog({ loading: false, data: j?.data || null, error: null })
    } catch (e: any) {
      setRecog({ loading: false, data: null, error: e?.message || 'Ошибка распознавания' })
    }
  }
  const applySuggestion = () => {
    const d = recog.data
    if (!d) return
    onChange({
      ...form,
      name: d.name || form.name,
      category_id: d.category_id || form.category_id,
      notes: d.description || form.notes,
      // Фото из открытых баз — сохраним на товар после создания (авто-фото).
      image_url: d.image_url || form.image_url || '',
    })
    setRecog((r) => ({ ...r, data: { ...r.data, found: 'applied' } }))
  }

  // Дубль штрихкода на лету: подсказка + блокировка сохранения
  const trimmedBarcode = form.barcode.trim()
  const duplicateItem = trimmedBarcode
    ? (existingItems || []).find((x) => x.barcode === trimmedBarcode && x.id !== excludeId)
    : undefined

  const purchase = parseFloat(form.purchase_price) || 0
  const sale = parseFloat(form.sale_price) || 0
  const markup = purchase > 0 ? String(Math.round(((sale / purchase - 1) * 100 + Number.EPSILON) * 10) / 10) : ''
  const setMarkup = (val: string) => {
    const m = parseFloat(val.replace(',', '.'))
    if (purchase > 0 && Number.isFinite(m)) {
      onChange({ ...form, sale_price: String(Math.round((purchase * (1 + m / 100) + Number.EPSILON) * 100) / 100) })
    }
  }

  return (
    <div className="space-y-4">
      {/* Основное */}
      <div className="space-y-2">
        <div className={sectionLabel}>Основное</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label className={fieldLabel}>Наименование *</Label>
            <Input ref={nameInputRef} autoFocus={autoFocusName} value={form.name} onChange={(e) => f('name', e.target.value)} placeholder="Название товара" />
          </div>
          <div>
            <Label className={fieldLabel}>Штрихкод *</Label>
            <div className="flex gap-2">
              <Input value={form.barcode} onChange={(e) => f('barcode', e.target.value)} placeholder="Отсканируйте или введите" />
              <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={() => void runLookup()} disabled={recog.loading} title="Найти товар по штрихкоду в открытых базах">
                {recog.loading ? '…' : 'Распознать'}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="shrink-0" onClick={() => f('barcode', genBarcode())} title="Сгенерировать внутренний штрихкод">Сген.</Button>
            </div>
            {duplicateItem && (
              <div className="mt-1 text-xs font-medium text-rose-600 dark:text-rose-400">
                ⚠ Штрихкод уже занят: {duplicateItem.name}
              </div>
            )}
          </div>
          <div>
            <Label className={fieldLabel}>Категория</Label>
            <Select value={form.category_id || '__none__'} onValueChange={(v) => f('category_id', v === '__none__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Без категории" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Без категории</SelectItem>
                {categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className={fieldLabel}>Единица измерения</Label>
            <Input value={form.unit} onChange={(e) => f('unit', e.target.value)} placeholder="шт" />
          </div>
          <div>
            <Label className={fieldLabel}>Тип</Label>
            <Select value={form.item_type} onValueChange={(v) => f('item_type', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="product">Товар</SelectItem>
                <SelectItem value="consumable">Расходник</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Результат распознавания по штрихкоду */}
        {recog.error ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">{recog.error}</div>
        ) : null}
        {recog.data?.found === 'local' ? (
          <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">
            Такой штрихкод уже есть в каталоге: <span className="font-medium">{recog.data.name}</span>{recog.data.category_name ? ` · ${recog.data.category_name}` : ''}.
          </div>
        ) : recog.data?.found === 'none' ? (
          <div className="rounded-lg border border-border bg-surface-muted px-3 py-2 text-xs text-muted-foreground">
            Не нашли в открытых базах{recog.data.country ? ` (код: ${recog.data.country})` : ''}. Заполните вручную — товар сохранится в каталоге.
          </div>
        ) : recog.data?.found === 'external' || recog.data?.found === 'applied' ? (
          <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
            {recog.data.image_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={recog.data.image_url} alt="" className="h-12 w-12 shrink-0 rounded object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-emerald-700 dark:text-emerald-200">{recog.data.name}</div>
              <div className="mt-0.5 text-[11px] text-emerald-600/80 dark:text-emerald-300/80">
                {[recog.data.brand, recog.data.category_name, recog.data.country].filter(Boolean).join(' · ') || '—'}
              </div>
              {recog.data.description ? <div className="mt-1 text-[11px] text-muted-foreground">{recog.data.description}</div> : null}
            </div>
            {recog.data.found === 'applied' ? (
              <span className="shrink-0 self-center text-[11px] text-emerald-600 dark:text-emerald-300">подставлено ✓</span>
            ) : (
              <Button type="button" size="sm" variant="outline" className="shrink-0 self-center" onClick={applySuggestion}>Подставить</Button>
            )}
          </div>
        ) : null}
      </div>

      {/* Цена */}
      <div className="space-y-2">
        <div className={sectionLabel}>Цена</div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label className={fieldLabel}>Цена закупки, ₸</Label>
            <Input type="number" min={0} value={form.purchase_price} onChange={(e) => f('purchase_price', e.target.value)} placeholder="0" />
          </div>
          <div>
            <Label className={fieldLabel}>Наценка %</Label>
            <Input type="number" value={markup} onChange={(e) => setMarkup(e.target.value)} placeholder={purchase > 0 ? '0' : 'укажите закупку'} disabled={purchase <= 0} />
          </div>
          <div>
            <Label className={fieldLabel}>Цена продажи, ₸</Label>
            <Input type="number" min={0} value={form.sale_price} onChange={(e) => f('sale_price', e.target.value)} placeholder="0" />
          </div>
        </div>
      </div>

      {/* Прочее */}
      <div className="space-y-2">
        <div className={sectionLabel}>Прочее</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className={fieldLabel}>Уведомлять при остатке (алерт)</Label>
            <Input type="number" min={0} value={form.low_stock_threshold} onChange={(e) => f('low_stock_threshold', e.target.value)} placeholder="Не задан" />
          </div>
          <div className="flex items-end">
            <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.requires_expiry}
                onChange={(e) => onChange({ ...form, requires_expiry: e.target.checked })}
                className="h-4 w-4 accent-emerald-500"
              />
              <span className="text-muted-foreground">Требует срок годности</span>
              <span className="text-[11px] text-muted-foreground/70">(сними для бургеров/хотдогов)</span>
            </label>
          </div>
        </div>
      </div>

      <div className="flex gap-2 pt-1">
        <Button size="sm" onClick={onSave} disabled={loading || !form.name.trim() || !form.barcode.trim() || !!duplicateItem}>
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
  const { can, isSuperAdmin } = useCapabilities()
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
  const [toast, setToast] = useState<string | null>(null)

  // Filters (категория/тип/сортировка/точка — с памятью в localStorage; поиск не запоминаем)
  const [search, setSearch] = useState('')
  const [filterCategory, setFilterCategory] = usePersistentState('catalog.filterCategory', 'all')
  const [filterType, setFilterType] = usePersistentState('catalog.filterType', 'all')
  const [sortBy, setSortBy] = usePersistentState<'newest' | 'name'>('catalog.sortBy', 'newest')
  const [page, setPage] = useState(1)
  const [highlightId, setHighlightId] = useState<string | null>(null)

  // Инлайн-правка остатков из каталога — только суперадмин (на складе/витрине
  // у сотрудников остаётся своя правка по праву store-warehouse.edit)
  const canEditStock = isSuperAdmin
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [filterCompany, setFilterCompany] = usePersistentState('catalog.filterCompany', 'all')
  const [editingQty, setEditingQty] = useState<{ id: string; field: 'wh' | 'sh' } | null>(null)
  const [editQtyVal, setEditQtyVal] = useState('')
  const [savingQty, setSavingQty] = useState(false)
  const effectiveCompanyId = filterCompany !== 'all' ? filterCompany : (companies.length === 1 ? companies[0].id : null)

  // Edit / add
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<ItemFormData>(EMPTY_FORM)
  const [editInitial, setEditInitial] = useState<ItemFormData | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [addForm, setAddForm] = useState<ItemFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const addNameRef = useRef<HTMLInputElement>(null)

  // Защита несохранённой формы (закрытие крестиком/кликом мимо/Отмена)
  const addDirty = JSON.stringify(addForm) !== JSON.stringify(EMPTY_FORM)
  const guardAddClose = useUnsavedGuard(showAdd && addDirty)
  const editDirty = editingId !== null && editInitial !== null && JSON.stringify(editForm) !== JSON.stringify(editInitial)
  const guardEditClose = useUnsavedGuard(editDirty)

  // Массовые действия: выбор чекбоксами + смена категории + печать ценников
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set())
  const [bulkCategoryId, setBulkCategoryId] = useState('')
  const [bulkAssigning, setBulkAssigning] = useState(false)
  const [labelItems, setLabelItems] = useState<LabelItem[] | null>(null)

  // Import
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importRows, setImportRows] = useState<ImportRow[]>([])
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [importStatus, setImportStatus] = useState<'idle' | 'parsing' | 'previewing' | 'importing' | 'done'>('idle')
  const [importResult, setImportResult] = useState<{ created: number; updated: number; stock_updated?: number } | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Карточка товара (модалка по клику на товар)
  const [cardItemId, setCardItemId] = useState<string | null>(null)

  const [bulkDialog, setBulkDialog] = useState<null | 'deactivate' | 'deleteEmpty' | 'deleteAll' | 'resetBalances'>(null)
  const [bulkPhrase, setBulkPhrase] = useState('')
  const [bulkLoading, setBulkLoading] = useState(false)

  const showToast = (msg: string) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // SWR-кэш: повторное открытие каталога показывает прошлые данные мгновенно,
  // свежие подтягиваются фоном; после мутаций зовём loadItems() (refresh).
  const catalogUrl = `/api/admin/inventory/catalog${filterCompany !== 'all' ? `?company_id=${encodeURIComponent(filterCompany)}` : ''}`
  const { data: itemsData, loading, error, refresh: loadItems } = useApiCache<CatalogItem[]>(catalogUrl)
  const items = itemsData || []

  useEffect(() => {
    fetch('/api/admin/companies')
      .then((r) => r.json())
      .then((j) => setCompanies(j.data || []))
      .catch(() => {})
  }, [])

  async function saveQty(itemId: string) {
    if (!editingQty || !effectiveCompanyId) return
    const qty = parseFloat(editQtyVal.replace(',', '.'))
    if (!Number.isFinite(qty) || qty < 0) { showToast('Некорректное количество'); return }
    setSavingQty(true)
    try {
      const isWh = editingQty.field === 'wh'
      const res = await fetch(isWh ? '/api/admin/store/warehouse' : '/api/admin/store/showcase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: isWh ? 'setWarehouse' : 'setShowcase',
          company_id: effectiveCompanyId,
          item_id: itemId,
          quantity: qty,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка сохранения')
      setEditingQty(null)
      setEditQtyVal('')
      await loadItems()
      showToast('Остаток обновлён')
    } catch (e: any) {
      showToast('Ошибка: ' + e.message)
    } finally {
      setSavingQty(false)
    }
  }

  // Категории: полный список из API (можно создавать до товаров) + категории,
  // встречающиеся у товаров (легаси без organization_id)
  const { data: allCategories, refresh: refreshCategories } = useApiCache<{ id: string; name: string }[]>('/api/admin/inventory/categories')
  const categories = useMemo(() => {
    const map = new Map<string, { id: string; name: string }>()
    for (const c of allCategories || []) map.set(c.id, { id: c.id, name: c.name })
    for (const i of items) if (i.category) map.set(i.category.id, i.category)
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [allCategories, items])

  // Список штрихкодов для проверки дублей в ItemForm
  const barcodeIndex = useMemo(
    () => items.map((i) => ({ id: i.id, barcode: i.barcode, name: i.name })),
    [items],
  )

  // Управление категориями (диалог)
  const [showCatManager, setShowCatManager] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [catEditId, setCatEditId] = useState<string | null>(null)
  const [catEditName, setCatEditName] = useState('')
  const [catDeleteId, setCatDeleteId] = useState<string | null>(null)
  const [catBusy, setCatBusy] = useState(false)

  async function catAction(body: Record<string, unknown>): Promise<boolean> {
    setCatBusy(true)
    try {
      const res = await fetch('/api/admin/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || json?.error) throw new Error(json?.error || 'Ошибка')
      await refreshCategories()
      return true
    } catch (e: any) {
      showToast('Ошибка: ' + e.message)
      return false
    } finally {
      setCatBusy(false)
    }
  }

  async function addCategory() {
    const name = newCatName.trim()
    if (!name) return
    if (await catAction({ action: 'createCategory', payload: { name } })) {
      setNewCatName('')
      showToast('Категория создана')
    }
  }

  async function saveCatRename() {
    const name = catEditName.trim()
    if (!catEditId || !name) return
    if (await catAction({ action: 'updateCategory', id: catEditId, payload: { name } })) {
      setCatEditId(null)
      setCatEditName('')
      await loadItems()
    }
  }

  async function deleteCategory(id: string) {
    if (await catAction({ action: 'deleteCategory', id })) {
      setCatDeleteId(null)
      if (filterCategory === id) setFilterCategory('all')
      await loadItems()
      showToast('Категория удалена, товары — «Без категории»')
    }
  }

  const filtered = items.filter((item) => {
    if (filterType !== 'all' && item.item_type !== filterType) return false
    if (filterCategory !== 'all' && item.category?.id !== filterCategory) return false
    if (search) {
      const s = search.toLowerCase()
      if (!item.name.toLowerCase().includes(s) && !item.barcode.includes(s)) return false
    }
    return true
  })

  // API отдаёт по алфавиту; «Сначала новые» сортируем на клиенте по created_at
  const sorted = sortBy === 'newest'
    ? [...filtered].sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    : filtered

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE)
  const paginated = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => { setPage(1) }, [search, filterCategory, filterType, sortBy, filterCompany])
  // Смена точки = другой набор данных — сбрасываем выбор чекбоксами
  useEffect(() => { setSelectedItemIds(new Set()) }, [filterCompany])

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
    const form: ItemFormData = {
      name: item.name,
      barcode: item.barcode,
      unit: item.unit,
      sale_price: String(item.sale_price),
      purchase_price: String(item.default_purchase_price),
      category_id: item.category?.id || '',
      item_type: item.item_type || 'product',
      notes: item.notes || '',
      low_stock_threshold: item.low_stock_threshold != null ? String(item.low_stock_threshold) : '',
      requires_expiry: item.requires_expiry !== false,
    }
    setEditingId(item.id)
    setEditForm(form)
    setEditInitial(form)
  }

  // ── Selection / bulk category / labels ──────────────────────────────────────

  function toggleSelect(id: string) {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const allOnPageSelected = paginated.length > 0 && paginated.every((i) => selectedItemIds.has(i.id))

  function toggleSelectPage() {
    setSelectedItemIds((prev) => {
      const next = new Set(prev)
      if (allOnPageSelected) paginated.forEach((i) => next.delete(i.id))
      else paginated.forEach((i) => next.add(i.id))
      return next
    })
  }

  const selectedItems = items.filter((i) => selectedItemIds.has(i.id))

  function openLabelsForSelection() {
    const list = selectedItems.map((i): LabelItem => ({
      item_id: i.id,
      name: i.name,
      barcode: i.barcode,
      sale_price: i.sale_price ?? null,
      unit: i.unit || 'шт',
    }))
    if (list.length) setLabelItems(list)
  }

  async function assignCategoryBulk() {
    if (!bulkCategoryId || selectedItems.length === 0) return
    const catId = bulkCategoryId === '__none__' ? null : bulkCategoryId
    setBulkAssigning(true)
    let ok = 0
    let fail = 0
    try {
      // updateItem в /api/admin/inventory — полная замена карточки, поэтому шлём все поля товара
      for (const item of selectedItems) {
        try {
          const res = await fetch('/api/admin/inventory', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'updateItem',
              id: item.id,
              payload: {
                name: item.name,
                barcode: item.barcode,
                category_id: catId,
                sale_price: item.sale_price,
                default_purchase_price: item.default_purchase_price,
                unit: item.unit || 'шт',
                notes: item.notes,
                item_type: item.item_type,
                low_stock_threshold: item.low_stock_threshold,
              },
            }),
          })
          const j = await res.json().catch(() => null)
          if (!res.ok || j?.error) throw new Error(j?.error || 'Ошибка')
          ok++
        } catch {
          fail++
        }
      }
      setSelectedItemIds(new Set())
      setBulkCategoryId('')
      await loadItems()
      await refreshCategories()
      showToast(fail > 0 ? `Категория назначена: ${ok}, ошибок: ${fail}` : `Категория назначена: ${ok}`)
    } finally {
      setBulkAssigning(false)
    }
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
            requires_expiry: editForm.requires_expiry,
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
            requires_expiry: addForm.requires_expiry,
          },
        }),
      })
      const json2 = await res2.json()
      if (!res2.ok) throw new Error(json2.error)
      // Авто-фото: если штрихкод распознан и пришёл image_url — проставим на товар.
      const newItemId = String(json2?.data?.id || '').trim()
      const recogPhoto = (addForm.image_url || '').trim()
      if (newItemId && recogPhoto) {
        try {
          await fetch(`/api/admin/store/catalog/${newItemId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image_url: recogPhoto }),
          })
        } catch { /* фото опционально — не блокируем создание товара */ }
      }
      // Ценник для нового товара — данные формы фиксируем до сброса
      const newLabel: LabelItem | null = newItemId
        ? {
            item_id: newItemId,
            name: String(json2?.data?.name || addForm.name.trim()),
            barcode: String(json2?.data?.barcode || addForm.barcode.trim()),
            sale_price: parseFloat(addForm.sale_price) || 0,
            unit: addForm.unit.trim() || 'шт',
          }
        : null
      setShowAdd(false)
      setAddForm(EMPTY_FORM)
      await loadItems()
      // Показать новый товар сверху: сортировка «Сначала новые», сброс фильтров, подсветка строки
      setSortBy('newest')
      setSearch('')
      setFilterCategory('all')
      setFilterType('all')
      setPage(1)
      if (newItemId) {
        setHighlightId(newItemId)
        setTimeout(() => setHighlightId(null), 5000)
      }
      showToast('Товар добавлен')
      // Сразу открываем печать ценника/штрихкода для нового товара
      if (newLabel) setLabelItems([newLabel])
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
          <div className="rounded-2xl border border-border bg-white dark:bg-white/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Tag className="w-3.5 h-3.5 text-muted-foreground" />
              Позиций
            </div>
            <div className="text-xl font-bold text-foreground">{items.length.toLocaleString('ru-RU')}</div>
            {filtered.length !== items.length && (
              <div className="text-[11px] text-muted-foreground mt-0.5">в фильтре: {filtered.length}</div>
            )}
          </div>

          {/* Склад — закуп */}
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-blue-700/70 dark:text-blue-300/70 mb-1">
              <Warehouse className="w-3.5 h-3.5" />
              Склад по закупу
            </div>
            <div className="text-xl font-bold text-blue-700 dark:text-blue-300">
              {Math.round(totals.warehousePurchase).toLocaleString('ru-RU')} ₸
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{totals.warehouseQty.toLocaleString('ru-RU')} ед.</div>
          </div>

          {/* Склад — продажа */}
          <div className="rounded-2xl border border-blue-400/20 bg-blue-400/[0.04] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-blue-700/70 dark:text-blue-200/70 mb-1">
              <TrendingUp className="w-3.5 h-3.5" />
              Склад по продаже
            </div>
            <div className="text-xl font-bold text-blue-700 dark:text-blue-200">
              {Math.round(totals.warehouseSale).toLocaleString('ru-RU')} ₸
            </div>
            <div className="text-[11px] text-emerald-400/80 mt-0.5">
              +{Math.round(totals.warehouseSale - totals.warehousePurchase).toLocaleString('ru-RU')} ₸ наценка
            </div>
          </div>

          {/* Витрина — закуп */}
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-amber-700/70 dark:text-amber-300/70 mb-1">
              <Store className="w-3.5 h-3.5" />
              Витрина по закупу
            </div>
            <div className="text-xl font-bold text-amber-700 dark:text-amber-300">
              {Math.round(totals.showcasePurchase).toLocaleString('ru-RU')} ₸
            </div>
            <div className="text-[11px] text-muted-foreground mt-0.5">{totals.showcaseQty.toLocaleString('ru-RU')} ед.</div>
          </div>

          {/* Всего — продажа */}
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-emerald-700/70 dark:text-emerald-300/70 mb-1">
              <ShoppingCart className="w-3.5 h-3.5" />
              Итого по продаже
            </div>
            <div className="text-xl font-bold text-emerald-700 dark:text-emerald-300">
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
          {/* Add form — модальное окно */}
          <Dialog open={showAdd} onOpenChange={(open) => { if (!open) void guardAddClose(() => { setShowAdd(false); setAddForm(EMPTY_FORM) }) }}>
            <DialogContent
              className="max-h-[88vh] overflow-y-auto sm:max-w-2xl"
              onOpenAutoFocus={(e) => { e.preventDefault(); addNameRef.current?.focus() }}
            >
              <DialogHeader>
                <DialogTitle>Добавить товар</DialogTitle>
                <DialogDescription>Новая карточка товара в каталоге. Остаток добавляется через приёмку/оприходование.</DialogDescription>
              </DialogHeader>
              <ItemForm
                form={addForm}
                onChange={setAddForm}
                categories={categories}
                onSave={saveAdd}
                onCancel={() => void guardAddClose(() => { setShowAdd(false); setAddForm(EMPTY_FORM) })}
                loading={saving}
                existingItems={barcodeIndex}
                nameInputRef={addNameRef}
              />
            </DialogContent>
          </Dialog>

          {/* Редактирование товара — модалка, как у добавления */}
          <Dialog open={!!editingId} onOpenChange={(open) => { if (!open) void guardEditClose(() => setEditingId(null)) }}>
            <DialogContent
              className="max-h-[88vh] overflow-y-auto sm:max-w-2xl"
              onOpenAutoFocus={(e) => e.preventDefault()}
            >
              <DialogHeader>
                <DialogTitle>Редактировать товар</DialogTitle>
                <DialogDescription>{editForm.name || 'Карточка товара'}</DialogDescription>
              </DialogHeader>
              <ItemForm
                form={editForm}
                onChange={setEditForm}
                categories={categories}
                onSave={saveEdit}
                onCancel={() => void guardEditClose(() => setEditingId(null))}
                loading={saving}
                existingItems={barcodeIndex}
                excludeId={editingId ?? undefined}
                autoFocusName
              />
            </DialogContent>
          </Dialog>

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
                  onKeyDown={(e) => {
                    // Сканер-поиск: Enter + точное совпадение штрихкода → сразу карточка товара
                    if (e.key !== 'Enter') return
                    const code = search.trim()
                    if (!code) return
                    const hit = items.find((i) => i.barcode === code)
                    if (hit) {
                      setCardItemId(hit.id)
                      setSearch('')
                    }
                  }}
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
              {companies.length > 1 && (
                <Select value={filterCompany} onValueChange={setFilterCompany}>
                  <SelectTrigger className="h-8 text-sm w-[160px]">
                    <SelectValue placeholder="Точка" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все точки</SelectItem>
                    {companies.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'newest' | 'name')}>
                <SelectTrigger className="h-8 text-sm w-[150px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Сначала новые</SelectItem>
                  <SelectItem value="name">По названию (А-Я)</SelectItem>
                </SelectContent>
              </Select>
              {canEdit && (
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => setShowCatManager(true)}>
                  <Tag className="mr-1.5 h-3.5 w-3.5" />Категории
                </Button>
              )}
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

          {/* Панель массовых действий — видна при выбранных чекбоксами товарах */}
          {selectedItemIds.size > 0 && (
            <Card className="border-emerald-500/30 bg-emerald-500/[0.05] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">Выбрано: {selectedItemIds.size}</span>
                <Button variant="outline" size="sm" className="h-8 text-xs" onClick={openLabelsForSelection}>
                  <Printer className="mr-1.5 h-3.5 w-3.5" />
                  Ценники ({selectedItemIds.size})
                </Button>
                {canEdit && (
                  <>
                    <Select value={bulkCategoryId || undefined} onValueChange={setBulkCategoryId}>
                      <SelectTrigger className="h-8 w-[180px] text-sm">
                        <SelectValue placeholder="Категория" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Без категории</SelectItem>
                        {categories.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8 text-xs" disabled={!bulkCategoryId || bulkAssigning} onClick={() => void assignCategoryBulk()}>
                      {bulkAssigning ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Tag className="mr-1.5 h-3.5 w-3.5" />}
                      {bulkAssigning ? 'Назначаю...' : 'Назначить'}
                    </Button>
                  </>
                )}
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => setSelectedItemIds(new Set())}>
                  Снять выбор
                </Button>
              </div>
            </Card>
          )}

          {/* Table */}
          <Card className="border-border/70 overflow-hidden">
            {loading ? (
              <div className="p-4">
                <TableSkeleton rows={8} cols={6} />
              </div>
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
                      <th className="w-8 px-2 py-2.5 text-center">
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-emerald-500"
                          checked={allOnPageSelected}
                          onChange={toggleSelectPage}
                          title="Выбрать все на странице"
                        />
                      </th>
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
                        <tr className={`hover:bg-muted/20 transition-colors ${!item.is_active ? 'opacity-50' : ''} ${item.id === highlightId ? 'bg-emerald-500/10' : ''}`}>
                          <td className="w-8 px-2 py-2.5 text-center">
                            <input
                              type="checkbox"
                              className="h-4 w-4 cursor-pointer accent-emerald-500"
                              checked={selectedItemIds.has(item.id)}
                              onChange={() => toggleSelect(item.id)}
                            />
                          </td>
                          <td className="px-3 py-2.5 font-medium max-w-[260px]">
                            <button
                              type="button"
                              onClick={() => setCardItemId(item.id)}
                              className="flex items-center gap-2 text-left hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                              title="Открыть карточку товара"
                            >
                              {item.image_url ? (
                                <img src={item.image_url} alt="" className="h-8 w-8 shrink-0 rounded object-cover border border-border" />
                              ) : (
                                <span className="h-8 w-8 shrink-0 rounded bg-slate-100 dark:bg-white/[0.05]" />
                              )}
                              <span className="truncate hover:underline">{item.name}</span>
                            </button>
                            {item.item_type === 'consumable' && (
                              <Badge variant="outline" className="text-[10px] mt-0.5 h-4">расходник</Badge>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            <CopyText value={item.barcode} className="font-mono text-xs" />
                          </td>
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
                            {editingQty?.id === item.id && editingQty.field === 'wh' ? (
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  value={editQtyVal}
                                  onChange={(e) => setEditQtyVal(e.target.value)}
                                  className="h-7 w-16 px-1 text-center text-xs"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveQty(item.id)
                                    if (e.key === 'Escape') { setEditingQty(null); setEditQtyVal('') }
                                  }}
                                />
                                <button onClick={() => void saveQty(item.id)} disabled={savingQty} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 disabled:opacity-50">
                                  {savingQty ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => { setEditingQty(null); setEditQtyVal('') }} className="text-muted-foreground hover:text-rose-400">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                {canEditStock && effectiveCompanyId ? (
                                  <button
                                    onClick={() => { setEditingQty({ id: item.id, field: 'wh' }); setEditQtyVal(String(item.warehouse_qty)) }}
                                    className="inline-flex items-center gap-1 text-blue-400 font-medium hover:text-blue-500 transition-colors"
                                    title="Изменить остаток подсобки"
                                  >
                                    {item.warehouse_qty.toLocaleString('ru-RU')} {item.unit}
                                    <Pencil className="w-3 h-3 opacity-40" />
                                  </button>
                                ) : item.warehouse_qty > 0 ? (
                                  <div className="text-blue-400 font-medium">{item.warehouse_qty.toLocaleString('ru-RU')} {item.unit}</div>
                                ) : <span className="text-muted-foreground">—</span>}
                                {item.warehouse_qty > 0 && (
                                  <>
                                    <div className="text-[10px] text-muted-foreground">зак: {(item.warehouse_qty * item.default_purchase_price).toLocaleString('ru-RU')} ₸</div>
                                    <div className="text-[10px] text-muted-foreground">пр: {(item.warehouse_qty * item.sale_price).toLocaleString('ru-RU')} ₸</div>
                                  </>
                                )}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {editingQty?.id === item.id && editingQty.field === 'sh' ? (
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  value={editQtyVal}
                                  onChange={(e) => setEditQtyVal(e.target.value)}
                                  className="h-7 w-16 px-1 text-center text-xs"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') void saveQty(item.id)
                                    if (e.key === 'Escape') { setEditingQty(null); setEditQtyVal('') }
                                  }}
                                />
                                <button onClick={() => void saveQty(item.id)} disabled={savingQty} className="text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 disabled:opacity-50">
                                  {savingQty ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={() => { setEditingQty(null); setEditQtyVal('') }} className="text-muted-foreground hover:text-rose-400">
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-0.5">
                                {canEditStock && effectiveCompanyId ? (
                                  <button
                                    onClick={() => { setEditingQty({ id: item.id, field: 'sh' }); setEditQtyVal(String(item.showcase_qty)) }}
                                    className="inline-flex items-center gap-1 text-amber-400 font-medium hover:text-amber-500 transition-colors"
                                    title="Изменить остаток витрины"
                                  >
                                    {item.showcase_qty.toLocaleString('ru-RU')} {item.unit}
                                    <Pencil className="w-3 h-3 opacity-40" />
                                  </button>
                                ) : item.showcase_qty > 0 ? (
                                  <div className="text-amber-400 font-medium">{item.showcase_qty.toLocaleString('ru-RU')} {item.unit}</div>
                                ) : <span className="text-muted-foreground">—</span>}
                                {item.showcase_qty > 0 && (
                                  <>
                                    <div className="text-[10px] text-muted-foreground">зак: {(item.showcase_qty * item.default_purchase_price).toLocaleString('ru-RU')} ₸</div>
                                    <div className="text-[10px] text-muted-foreground">пр: {(item.showcase_qty * item.sale_price).toLocaleString('ru-RU')} ₸</div>
                                  </>
                                )}
                              </div>
                            )}
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
                              <button
                                onClick={() => setCardItemId(item.id)}
                                className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                                title="Карточка товара"
                              >
                                <Package className="w-3.5 h-3.5" />
                              </button>
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
                      </Fragment>
                    ))}
                  </tbody>
                  {filtered.length > 0 && (
                    <tfoot>
                      <tr className="border-t-2 border-border/50 bg-muted/30">
                        <td colSpan={7} className="px-3 py-2.5 text-xs text-muted-foreground font-medium text-right">
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

      {/* Карточка товара — открывается по клику на название/иконку в таблице */}
      {/* Диалог управления категориями */}
      <Dialog open={showCatManager} onOpenChange={(v) => { if (!v) { setShowCatManager(false); setCatEditId(null); setCatDeleteId(null); setNewCatName('') } }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Tag className="h-4 w-4" />Категории товаров</DialogTitle>
            <DialogDescription>Создание, переименование и удаление. При удалении категории её товары остаются «Без категории».</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Название новой категории"
              onKeyDown={(e) => { if (e.key === 'Enter') void addCategory() }}
            />
            <Button onClick={() => void addCategory()} disabled={catBusy || !newCatName.trim()} className="shrink-0">
              {catBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="mr-1 h-4 w-4" />}Добавить
            </Button>
          </div>
          <div className="space-y-1.5">
            {categories.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Категорий пока нет — создайте первую выше</div>
            ) : (
              categories.map((c) => {
                const count = items.filter((i) => i.category?.id === c.id).length
                return (
                  <div key={c.id} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2">
                    {catEditId === c.id ? (
                      <>
                        <Input
                          value={catEditName}
                          onChange={(e) => setCatEditName(e.target.value)}
                          className="h-8 text-sm"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') void saveCatRename()
                            if (e.key === 'Escape') { setCatEditId(null); setCatEditName('') }
                          }}
                        />
                        <button onClick={() => void saveCatRename()} disabled={catBusy} className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-700 disabled:opacity-50">
                          {catBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </button>
                        <button onClick={() => { setCatEditId(null); setCatEditName('') }} className="p-1 text-muted-foreground hover:text-rose-400">
                          <X className="h-4 w-4" />
                        </button>
                      </>
                    ) : catDeleteId === c.id ? (
                      <>
                        <span className="flex-1 truncate text-sm">Удалить «{c.name}»?</span>
                        <Button size="sm" variant="outline" className="h-7 text-xs text-destructive border-destructive/40" disabled={catBusy} onClick={() => void deleteCategory(c.id)}>
                          {catBusy ? '...' : 'Удалить'}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setCatDeleteId(null)}>Отмена</Button>
                      </>
                    ) : (
                      <>
                        <span className="flex-1 truncate text-sm text-foreground">{c.name}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{count > 0 ? `${count} тов.` : '—'}</span>
                        <button onClick={() => { setCatEditId(c.id); setCatEditName(c.name); setCatDeleteId(null) }} className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-foreground" title="Переименовать">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {canDelete && (
                          <button onClick={() => { setCatDeleteId(c.id); setCatEditId(null) }} className="p-1 rounded text-muted-foreground hover:bg-muted hover:text-destructive" title="Удалить">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ProductCardModal
        itemId={cardItemId}
        open={cardItemId !== null}
        onOpenChange={(o) => { if (!o) setCardItemId(null) }}
        canEdit={canEdit}
        onSaved={() => void loadItems()}
      />

      {/* Печать ценников: массово по чекбоксам и автоматически для нового товара */}
      {labelItems && (
        <LabelPrintDialog items={labelItems} onClose={() => setLabelItems(null)} />
      )}
    </div>
  )
}

export default function CatalogPage() {
  return <InventoryLegacyRedirect href="/store/catalog" />
}
