'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import mammoth from 'mammoth'
import {
  AlertCircle,
  Barcode,
  CheckCircle2,
  ChevronDown,
  FileSpreadsheet,
  Loader2,
  Package,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Warehouse,
  X,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// ─── Types ────────────────────────────────────────────────────────────────────

type Category = { id: string; name: string }
type Company = { id: string; name: string; code: string | null }
type WarehouseLocation = { id: string; name: string; code: string | null; is_active: boolean }
type BalanceItem = {
  item_id: string
  quantity: number           // = catalog_quantity (backwards compat)
  catalog_quantity: number   // total (imported from Wipon)
  warehouse_quantity: number // physically in back storage
  showcase_quantity: number  // = catalog - warehouse (virtual)
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
  isNew?: boolean // not in catalog yet — needs to be created
}

type AddMode = 'barcode' | 'catalog' | 'excel'

// ─── Helpers ──────────────────────────────────────────────────────────────────

let keyCounter = 0
function nextKey() {
  keyCounter += 1
  return String(keyCounter)
}

function parseNum(v: string) {
  const n = Number(String(v).replace(',', '.').trim())
  return Number.isFinite(n) ? Math.max(0, n) : 0
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function WarehousePage() {
  const [companies, setCompanies] = useState<Company[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const [warehouse, setWarehouse] = useState<WarehouseLocation | null>(null)
  const [balances, setBalances] = useState<BalanceItem[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Add-stock panel
  const [addMode, setAddMode] = useState<AddMode>('barcode')
  const [lines, setLines] = useState<StockLine[]>([])
  const [saving, setSaving] = useState(false)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Barcode mode
  const [barcodeInput, setBarcodeInput] = useState('')
  const [barcodeLoading, setBarcodeLoading] = useState(false)
  const [barcodeResult, setBarcodeResult] = useState<'found' | 'not-found' | null>(null)
  const barcodeRef = useRef<HTMLInputElement>(null)

  // New item dialog (when barcode not found)
  const [newItemDialog, setNewItemDialog] = useState<{ barcode: string } | null>(null)
  const [newItemName, setNewItemName] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('шт')
  const [creatingItem, setCreatingItem] = useState(false)

  // Catalog mode
  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogItems, setCatalogItems] = useState<any[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  // Excel mode
  const [excelRows, setExcelRows] = useState<StockLine[]>([])
  const [excelError, setExcelError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Search / filter existing stock
  const [stockSearch, setStockSearch] = useState('')

  // Stock mode: add to existing or set (replace) quantity
  const [stockMode, setStockMode] = useState<'add' | 'set'>('add')

  // Inline warehouse allocation editing
  const [editingWarehouse, setEditingWarehouse] = useState<string | null>(null) // item_id being edited
  const [editWarehouseVal, setEditWarehouseVal] = useState('')
  const [savingWarehouse, setSavingWarehouse] = useState(false)

  // Selection + delete
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<'selected' | 'all' | null>(null)

  // ── Load data ────────────────────────────────────────────────────────────────

  const load = useCallback(async (companyId?: string | null) => {
    setLoading(true)
    setError(null)
    try {
      const id = companyId ?? selectedCompanyId
      const url = id ? `/api/admin/store/warehouse?company_id=${id}` : '/api/admin/store/warehouse'
      const res = await fetch(url, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка загрузки')
      const d = json.data
      setCompanies(d.companies || [])
      setSelectedCompanyId(d.selectedCompanyId)
      setWarehouse(d.warehouse)
      setBalances(d.balances || [])
      setCategories(d.categories || [])
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [selectedCompanyId])

  useEffect(() => { void load() }, [])

  // ── Catalog search ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (addMode !== 'catalog') return
    const t = setTimeout(async () => {
      if (!catalogSearch.trim() && !selectedCategory) { setCatalogItems([]); return }
      setCatalogLoading(true)
      try {
        const params = new URLSearchParams()
        if (catalogSearch.trim()) params.set('q', catalogSearch.trim())
        if (selectedCategory) params.set('category_id', selectedCategory)
        const res = await fetch(`/api/admin/inventory/catalog?${params}`, { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        setCatalogItems(json?.data?.items || [])
      } catch { setCatalogItems([]) }
      finally { setCatalogLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [catalogSearch, selectedCategory, addMode])

  // ── Barcode lookup ───────────────────────────────────────────────────────────

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
    } catch (err: any) {
      setBarcodeResult('not-found')
    } finally {
      setBarcodeLoading(false)
    }
  }

  // ── Create new item ──────────────────────────────────────────────────────────

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

  // ── Add line ─────────────────────────────────────────────────────────────────

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

  // ── Excel import ─────────────────────────────────────────────────────────────

  function parseRowsFromTable(rows: any[][]): StockLine[] {
    const parsed: StockLine[] = []
    // Detect header row: skip if first cell looks like header text (not a number or barcode)
    const startIdx = (() => {
      if (rows.length === 0) return 0
      const firstCell = String(rows[0][0] || '').trim().toLowerCase()
      // Header-like: contains letters but no long digit sequence (barcode)
      if (!/\d{8,}/.test(firstCell) && /[а-яёa-z№#]/i.test(firstCell)) return 1
      return 0
    })()

    for (let i = startIdx; i < rows.length; i++) {
      const row = rows[i]
      if (!row || row.every((c: any) => !String(c || '').trim())) continue

      // Try to find barcode (long digit sequence) and name and qty in the row
      let barcode = ''
      let name = ''
      let qty = 0
      let cost = 0
      let unit = 'шт'

      // Detect column layout by scanning values
      const cells = row.map((c: any) => String(c || '').trim())

      // If first cell is a small number (row index like 1,2,3...), shift columns
      const hasIndex = cells[0] !== '' && /^\d{1,3}$/.test(cells[0]) && Number(cells[0]) < 1000 && !cells[0].match(/^\d{8,}/)
      const offset = hasIndex ? 1 : 0

      // After optional index: name, barcode, qty OR barcode, name, qty
      const c0 = cells[offset] || ''
      const c1 = cells[offset + 1] || ''
      const c2 = cells[offset + 2] || ''
      const c3 = cells[offset + 3] || ''

      const isBarcodelike = (s: string) => /^\d{8,}$/.test(s.replace(/\s/g, ''))

      if (isBarcodelike(c1)) {
        // Layout: [idx?] Name | Barcode | Qty | Cost?
        name = c0
        barcode = c1.replace(/\s/g, '')
        qty = parseNum(c2)
        cost = parseNum(c3)
      } else if (isBarcodelike(c0)) {
        // Layout: [idx?] Barcode | Name | Qty | Cost?
        barcode = c0.replace(/\s/g, '')
        name = c1
        qty = parseNum(c2)
        cost = parseNum(c3)
      } else {
        // No barcode found — use name + qty only
        name = c0
        qty = parseNum(c1 || c2)
        cost = parseNum(c3)
      }

      // Try last cells for unit
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

    // ── DOCX ─────────────────────────────────────────────────────────────────
    if (ext === 'docx') {
      try {
        const arrayBuffer = await file.arrayBuffer()
        // Use mammoth to convert docx to plain text, then parse table-like structure
        const result = await mammoth.convertToHtml({ arrayBuffer })
        const html = result.value

        // Parse <table> → rows from HTML
        const parser = new DOMParser()
        const doc = parser.parseFromString(html, 'text/html')
        const tables = doc.querySelectorAll('table')

        if (tables.length === 0) {
          // No table — try to parse as list: each line = "name barcode qty"
          const lines = doc.body.textContent?.split('\n').map(l => l.trim()).filter(Boolean) || []
          const rows = lines.map(line => line.split(/\t|\s{2,}|;|,/).map(s => s.trim()))
          const parsed = parseRowsFromTable(rows)
          if (parsed.length === 0) {
            setExcelError('Таблица не найдена в документе. Убедитесь что в Word есть таблица с товарами.')
            return
          }
          setExcelRows(parsed)
          return
        }

        // Use first table
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
          setExcelError('Не найдено строк с данными в таблице Word.')
          return
        }
        setExcelRows(parsed)
      } catch (err: any) {
        setExcelError('Не удалось прочитать .docx: ' + (err?.message || 'ошибка'))
      }
      return
    }

    // ── XLSX / XLS / CSV ──────────────────────────────────────────────────────
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target?.result as ArrayBuffer)
        const wb = XLSX.read(data, { type: 'array' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        const parsed = parseRowsFromTable(rows)
        if (parsed.length === 0) {
          setExcelError('Не найдено строк с данными. Формат: Штрихкод | Название | Количество | Цена (опц)')
          return
        }
        setExcelRows(parsed)
      } catch {
        setExcelError('Не удалось прочитать файл. Поддерживаются .xlsx, .xls, .csv, .docx')
      }
    }
    reader.readAsArrayBuffer(file)
  }

  // ── Save stock ────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!selectedCompanyId) return
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)

    try {
      const source = addMode === 'excel' ? excelRows : lines

      // Send raw rows to server — it resolves barcodes and creates missing items in bulk (1 round-trip)
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
        setSaveError('Нет позиций с заполненным количеством')
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

  // ── Delete stock ─────────────────────────────────────────────────────────────

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

  // ── Set warehouse allocation (how many physically in back room) ───────────────

  async function handleSetWarehouse(itemId: string, qty: number) {
    if (!selectedCompanyId) return
    setSavingWarehouse(true)
    try {
      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'setWarehouse', company_id: selectedCompanyId, item_id: itemId, quantity: qty }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка')
      setBalances((prev) =>
        prev.map((b) =>
          b.item_id === itemId
            ? { ...b, warehouse_quantity: qty, showcase_quantity: Math.max(0, b.catalog_quantity - qty) }
            : b
        )
      )
    } catch (err: any) {
      alert(err?.message || 'Ошибка сохранения')
    } finally {
      setSavingWarehouse(false)
      setEditingWarehouse(null)
    }
  }

  // ── Filtered balances ─────────────────────────────────────────────────────────

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

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header */}
      <section className="rounded-3xl border border-amber-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.15),transparent_36%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(15,23,42,0.96))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
              <Warehouse className="h-3.5 w-3.5" />
              Склад точки
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-white">
              {warehouse ? warehouse.name : 'Склад'}
            </h1>
            <p className="mt-1 text-sm text-slate-400">Каталог товаров. Витрина = каталог − склад. Импортируйте из Wipon через Excel.</p>
          </div>

          {/* Company selector */}
          {companies.length > 1 && (
            <div className="flex flex-col gap-1">
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Точка</Label>
              <div className="relative">
                <select
                  value={selectedCompanyId || ''}
                  onChange={(e) => { setSelectedCompanyId(e.target.value); void load(e.target.value) }}
                  className="appearance-none rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 pr-8 text-sm text-foreground outline-none focus:border-amber-400/50"
                >
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-muted-foreground" />
              </div>
            </div>
          )}

          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-8 gap-1.5 self-start">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        </div>

        {/* Stats */}
        {(() => {
          const totalQty = balances.reduce((s, b) => s + Number(b.catalog_quantity || 0), 0)
          const totalPurchase = balances.reduce((s, b) => s + Number(b.catalog_quantity || 0) * Number(b.item?.default_purchase_price || 0), 0)
          const totalSale = balances.reduce((s, b) => s + Number(b.catalog_quantity || 0) * Number(b.item?.sale_price || 0), 0)
          const totalWarehouse = balances.reduce((s, b) => s + Number(b.warehouse_quantity || 0), 0)
          const totalShowcase = balances.reduce((s, b) => s + Number(b.showcase_quantity || 0), 0)
          const fmtMoney = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 0 })
          return (
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Каталог</p>
                <p className="mt-1.5 text-2xl font-semibold">{balances.length} поз.</p>
                <p className="text-xs text-muted-foreground">{totalQty} ед. всего</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
                <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Склад / витрина</p>
                <p className="mt-1.5 text-lg font-semibold text-amber-300">{totalWarehouse} <span className="text-sm text-muted-foreground">/ {totalShowcase}</span></p>
                <p className="text-[10px] text-muted-foreground">ед. в складе / на витрине</p>
              </div>
              <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-3">
                <p className="text-[11px] uppercase tracking-widest text-blue-300/70">По закупу</p>
                <p className="mt-1.5 text-xl font-semibold text-blue-200">{fmtMoney(totalPurchase)} ₸</p>
              </div>
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
                <p className="text-[11px] uppercase tracking-widest text-emerald-300/70">По продаже</p>
                <p className="mt-1.5 text-xl font-semibold text-emerald-200">{fmtMoney(totalSale)} ₸</p>
                {totalPurchase > 0 && <p className="text-xs text-emerald-400/70">+{fmtMoney(totalSale - totalPurchase)} ₸ маржа</p>}
              </div>
            </div>
          )
        })()}
      </section>

      <div className="grid gap-5 xl:grid-cols-[1fr_420px]">
        {/* LEFT: current stock table */}
        <Card className="border-white/10 bg-card/70">
          <CardHeader className="border-b border-white/10 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-sm mr-auto">
                <Package className="h-4 w-4 text-amber-300" />
                Текущие остатки
              </CardTitle>
              <div className="relative w-40">
                <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={stockSearch}
                  onChange={(e) => setStockSearch(e.target.value)}
                  placeholder="Поиск..."
                  className="h-7 pl-7 text-xs"
                />
              </div>
              {selectedIds.size > 0 && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-7 gap-1 text-xs"
                  onClick={() => setDeleteConfirm('selected')}
                  disabled={deleting}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Удалить выбранные ({selectedIds.size})
                </Button>
              )}
              {balances.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1 text-xs border-rose-500/30 text-rose-400 hover:bg-rose-500/10"
                  onClick={() => setDeleteConfirm('all')}
                  disabled={deleting}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Очистить склад
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex h-40 items-center justify-center gap-2 text-rose-400">
                <AlertCircle className="h-4 w-4" />
                <span className="text-sm">{error}</span>
              </div>
            ) : filteredBalances.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                {stockSearch ? 'Ничего не найдено' : 'Каталог пустой — загрузите товары справа'}
              </div>
            ) : (
              <div className="divide-y divide-white/[0.06]">
                {/* Select-all row */}
                <div className="flex items-center gap-3 px-4 py-2 bg-white/[0.02]">
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
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {selectedIds.size > 0 ? `Выбрано: ${selectedIds.size}` : 'Выбрать все'}
                  </span>
                </div>
                {filteredBalances.map((b) => (
                  <div
                    key={b.item_id}
                    className={`flex items-center gap-3 px-4 py-2.5 transition ${selectedIds.has(b.item_id) ? 'bg-rose-500/[0.06]' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="h-3.5 w-3.5 accent-amber-400 cursor-pointer shrink-0"
                      checked={selectedIds.has(b.item_id)}
                      onChange={(e) => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev)
                          e.target.checked ? next.add(b.item_id) : next.delete(b.item_id)
                          return next
                        })
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{b.item?.name || 'Товар'}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {b.item?.barcode || ''}
                        {b.item?.category ? ` · ${b.item.category.name}` : ''}
                      </p>
                    </div>
                    <div className="ml-3 shrink-0 flex gap-3 text-right">
                      <div>
                        <p className="text-[10px] text-muted-foreground">каталог</p>
                        <p className={`text-sm font-semibold ${Number(b.catalog_quantity) <= 0 ? 'text-rose-400' : 'text-foreground'}`}>
                          {b.catalog_quantity}
                        </p>
                      </div>
                      <div className="min-w-[52px]">
                        <p className="text-[10px] text-muted-foreground">склад</p>
                        {editingWarehouse === b.item_id ? (
                          <form
                            onSubmit={(e) => { e.preventDefault(); handleSetWarehouse(b.item_id, parseNum(editWarehouseVal)) }}
                            className="flex items-center gap-1"
                          >
                            <Input
                              value={editWarehouseVal}
                              onChange={(e) => setEditWarehouseVal(e.target.value)}
                              className="h-6 w-14 text-xs text-center px-1"
                              autoFocus
                              onBlur={() => { if (!savingWarehouse) setEditingWarehouse(null) }}
                            />
                          </form>
                        ) : (
                          <button
                            onClick={() => { setEditingWarehouse(b.item_id); setEditWarehouseVal(String(b.warehouse_quantity)) }}
                            className="text-sm font-semibold text-amber-300 hover:underline"
                            title="Нажмите чтобы изменить"
                          >
                            {b.warehouse_quantity}
                          </button>
                        )}
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground">витрина</p>
                        <p className={`text-sm font-semibold ${Number(b.showcase_quantity) <= 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
                          {b.showcase_quantity}
                        </p>
                      </div>
                      <p className="text-[10px] text-muted-foreground self-end pb-0.5">{b.item?.unit || 'шт'}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* RIGHT: add stock panel */}
        <Card className="border-white/10 bg-card/70">
          <CardHeader className="border-b border-white/10 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <PackagePlus className="h-4 w-4 text-emerald-300" />
              Обновить каталог
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* Mode tabs */}
            <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-0.5 text-xs">
              {([['barcode', 'Штрихкод', Barcode], ['catalog', 'Каталог', Search], ['excel', 'Excel', FileSpreadsheet]] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  onClick={() => { setAddMode(mode); setLines([]); setExcelRows([]) }}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 transition ${addMode === mode ? 'bg-white/10 text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {/* ── BARCODE MODE ── */}
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

                {/* New item dialog */}
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
                        Создать и добавить
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setNewItemDialog(null); setBarcodeInput(''); setBarcodeResult(null) }}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── CATALOG MODE ── */}
            {addMode === 'catalog' && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      value={catalogSearch}
                      onChange={(e) => setCatalogSearch(e.target.value)}
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
                  {catalogLoading ? (
                    <div className="flex h-20 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
                  ) : catalogItems.length === 0 ? (
                    <p className="py-4 text-center text-xs text-muted-foreground">Введите название или выберите категорию</p>
                  ) : (
                    catalogItems.map((item: any) => (
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

            {/* ── EXCEL MODE ── */}
            {addMode === 'excel' && (
              <div className="space-y-2">
                <div
                  onClick={() => fileRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-white/[0.02] py-6 text-center transition hover:border-blue-400/40 hover:bg-white/[0.04]"
                >
                  <FileSpreadsheet className="h-8 w-8 text-blue-400" />
                  <p className="text-xs font-medium text-foreground">Нажмите чтобы загрузить файл</p>
                  <p className="text-[10px] text-muted-foreground">.xlsx / .xls / .csv / .docx</p>
                  <p className="text-[10px] text-muted-foreground">Формат: [№] Название | Штрихкод | Количество | Цена (опц)</p>
                </div>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.docx" className="hidden" onChange={handleExcelFile} />
                {excelError && <p className="text-xs text-rose-400">{excelError}</p>}
              </div>
            )}

            {/* Lines to save */}
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

            {/* Save button */}
            {pendingLines.length > 0 && (
              <div className="space-y-2">
                {/* Mode toggle */}
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
                      ? 'Количество прибавится к текущему остатку в каталоге'
                      : 'Остаток в каталоге будет заменён на указанное количество (синхронизация с Wipon)'}
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
                  {stockMode === 'set' ? 'Синхронизировать каталог' : 'Добавить в каталог'} ({pendingLines.filter((l) => parseNum(l.quantity) > 0).length} поз.)
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Confirm delete dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#111827] p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-500/15">
                <Trash2 className="h-5 w-5 text-rose-400" />
              </div>
              <div>
                <p className="font-semibold text-foreground">
                  {deleteConfirm === 'all' ? 'Очистить весь склад?' : `Удалить ${selectedIds.size} позиц.?`}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {deleteConfirm === 'all'
                    ? 'Все остатки на складе будут удалены. Это действие нельзя отменить.'
                    : 'Выбранные позиции будут удалены со склада.'}
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
                {deleteConfirm === 'all' ? 'Да, очистить' : 'Удалить'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
