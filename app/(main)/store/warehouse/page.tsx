'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import {
  AlertCircle,
  Barcode,
  Boxes,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
  MoreHorizontal,
  Package,
  PackagePlus,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  Search,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { isAbortError } from '@/lib/is-abort-error'
import { LabelPrintDialog } from '@/components/store/label-print-dialog'
import type { LabelItem } from '@/components/store/label-print-dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = { id: string; name: string }
type Company = { id: string; name: string; code: string | null }
type LocationRef = { id: string; name: string; code: string | null; is_active: boolean }
type BalanceItem = {
  item_id: string
  quantity: number // back-compat: catalog total
  catalog_quantity: number
  warehouse_quantity: number
  showcase_quantity: number
  updated_at: string
  item: {
    id: string
    name: string
    barcode: string
    unit: string
    sale_price: number
    default_purchase_price: number
    category_id: string | null
    category: { id: string; name: string } | null
  } | null
}

type StockLine = {
  key: string
  item_id: string
  name: string
  barcode: string
  unit: string
  quantity: string
  unit_cost: string
  isNew?: boolean
}

type AddMode = 'barcode' | 'items' | 'excel' | 'warehouseFile'

type BackroomMatchRow = {
  item_id: string
  barcode: string
  catalog_name: string
  excel_name: string | null
  unit: string
  current_catalog: number
  current_warehouse: number
  current_showcase: number
  new_warehouse: number
  new_catalog: number
  new_showcase: number
  catalog_changed: boolean
}

type BackroomUnmatchedRow = {
  barcode: string
  name: string
  quantity: number
}

let keyCounter = 0
function nextKey() {
  keyCounter += 1
  return String(keyCounter)
}

function parseNum(v: string) {
  const n = Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

export default function WarehousePage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [warehouseLoc, setWarehouseLoc] = useState<LocationRef | null>(null)
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [addMode, setAddMode] = useState<AddMode>('barcode')
  const [lines, setLines] = useState<StockLine[]>([])
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  const [barcodeResult, setBarcodeResult] = useState<'found' | 'not-found' | null>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)

  const [newItemDialog, setNewItemDialog] = useState<{ barcode: string } | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('шт')
  const [creatingItem, setCreatingItem] = useState(false)

  const [itemSearch, setItemSearch] = useState('')
  const [itemSearchResults, setItemSearchResults] = useState<any[]>([])
  const [itemSearchLoading, setItemSearchLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const [excelRows, setExcelRows] = useState<StockLine[]>([])
  const [excelError, setExcelError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [stockSearch, setStockSearch] = useState('')
  const [stockMode, setStockMode] = useState<'add' | 'set'>('add')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<'selected' | 'all' | null>(null)
  const [showPrintLabels, setShowPrintLabels] = useState(false)

  const [editingWh, setEditingWh] = useState<string | null>(null)
  const [editWhVal, setEditWhVal] = useState('')
  const [savingWh, setSavingWh] = useState(false)

  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [backroomSheetOpen, setBackroomSheetOpen] = useState(false)

  const [warehouseFileName, setWarehouseFileName] = useState<string | null>(null)
  const [warehouseFileError, setWarehouseFileError] = useState<string | null>(null)
  const [warehouseFileLoading, setWarehouseFileLoading] = useState(false)
  const [warehouseFileMatched, setWarehouseFileMatched] = useState<BackroomMatchRow[]>([])
  const [warehouseFileUnmatched, setWarehouseFileUnmatched] = useState<BackroomUnmatchedRow[]>([])
  const [warehouseFileApplying, setWarehouseFileApplying] = useState(false)
  const [warehouseFileDone, setWarehouseFileDone] = useState<string | null>(null)
  const warehouseFileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async (companyId?: string | null, signal?: AbortSignal) => {
    setLoading(true)
    setError(null)
    try {
      const id = companyId ?? selectedCompanyId
      const url = id ? `/api/admin/store/warehouse?company_id=${id}` : '/api/admin/store/warehouse'
      const res = await fetch(url, { cache: 'no-store', signal })
      const json = await res.json().catch(() => null)
      if (signal?.aborted) return
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка загрузки')
      const d = json.data
      setCompanies(d.companies || [])
      setSelectedCompanyId(d.selectedCompanyId)
      setWarehouseLoc(d.warehouse)
      setBalances(d.balances || [])
      setCategories(d.categories || [])
    } catch (e: any) {
      if (isAbortError(e) || signal?.aborted) return
      setError(e?.message || 'Ошибка')
    } finally {
      if (!signal?.aborted) setLoading(false)
    }
  }, [selectedCompanyId])

  useEffect(() => {
    const ac = new AbortController()
    try {
      const params = new URLSearchParams(window.location.search)
      const companyId = params.get('company_id')
      const q = params.get('q')
      if (q) setStockSearch(q)
      void load(companyId, ac.signal)
    } catch {
      void load(undefined, ac.signal)
    }
    return () => ac.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (addMode !== 'items') return
    const ac = new AbortController()
    const t = setTimeout(async () => {
      if (!itemSearch.trim() && !selectedCategory) { setItemSearchResults([]); return }
      setItemSearchLoading(true)
      try {
        const params = new URLSearchParams()
        if (itemSearch.trim()) params.set('q', itemSearch.trim())
        if (selectedCategory) params.set('category_id', selectedCategory)
        const res = await fetch(`/api/admin/inventory/catalog?${params}`, { cache: 'no-store', signal: ac.signal })
        const json = await res.json().catch(() => null)
        if (ac.signal.aborted) return
        setItemSearchResults(json?.data?.items || [])
      } catch (e) {
        if (isAbortError(e) || ac.signal.aborted) return
        setItemSearchResults([])
      } finally {
        if (!ac.signal.aborted) setItemSearchLoading(false)
      }
    }, 300)
    return () => {
      clearTimeout(t)
      ac.abort()
    }
  }, [itemSearch, selectedCategory, addMode])

  async function handleBarcodeLookup(e: React.FormEvent) {
    e.preventDefault()
    const bc = barcodeInput.trim()
    if (!bc) return
    setBarcodeLoading(true)
    setBarcodeResult(null)
    try {
      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'lookupBarcode', barcode: bc }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка поиска')
      if (json?.data?.item) {
        const item = json.data.item
        setBarcodeResult('found')
        addLine({
          key: nextKey(),
          item_id: item.id,
          name: item.name,
          barcode: item.barcode,
          unit: item.unit,
          quantity: '',
          unit_cost: String(item.default_purchase_price || 0),
        })
        setBarcodeInput('')
        setTimeout(() => { setBarcodeResult(null); barcodeRef.current?.focus() }, 1500)
      } else {
        setBarcodeResult('not-found')
        setNewItemDialog({ barcode: bc })
        setNewItemName('')
        setNewItemUnit('шт')
      }
    } catch {
      setBarcodeResult('not-found')
    } finally {
      setBarcodeLoading(false)
    }
  }

  async function handleCreateItem() {
    if (!newItemDialog || !newItemName.trim()) return
    setCreatingItem(true)
    try {
      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createItem',
          barcode: newItemDialog.barcode,
          name: newItemName.trim(),
          unit: newItemUnit,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Ошибка создания')
      const item = json.data.item
      addLine({
        key: nextKey(),
        item_id: item.id,
        name: item.name,
        barcode: item.barcode,
        unit: item.unit,
        quantity: '',
        unit_cost: '0',
      })
      setNewItemDialog(null)
      setBarcodeInput('')
      setBarcodeResult(null)
      setTimeout(() => barcodeRef.current?.focus(), 100)
    } catch (err: any) {
      alert(err?.message || 'Ошибка создания товара')
    } finally {
      setCreatingItem(false)
    }
  }

  function addLine(line: StockLine) {
    setLines((prev) => {
      const exists = prev.findIndex((l) => l.item_id === line.item_id)
      if (exists >= 0) {
        return prev.map((l, i) =>
          i === exists ? { ...l, quantity: String(parseNum(l.quantity) + 1) } : l,
        )
      }
      return [...prev, line]
    })
  }

  function addCatalogItem(item: any) {
    addLine({
      key: nextKey(),
      item_id: item.id,
      name: item.name,
      barcode: item.barcode,
      unit: item.unit,
      quantity: '1',
      unit_cost: String(item.default_purchase_price || 0),
    })
  }

  function parseRowsFromTable(rows: any[][]): StockLine[] {
    const parsed: StockLine[] = []
    const startIdx = (() => {
      if (rows.length === 0) return 0
      const firstCell = String(rows[0][0] || '').trim().toLowerCase()
      if (!/\d{8,}/.test(firstCell) && /[а-яёa-z№#]/i.test(firstCell)) return 1
      return 0
    })()

    for (let i = startIdx; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every((c: any) => !String(c || '').trim())) continue

      let barcode = ''
      let name = ''
      let qty = 0
      let cost = 0
      let unit = 'шт'

      const cells = row.map((c: any) => String(c || '').trim())
      const hasIndex = cells[0] !== '' && /^\d{1,3}$/.test(cells[0]) && Number(cells[0]) < 1000 && !cells[0].match(/^\d{8,}/)
      const offset = hasIndex ? 1 : 0

      const c0 = cells[offset] || ''
      const c1 = cells[offset + 1] || ''
      const c2 = cells[offset + 2] || ''
      const c3 = cells[offset + 3] || ''

      const isBarcodelike = (s: string) => /^\d{8,}$/.test(s.replace(/\s/g, ''))

      if (isBarcodelike(c1)) {
        name = c0
        barcode = c1.replace(/\s/g, '')
        qty = parseNum(c2)
        cost = parseNum(c3)
      } else if (isBarcodelike(c0)) {
        barcode = c0.replace(/\s/g, '')
        name = c1
        qty = parseNum(c2)
        cost = parseNum(c3)
      } else {
        name = c0
        qty = parseNum(c1 || c2)
        cost = parseNum(c3)
      }

      const lastCell = cells[cells.length - 1]
      if (lastCell && !/^\d/.test(lastCell) && lastCell.length < 10) unit = lastCell

      if (!name && !barcode) continue
      if (qty <= 0) continue

      parsed.push({
        key: nextKey(),
        item_id: '',
        name,
        barcode,
        unit,
        quantity: String(qty),
        unit_cost: String(cost),
        isNew: false,
      })
    }
    return parsed
  }

  async function handleExcelFile(e: React.ChangeEvent<HTMLInputElement>) {
    setExcelError(null)
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    const ext = file.name.split('.').pop()?.toLowerCase() || ''

    if (ext === 'docx') {
      try {
        const arrayBuffer = await file.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer })
        const html = result.value

        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        const tables = doc.querySelectorAll('table')

        if (tables.length === 0) {
          const lines = doc.body.textContent?.split('\n').map(l => l.trim()).filter(Boolean) || []
          const rows = lines.map(line => line.split(/\t|\s{2,}|;|,/).map(s => s.trim()))
          const parsed = parseRowsFromTable(rows)
          if (parsed.length === 0) {
            setExcelError('Таблица не найдена в документе.')
            return
          }
          setExcelRows(parsed)
          return
        }

        const table = tables[0]
        const rows: string[][] = []
        table.querySelectorAll('tr').forEach((tr) => {
          const cells: string[] = []
          tr.querySelectorAll('td, th').forEach((td) => {
            cells.push(td.textContent?.trim() || '')
          })
          rows.push(cells)
        })

        const parsed = parseRowsFromTable(rows)
        if (parsed.length === 0) {
          setExcelError('Не найдено строк с данными.')
          return
        }
        setExcelRows(parsed)
      } catch (err: any) {
        setExcelError('Не удалось прочитать .docx: ' + (err?.message || 'ошибка'))
      }
      return
    }

    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const parsed = parseRowsFromTable(rows)
        if (parsed.length === 0) {
          setExcelError('Не найдено строк. Формат: Штрихкод | Название | Количество | Цена')
          return
        }
        setExcelRows(parsed)
      } catch {
        setExcelError('Не удалось прочитать файл.')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  function resetBackroom() {
    setWarehouseFileName(null)
    setWarehouseFileError(null)
    setWarehouseFileMatched([])
    setWarehouseFileUnmatched([])
    setWarehouseFileDone(null)
    if (warehouseFileRef.current) warehouseFileRef.current.value = ''
  }

  async function handleBackroomFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selectedCompanyId) return
    e.target.value = ''
    setWarehouseFileError(null)
    setWarehouseFileMatched([])
    setWarehouseFileUnmatched([])
    setWarehouseFileDone(null)
    setWarehouseFileName(file.name)
    setWarehouseFileLoading(true)

    try {
      const ext = file.name.split('.').pop()?.toLowerCase() || ''
      let rows: any[][] = []
      if (ext === 'docx') {
        const arrayBuffer = await file.arrayBuffer()
        const result = await mammoth.convertToHtml({ arrayBuffer })
        const parser = new DOMParser()
        const doc = parser.parseFromString(result.value, 'text/html')
        const tables = doc.querySelectorAll('table')
        if (tables.length === 0) {
          const lines = doc.body.textContent?.split('\n').map((l) => l.trim()).filter(Boolean) || []
          rows = lines.map((line) => line.split(/\t|\s{2,}|;|,/).map((s) => s.trim()))
        } else {
          tables[0].querySelectorAll('tr').forEach((tr) => {
            const cells: string[] = []
            tr.querySelectorAll('td, th').forEach((td) => cells.push(td.textContent?.trim() || ''))
            rows.push(cells)
          })
        }
      } else {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' }) as any[][]
      }

      const parsed = parseRowsFromTable(rows)
      if (parsed.length === 0) {
        setWarehouseFileError('Не найдено строк. Формат: Штрихкод | Название | Количество (последние две могут быть любыми из числовых).')
        setWarehouseFileLoading(false)
        return
      }

      const items = parsed
        .filter((l) => l.barcode && parseNum(l.quantity) > 0)
        .map((l) => ({ barcode: l.barcode, quantity: parseNum(l.quantity), name: l.name || undefined }))

      if (items.length === 0) {
        setWarehouseFileError('В файле нет строк с штрихкодом и количеством.')
        setWarehouseFileLoading(false)
        return
      }

      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'previewBackroomUpload', company_id: selectedCompanyId, items }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка предпросмотра')
      setWarehouseFileMatched(json.data?.matched || [])
      setWarehouseFileUnmatched(json.data?.unmatched || [])
    } catch (err: any) {
      setWarehouseFileError(err?.message || 'Не удалось обработать файл.')
    } finally {
      setWarehouseFileLoading(false)
    }
  }

  async function handleBackroomApply() {
    if (!selectedCompanyId || warehouseFileMatched.length === 0) return
    setWarehouseFileApplying(true)
    try {
      const items = warehouseFileMatched.map((m) => ({
        item_id: m.item_id,
        new_warehouse: m.new_warehouse,
        new_catalog: m.new_catalog,
      }))
      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'applyBackroomUpload', company_id: selectedCompanyId, items }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка применения')
      setWarehouseFileDone(`Обновлено: ${json.data?.updated ?? items.length}`)
      await load(selectedCompanyId)
    } catch (err: any) {
      setWarehouseFileError(err?.message || 'Не удалось применить.')
    } finally {
      setWarehouseFileApplying(false)
    }
  }

  async function handleSave() {
    if (!selectedCompanyId) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const source = addMode === 'excel' ? excelRows : lines

      const items = source
        .filter((l) => parseNum(l.quantity) > 0)
        .map((l) => ({
          item_id: l.item_id || undefined,
          barcode: l.barcode || undefined,
          name: l.name || undefined,
          unit: l.unit || 'шт',
          quantity: parseNum(l.quantity),
          unit_cost: parseNum(l.unit_cost),
        }))

      if (items.length === 0) {
        setSaveError('Нет позиций с количеством')
        setSaving(false)
        return
      }

      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'addStock', company_id: selectedCompanyId, items, mode: stockMode }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка сохранения')

      setSaveSuccess(true)
      setLines([])
      setExcelRows([])
      await load(selectedCompanyId)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err: any) {
      setSaveError(err?.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(mode: 'selected' | 'all') {
    if (!selectedCompanyId) return
    setDeleting(true)
    setDeleteConfirm(null)
    try {
      const body: Record<string, unknown> = {
        action: 'deleteStock',
        company_id: selectedCompanyId,
      }
      if (mode === 'all') {
        body.delete_all = true
      } else {
        body.item_ids = Array.from(selectedIds)
      }
      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка удаления')
      setSelectedIds(new Set())
      await load(selectedCompanyId)
    } catch (err: any) {
      alert(err?.message || 'Ошибка удаления')
    } finally {
      setDeleting(false)
    }
  }

  async function handleSetWarehouse(itemId: string) {
    if (!selectedCompanyId) return
    const qty = parseNum(editWhVal)
    setSavingWh(true)
    try {
      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'setWarehouse',
          company_id: selectedCompanyId,
          item_id: itemId,
          quantity: qty,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        alert(json?.error || 'Ошибка сохранения')
        return
      }
      setEditingWh(null)
      setEditWhVal('')
      await load(selectedCompanyId)
    } finally {
      setSavingWh(false)
    }
  }

  const filteredBalances = balances.filter((b) => {
    if (!stockSearch.trim()) return true
    const q = stockSearch.toLowerCase()
    return (
      b.item?.name?.toLowerCase().includes(q) ||
      b.item?.barcode?.toLowerCase().includes(q)
    )
  })

  const pendingLines = addMode === 'excel' ? excelRows : lines
  const canSave = pendingLines.some((l) => parseNum(l.quantity) > 0)

  const totalCatalogQty = balances.reduce((s, b) => s + Number(b.catalog_quantity || 0), 0)
  const totalWarehouseQty = balances.reduce((s, b) => s + Number(b.warehouse_quantity || 0), 0)
  const totalShowcaseQty = balances.reduce((s, b) => s + Number(b.showcase_quantity || 0), 0)
  const totalPurchase = balances.reduce((s, b) => s + Number(b.catalog_quantity || 0) * Number(b.item?.default_purchase_price || 0), 0)
  const totalSale = balances.reduce((s, b) => s + Number(b.catalog_quantity || 0) * Number(b.item?.sale_price || 0), 0)
  const fmtMoney = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })

  return (
    <TooltipProvider delayDuration={200}>
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/20 bg-amber-500/10">
            <Warehouse className="h-5 w-5 text-amber-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">
              {warehouseLoc ? warehouseLoc.name : 'Склад'}
            </h1>
            <p className="truncate text-xs text-muted-foreground">
              Итого = подсобка + витрина
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {companies.length > 1 && (
            <div className="relative">
              <select
                value={selectedCompanyId || ''}
                onChange={(e) => { setSelectedCompanyId(e.target.value); void load(e.target.value) }}
                className="h-9 appearance-none rounded-lg border border-white/10 bg-white/[0.04] pl-3 pr-8 text-sm text-foreground outline-none focus:border-amber-400/50"
              >
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          )}
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setAddMode('warehouseFile'); setBackroomSheetOpen(true) }} className="h-9 gap-1.5">
            <Boxes className="h-3.5 w-3.5" />
            Файл подсобки
          </Button>
          <Button size="sm" onClick={() => { setAddMode('barcode'); setAddSheetOpen(true) }} className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700">
            <PackagePlus className="h-3.5 w-3.5" />
            Добавить товары
          </Button>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Позиций</p>
          <p className="mt-1 text-xl font-semibold">{balances.length}</p>
        </Card>
        <Card className="border-sky-500/20 bg-sky-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-sky-300/70">Итого</p>
          <p className="mt-1 text-xl font-semibold text-sky-200">{totalCatalogQty}</p>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-amber-300/70">Подсобка</p>
          <p className="mt-1 text-xl font-semibold text-amber-300">{totalWarehouseQty}</p>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">Витрина</p>
          <p className="mt-1 text-xl font-semibold text-emerald-300">{totalShowcaseQty}</p>
        </Card>
        <Card className="border-blue-500/20 bg-blue-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70">Стоимость (закуп / продажа)</p>
          <p className="mt-1 truncate text-sm font-semibold text-blue-200" title={`${fmtMoney(totalPurchase)} / ${fmtMoney(totalSale)} ₸`}>
            {fmtMoney(totalPurchase)} / {fmtMoney(totalSale)} ₸
          </p>
        </Card>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={stockSearch}
            onChange={(e) => setStockSearch(e.target.value)}
            placeholder="Поиск по названию или штрихкоду..."
            className="h-9 pl-9"
          />
        </div>
        {selectedIds.size > 0 && (
          <span className="rounded-md border border-rose-500/20 bg-rose-500/[0.06] px-2.5 py-1 text-xs text-rose-300">
            Выбрано: {selectedIds.size}
          </span>
        )}
        {selectedIds.size > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-9 gap-1.5"
            onClick={() => setShowPrintLabels(true)}
          >
            <Printer className="h-3.5 w-3.5" />
            Ценники ({selectedIds.size})
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-9 gap-1.5">
              <MoreHorizontal className="h-3.5 w-3.5" />
              Действия
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Операции со складом</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={selectedIds.size === 0 || deleting} onClick={() => setDeleteConfirm('selected')}>
              <Trash2 className="h-3.5 w-3.5" />
              Удалить выбранные ({selectedIds.size})
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={balances.length === 0 || deleting}
              onClick={() => setDeleteConfirm('all')}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Очистить весь склад
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Main table */}
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading ? (
          <div className="flex h-60 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-60 items-center justify-center gap-2 text-rose-400">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm">{error}</span>
          </div>
        ) : filteredBalances.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Package className="h-8 w-8 text-muted-foreground/50" />
            {stockSearch ? 'Ничего не найдено' : 'Каталог пустой — нажмите «Добавить товары»'}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-320px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-10 py-2.5 pl-4 pr-2">
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-amber-400 cursor-pointer"
                      checked={filteredBalances.length > 0 && filteredBalances.every((b) => selectedIds.has(b.item_id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds((prev) => new Set([...prev, ...filteredBalances.map((b) => b.item_id)]))
                        } else {
                          setSelectedIds((prev) => {
                            const next = new Set(prev)
                            filteredBalances.forEach((b) => next.delete(b.item_id))
                            return next
                          })
                        }
                      }}
                    />
                  </th>
                  <th className="py-2.5 px-2 font-normal">Товар</th>
                  <th className="w-36 py-2.5 px-2 font-normal">Штрихкод</th>
                  <th className="w-36 py-2.5 px-2 font-normal">Категория</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal text-sky-300/70">Итого</th>
                  <th className="w-28 py-2.5 px-2 text-right font-normal text-amber-300/70">Подсобка</th>
                  <th className="w-20 py-2.5 px-2 pr-4 text-right font-normal text-emerald-300/70">Витрина</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredBalances.map((b) => (
                  <tr
                    key={b.item_id}
                    className={`transition hover:bg-white/[0.02] ${selectedIds.has(b.item_id) ? 'bg-rose-500/[0.05]' : ''}`}
                  >
                    <td className="w-10 py-2.5 pl-4 pr-2 align-middle">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-amber-400 cursor-pointer"
                        checked={selectedIds.has(b.item_id)}
                        onChange={(e) => {
                          setSelectedIds((prev) => {
                            const next = new Set(prev)
                            e.target.checked ? next.add(b.item_id) : next.delete(b.item_id)
                            return next
                          })
                        }}
                      />
                    </td>
                    <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="truncate text-sm font-medium">{b.item?.name || 'Товар'}</p>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-md">
                          {b.item?.name || 'Товар'}
                        </TooltipContent>
                      </Tooltip>
                    </td>
                    <td className="w-36 py-2.5 px-2 align-middle">
                      <span className="truncate font-mono text-xs text-muted-foreground">{b.item?.barcode || '—'}</span>
                    </td>
                    <td className="w-36 py-2.5 px-2 align-middle">
                      <span className="line-clamp-1 text-xs text-muted-foreground">{b.item?.category?.name || '—'}</span>
                    </td>
                    <td className="w-20 py-2.5 px-2 text-right align-middle">
                      <span className="text-sm font-semibold text-sky-200">{b.catalog_quantity}</span>
                    </td>
                    <td className="w-28 py-2.5 px-2 text-right align-middle">
                      {editingWh === b.item_id ? (
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            value={editWhVal}
                            onChange={(e) => setEditWhVal(e.target.value)}
                            className="h-7 w-14 px-1 text-center text-xs"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void handleSetWarehouse(b.item_id)
                              if (e.key === 'Escape') { setEditingWh(null); setEditWhVal('') }
                            }}
                          />
                          <button
                            onClick={() => void handleSetWarehouse(b.item_id)}
                            disabled={savingWh}
                            className="text-emerald-400 hover:text-emerald-300 disabled:opacity-50"
                          >
                            {savingWh ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          </button>
                          <button
                            onClick={() => { setEditingWh(null); setEditWhVal('') }}
                            className="text-muted-foreground hover:text-rose-400"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingWh(b.item_id); setEditWhVal(String(b.warehouse_quantity)) }}
                          className="inline-flex items-center justify-end gap-1 text-sm font-semibold text-amber-300 hover:text-amber-200"
                        >
                          {b.warehouse_quantity}
                          <Pencil className="h-3 w-3 opacity-40" />
                        </button>
                      )}
                    </td>
                    <td className="w-20 py-2.5 px-2 pr-4 text-right align-middle">
                      <span className="text-sm font-semibold text-emerald-300">{b.showcase_quantity}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Add Sheet */}
      <Sheet open={addSheetOpen} onOpenChange={setAddSheetOpen}>
        <SheetContent className="w-full sm:max-w-xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b border-white/10 p-5">
            <SheetTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-emerald-300" />
              Добавить товары в подсобку
            </SheetTitle>
            <SheetDescription>
              Выберите способ ниже — можно собирать позиции из нескольких источников.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div className="grid grid-cols-3 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-xs">
              {([
                ['barcode', 'Штрихкод', Barcode],
                ['items', 'Каталог', Search],
                ['excel', 'Excel', FileSpreadsheet],
              ] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  onClick={() => { setAddMode(mode); setLines([]); setExcelRows([]) }}
                  className={`flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-2 transition ${addMode === mode ? 'bg-white/10 text-foreground font-medium shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]' : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground'}`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
              ))}
            </div>

            {addMode === 'barcode' && (
              <div className="space-y-3">
                <form onSubmit={handleBarcodeLookup} className="flex gap-2">
                  <div className="relative flex-1">
                    <Barcode className="absolute left-2.5 top-2 h-4 w-4 text-muted-foreground" />
                    <Input
                      ref={barcodeRef}
                      value={barcodeInput}
                      onChange={(e) => setBarcodeInput(e.target.value)}
                      placeholder="Введите или отсканируйте штрихкод"
                      className="h-8 pl-8 text-xs"
                      autoFocus
                    />
                  </div>
                  <Button type="submit" size="sm" disabled={barcodeLoading || !barcodeInput.trim()} className="h-8">
                    {barcodeLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                  </Button>
                </form>

                {barcodeResult === 'found' && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Товар найден в каталоге
                  </p>
                )}
                {barcodeResult === 'not-found' && !newItemDialog && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-400">
                    <AlertCircle className="h-3.5 w-3.5" /> Товар не найден в каталоге
                  </p>
                )}

                {newItemDialog && (
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 space-y-2">
                    <p className="text-xs font-medium text-amber-200">
                      Штрихкод <span className="font-mono">{newItemDialog.barcode}</span> не найден — создать новый товар?
                    </p>
                    <div className="grid grid-cols-[1fr_80px] gap-2">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Название</Label>
                        <Input
                          value={newItemName}
                          onChange={(e) => setNewItemName(e.target.value)}
                          placeholder="Название товара"
                          className="h-7 text-xs"
                          autoFocus
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-muted-foreground">Ед.</Label>
                        <Input
                          value={newItemUnit}
                          onChange={(e) => setNewItemUnit(e.target.value)}
                          placeholder="шт"
                          className="h-7 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="h-7 text-xs" onClick={handleCreateItem} disabled={creatingItem || !newItemName.trim()}>
                        {creatingItem ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                        Создать
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setNewItemDialog(null); setBarcodeInput(''); setBarcodeResult(null) }}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {addMode === 'items' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={itemSearch}
                      onChange={(e) => setItemSearch(e.target.value)}
                      placeholder="Поиск по каталогу..."
                      className="h-8 pl-8 text-xs"
                    />
                  </div>
                  {categories.length > 0 && (
                    <select
                      value={selectedCategory || ''}
                      onChange={(e) => setSelectedCategory(e.target.value || null)}
                      className="h-8 rounded-lg border border-input bg-background px-2 text-xs outline-none"
                    >
                      <option value="">Все категории</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="max-h-52 overflow-y-auto space-y-1 rounded-xl border border-white/10 bg-black/20 p-1">
                  {itemSearchLoading ? (
                    <div className="flex h-20 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : itemSearchResults.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">Введите название или выберите категорию</p>
                  ) : (
                    itemSearchResults.map((item: any) => (
                      <button
                        key={item.id}
                        onClick={() => addCatalogItem(item)}
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs hover:bg-white/[0.06] transition"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.name}</p>
                          <p className="text-[10px] text-muted-foreground">{item.barcode}</p>
                        </div>
                        <Plus className="ml-2 h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}

            {addMode === 'excel' && (
              <div className="space-y-2">
                <div
                  onClick={() => fileRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-white/[0.02] py-6 text-center transition hover:border-blue-400/40 hover:bg-white/[0.04]"
                >
                  <FileSpreadsheet className="h-8 w-8 text-blue-400" />
                  <p className="text-xs font-medium text-foreground">Нажмите чтобы загрузить файл</p>
                  <p className="text-[10px] text-muted-foreground">.xlsx / .xls / .csv / .docx</p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.docx" className="hidden" onChange={handleExcelFile} />
                {excelError && <p className="text-xs text-rose-400">{excelError}</p>}
              </div>
            )}

            {pendingLines.length > 0 && (
              <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-2 max-h-64 overflow-y-auto">
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground px-1">К добавлению ({pendingLines.length})</p>
                {pendingLines.map((line) => (
                  <div key={line.key} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{line.name || line.barcode}</p>
                      {line.barcode && <p className="text-[10px] text-muted-foreground font-mono">{line.barcode}</p>}
                    </div>
                    <Input
                      value={line.quantity}
                      onChange={(e) => {
                        const src = addMode === 'excel' ? setExcelRows : setLines
                        src((prev: StockLine[]) => prev.map((l) => l.key === line.key ? { ...l, quantity: e.target.value } : l))
                      }}
                      placeholder="Кол-во"
                      className="h-7 w-16 text-xs text-center"
                    />
                    <span className="text-[10px] text-muted-foreground w-6">{line.unit}</span>
                    <button
                      onClick={() => {
                        const src = addMode === 'excel' ? setExcelRows : setLines
                        src((prev: StockLine[]) => prev.filter((l) => l.key !== line.key))
                      }}
                      className="text-muted-foreground hover:text-rose-400 transition"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {pendingLines.length > 0 && (
              <div className="space-y-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-2.5 space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Режим сохранения</p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => setStockMode('add')}
                      className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${stockMode === 'add' ? 'bg-amber-500/20 border border-amber-500/40 text-amber-300' : 'border border-white/10 text-muted-foreground hover:bg-white/[0.04]'}`}
                    >
                      + Добавить к остатку
                    </button>
                    <button
                      type="button"
                      onClick={() => setStockMode('set')}
                      className={`rounded-lg px-2 py-1.5 text-xs font-medium transition ${stockMode === 'set' ? 'bg-blue-500/20 border border-blue-500/40 text-blue-300' : 'border border-white/10 text-muted-foreground hover:bg-white/[0.04]'}`}
                    >
                      = Установить остаток
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    {stockMode === 'add'
                      ? 'Прибавится к остатку подсобки.'
                      : 'Остаток подсобки будет заменён (синхронизация с Wipon).'}
                  </p>
                </div>

                {saveError && <p className="text-xs text-rose-400">{saveError}</p>}
                {saveSuccess && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {stockMode === 'set' ? 'Каталог обновлён!' : 'Добавлено в каталог!'}
                  </p>
                )}
                <Button
                  onClick={handleSave}
                  disabled={saving || !canSave}
                  className={`w-full ${stockMode === 'set' ? 'bg-blue-600 hover:bg-blue-700' : ''}`}
                >
                  {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PackagePlus className="mr-2 h-4 w-4" />}
                  {stockMode === 'set' ? 'Синхронизировать' : 'Добавить'} ({pendingLines.filter((l) => parseNum(l.quantity) > 0).length} поз.)
                </Button>
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Backroom file Sheet */}
      <Sheet open={backroomSheetOpen} onOpenChange={(o) => { setBackroomSheetOpen(o); if (!o) resetBackroom() }}>
        <SheetContent className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b border-white/10 p-5">
            <SheetTitle className="flex items-center gap-2">
              <Boxes className="h-5 w-5 text-amber-300" />
              Загрузка файла подсобки
            </SheetTitle>
            <SheetDescription>
              Сопоставление по штрихкоду. Новые товары не создаются. Каталог поднимется до warehouse, витрина = каталог − подсобка.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-3 overflow-y-auto p-5">
            <div
              onClick={() => warehouseFileRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-white/[0.02] py-6 text-center transition hover:border-amber-400/40 hover:bg-white/[0.04]"
            >
              <Boxes className="h-8 w-8 text-amber-300" />
              <p className="max-w-full break-all px-3 text-xs font-medium text-foreground">
                {warehouseFileName ? `Файл: ${warehouseFileName}` : 'Загрузить Excel / DOCX с остатками подсобки'}
              </p>
              <p className="text-[10px] text-muted-foreground">Формат: Штрихкод | Название | Количество</p>
            </div>
            <input
              ref={warehouseFileRef}
              type="file"
              accept=".xlsx,.xls,.csv,.docx"
              className="hidden"
              onChange={handleBackroomFile}
              disabled={!selectedCompanyId || warehouseFileLoading}
            />

            {warehouseFileLoading && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сопоставляю штрихкоды…
              </p>
            )}

            {warehouseFileError && <p className="text-xs text-rose-400">{warehouseFileError}</p>}
            {warehouseFileDone && (
              <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> {warehouseFileDone}
              </p>
            )}

            {(warehouseFileMatched.length > 0 || warehouseFileUnmatched.length > 0) && (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
                  <span className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.08] px-2 py-1 text-emerald-300/90">
                    Найдено: {warehouseFileMatched.length}
                  </span>
                  <span className="rounded-md border border-rose-500/20 bg-rose-500/[0.08] px-2 py-1 text-rose-300/90">
                    Не найдено: {warehouseFileUnmatched.length}
                  </span>
                  <button
                    type="button"
                    onClick={resetBackroom}
                    className="ml-auto text-muted-foreground hover:text-foreground"
                  >
                    Сбросить
                  </button>
                </div>

                {warehouseFileMatched.length > 0 && (
                  <div className="max-h-[50vh] overflow-auto rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
                    <table className="w-full text-[11px]">
                      <thead className="sticky top-0 bg-[#0f172a]/95 backdrop-blur">
                        <tr className="text-left text-muted-foreground">
                          <th className="px-2 py-1.5 font-normal">Товар</th>
                          <th className="w-20 px-2 py-1.5 font-normal text-right">Итого</th>
                          <th className="w-24 px-2 py-1.5 font-normal text-right">Подсобка</th>
                          <th className="w-20 px-2 py-1.5 font-normal text-right">Витрина</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/[0.05]">
                        {warehouseFileMatched.map((m) => {
                          const nameMismatch = m.excel_name && m.excel_name.trim().toLowerCase() !== m.catalog_name.trim().toLowerCase()
                          return (
                            <tr key={m.item_id} className="hover:bg-white/[0.03]">
                              <td className="min-w-0 max-w-0 px-2 py-1.5 align-top">
                                <div className="truncate font-medium" title={m.catalog_name}>{m.catalog_name}</div>
                                <div className="truncate text-[10px] font-mono text-muted-foreground">{m.barcode}</div>
                                {nameMismatch && (
                                  <div className="truncate text-[10px] text-amber-300/80" title={m.excel_name || ''}>
                                    В файле: «{m.excel_name}»
                                  </div>
                                )}
                              </td>
                              <td className="w-20 px-2 py-1.5 text-right align-top">
                                <div className="text-sky-200 font-semibold">{m.new_catalog}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  было {m.current_catalog}
                                  {m.catalog_changed && <span className="text-amber-300/80"> ↑</span>}
                                </div>
                              </td>
                              <td className="w-24 px-2 py-1.5 text-right align-top">
                                <div className="text-amber-300 font-semibold">{m.new_warehouse}</div>
                                <div className="text-[10px] text-muted-foreground">было {m.current_warehouse}</div>
                              </td>
                              <td className="w-20 px-2 py-1.5 text-right align-top">
                                <div className="text-emerald-300 font-semibold">{m.new_showcase}</div>
                                <div className="text-[10px] text-muted-foreground">было {m.current_showcase}</div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {warehouseFileUnmatched.length > 0 && (
                  <details className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-2">
                    <summary className="cursor-pointer text-xs font-medium text-rose-200">
                      Не найдены по штрихкоду ({warehouseFileUnmatched.length}) — будут пропущены
                    </summary>
                    <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
                      {warehouseFileUnmatched.map((u, i) => (
                        <li key={`${u.barcode}-${i}`} className="grid grid-cols-[1fr,2fr,auto] items-start gap-2 text-muted-foreground">
                          <span className="truncate font-mono" title={u.barcode}>{u.barcode}</span>
                          <span className="truncate" title={u.name}>{u.name}</span>
                          <span className="text-rose-300">{u.quantity}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}

                {warehouseFileMatched.length > 0 && (
                  <Button
                    onClick={handleBackroomApply}
                    disabled={warehouseFileApplying}
                    className="w-full bg-amber-600 hover:bg-amber-700"
                  >
                    {warehouseFileApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
                    Применить ({warehouseFileMatched.length} поз.)
                  </Button>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/15">
                <Trash2 className="h-5 w-5 text-rose-400" />
              </div>
              <div>
                <p className="font-semibold text-foreground">
                  {deleteConfirm === 'all' ? 'Очистить весь каталог?' : `Удалить ${selectedIds.size} поз.?`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Будут удалены остатки из каталога и склада. Это действие нельзя отменить.
                </p>
              </div>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" size="sm" onClick={() => setDeleteConfirm(null)} disabled={deleting}>
                Отмена
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleDelete(deleteConfirm)}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Trash2 className="mr-1.5 h-3.5 w-3.5" />}
                Удалить
              </Button>
            </div>
          </div>
        </div>
      )}

      {showPrintLabels && (
        <LabelPrintDialog
          items={balances
            .filter((b) => selectedIds.has(b.item_id) && b.item != null)
            .map((b): LabelItem => ({
              item_id: b.item_id,
              name: b.item!.name,
              barcode: b.item!.barcode,
              sale_price: b.item!.sale_price ?? null,
              unit: b.item!.unit ?? 'шт',
            }))}
          onClose={() => setShowPrintLabels(false)}
        />
      )}
    </div>
    </TooltipProvider>
  )
}
