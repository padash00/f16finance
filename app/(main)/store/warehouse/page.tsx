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
  Package,
  PackagePlus,
  Pencil,
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

type AddMode = 'barcode' | 'catalog' | 'excel' | 'backroom'

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
  const [catalogLoc, setCatalogLoc] = useState<LocationRef | null>(null)
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

  const [catalogSearch, setCatalogSearch] = useState('')
  const [catalogItems, setCatalogItems] = useState<any[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)

  const [excelRows, setExcelRows] = useState<StockLine[]>([])
  const [excelError, setExcelError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const [stockSearch, setStockSearch] = useState('')
  const [stockMode, setStockMode] = useState<'add' | 'set'>('add')

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<'selected' | 'all' | null>(null)

  const [editingWh, setEditingWh] = useState<string | null>(null)
  const [editWhVal, setEditWhVal] = useState('')
  const [savingWh, setSavingWh] = useState(false)

  const [backroomFileName, setBackroomFileName] = useState<string | null>(null)
  const [backroomParseError, setBackroomParseError] = useState<string | null>(null)
  const [backroomLoading, setBackroomLoading] = useState(false)
  const [backroomMatched, setBackroomMatched] = useState<BackroomMatchRow[]>([])
  const [backroomUnmatched, setBackroomUnmatched] = useState<BackroomUnmatchedRow[]>([])
  const [backroomApplying, setBackroomApplying] = useState(false)
  const [backroomDone, setBackroomDone] = useState<string | null>(null)
  const backroomFileRef = useRef<HTMLInputElement>(null)

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
      setCatalogLoc(d.catalog)
      setWarehouseLoc(d.warehouse)
      setBalances(d.balances || [])
      setCategories(d.categories || [])
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [selectedCompanyId])

  useEffect(() => { void load() }, [])

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
    setBackroomFileName(null)
    setBackroomParseError(null)
    setBackroomMatched([])
    setBackroomUnmatched([])
    setBackroomDone(null)
    if (backroomFileRef.current) backroomFileRef.current.value = ''
  }

  async function handleBackroomFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !selectedCompanyId) return
    e.target.value = ''
    setBackroomParseError(null)
    setBackroomMatched([])
    setBackroomUnmatched([])
    setBackroomDone(null)
    setBackroomFileName(file.name)
    setBackroomLoading(true)

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
        setBackroomParseError('Не найдено строк. Формат: Штрихкод | Название | Количество (последние две могут быть любыми из числовых).')
        setBackroomLoading(false)
        return
      }

      const items = parsed
        .filter((l) => l.barcode && parseNum(l.quantity) > 0)
        .map((l) => ({ barcode: l.barcode, quantity: parseNum(l.quantity), name: l.name || undefined }))

      if (items.length === 0) {
        setBackroomParseError('В файле нет строк с штрихкодом и количеством.')
        setBackroomLoading(false)
        return
      }

      const res = await fetch('/api/admin/store/warehouse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'previewBackroomUpload', company_id: selectedCompanyId, items }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка предпросмотра')
      setBackroomMatched(json.data?.matched || [])
      setBackroomUnmatched(json.data?.unmatched || [])
    } catch (err: any) {
      setBackroomParseError(err?.message || 'Не удалось обработать файл.')
    } finally {
      setBackroomLoading(false)
    }
  }

  async function handleBackroomApply() {
    if (!selectedCompanyId || backroomMatched.length === 0) return
    setBackroomApplying(true)
    try {
      const items = backroomMatched.map((m) => ({
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
      setBackroomDone(`Обновлено: ${json.data?.updated ?? items.length}`)
      await load(selectedCompanyId)
    } catch (err: any) {
      setBackroomParseError(err?.message || 'Не удалось применить.')
    } finally {
      setBackroomApplying(false)
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
        if (json?.error === 'warehouse-exceeds-catalog') {
          alert(`Склад не может быть больше каталога (${json.catalogQty})`)
        } else {
          alert(json?.error || 'Ошибка сохранения')
        }
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
    <div className="space-y-5">
      <section className="rounded-3xl border border-amber-500/20 bg-[radial-gradient(circle_at_top_left,rgba(245,158,11,0.15),transparent_36%),linear-gradient(180deg,rgba(17,24,39,0.96),rgba(15,23,42,0.96))] p-6 shadow-[0_18px_60px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/20 bg-amber-500/10 px-3 py-1 text-xs text-amber-300">
              <Warehouse className="h-3.5 w-3.5" />
              Склад точки
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-white">
              {warehouseLoc ? warehouseLoc.name : 'Склад'}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              Каталог — всего товаров. Склад — часть в подсобке. Витрина = каталог − склад.
            </p>
          </div>

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

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-muted-foreground">Позиций</p>
            <p className="mt-1.5 text-2xl font-semibold">{balances.length}</p>
          </div>
          <div className="rounded-2xl border border-sky-500/20 bg-sky-500/[0.06] px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-sky-300/70">Каталог</p>
            <p className="mt-1.5 text-2xl font-semibold text-sky-200">{totalCatalogQty}</p>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-amber-300/70">Склад</p>
            <p className="mt-1.5 text-2xl font-semibold text-amber-300">{totalWarehouseQty}</p>
          </div>
          <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.06] px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-emerald-300/70">Витрина</p>
            <p className="mt-1.5 text-2xl font-semibold text-emerald-300">{totalShowcaseQty}</p>
          </div>
          <div className="rounded-2xl border border-blue-500/20 bg-blue-500/[0.06] px-4 py-3">
            <p className="text-[11px] uppercase tracking-widest text-blue-300/70">Стоимость</p>
            <p className="mt-1.5 break-words text-sm font-semibold text-blue-200">{fmtMoney(totalPurchase)} / {fmtMoney(totalSale)} ₸</p>
            <p className="text-[10px] text-blue-400/70">закуп / продажа</p>
          </div>
        </div>
      </section>

      <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_430px]">
        <Card className="min-w-0 border-white/10 bg-card/70">
          <CardHeader className="border-b border-white/10 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle className="flex items-center gap-2 text-sm mr-auto">
                <Package className="h-4 w-4 text-amber-300" />
                Остатки
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
                  Удалить ({selectedIds.size})
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
                  Очистить
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
              <div>
                <div className="flex items-center gap-3 px-4 py-2 bg-white/[0.02] border-b border-white/[0.06]">
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
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">
                    {selectedIds.size > 0 ? `Выбрано: ${selectedIds.size}` : 'Товар'}
                  </span>
                  <span className="text-[10px] uppercase tracking-wider text-sky-300/70 w-16 text-right">Каталог</span>
                  <span className="text-[10px] uppercase tracking-wider text-amber-300/70 w-20 text-right">Склад</span>
                  <span className="text-[10px] uppercase tracking-wider text-emerald-300/70 w-16 text-right">Витрина</span>
                </div>
                <div className="divide-y divide-white/[0.06]">
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
                      <div className="shrink-0 w-16 text-right">
                        <p className="text-sm font-semibold text-sky-200">{b.catalog_quantity}</p>
                      </div>
                      <div className="shrink-0 w-20 text-right">
                        {editingWh === b.item_id ? (
                          <div className="flex items-center justify-end gap-1">
                            <Input
                              value={editWhVal}
                              onChange={(e) => setEditWhVal(e.target.value)}
                              className="h-6 w-12 text-xs text-center px-1"
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
                            className="flex items-center justify-end gap-1 text-sm font-semibold text-amber-300 hover:text-amber-200 w-full"
                          >
                            {b.warehouse_quantity}
                            <Pencil className="h-3 w-3 opacity-50" />
                          </button>
                        )}
                      </div>
                      <div className="shrink-0 w-16 text-right">
                        <p className="text-sm font-semibold text-emerald-300">{b.showcase_quantity}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="min-w-0 border-white/10 bg-card/70 2xl:sticky 2xl:top-4 2xl:self-start">
          <CardHeader className="border-b border-white/10 pb-3">
            <CardTitle className="flex items-center gap-2 text-sm">
              <PackagePlus className="h-4 w-4 text-emerald-300" />
              Обновить каталог
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1 text-xs">
              {([
                ['barcode', 'Штрихкод', Barcode],
                ['catalog', 'Каталог', Search],
                ['excel', 'Excel', FileSpreadsheet],
                ['backroom', 'Подсобка', Boxes],
              ] as const).map(([mode, label, Icon]) => (
                <button
                  key={mode}
                  onClick={() => {
                    setAddMode(mode)
                    setLines([])
                    setExcelRows([])
                    if (mode !== 'backroom') resetBackroom()
                  }}
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

            {addMode === 'backroom' && (
              <div className="space-y-3">
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-2.5 text-[11px] text-amber-200/90">
                  Загрузка остатков <b>в подсобку</b>. Сопоставление по штрихкоду — новые товары <b>не создаются</b>.
                  Каталог поднимется до warehouse, витрина = каталог − подсобка.
                </div>

                <div
                  onClick={() => backroomFileRef.current?.click()}
                  className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-white/20 bg-white/[0.02] py-5 text-center transition hover:border-amber-400/40 hover:bg-white/[0.04]"
                >
                  <Boxes className="h-7 w-7 text-amber-300" />
                  <p className="max-w-full break-all px-3 text-xs font-medium text-foreground">
                    {backroomFileName ? `Файл: ${backroomFileName}` : 'Загрузить Excel / DOCX с остатками подсобки'}
                  </p>
                  <p className="text-[10px] text-muted-foreground">Формат: Штрихкод | Название | Количество</p>
                </div>
                <input
                  ref={backroomFileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv,.docx"
                  className="hidden"
                  onChange={handleBackroomFile}
                  disabled={!selectedCompanyId || backroomLoading}
                />

                {backroomLoading && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Сопоставляю штрихкоды…
                  </p>
                )}

                {backroomParseError && <p className="text-xs text-rose-400">{backroomParseError}</p>}
                {backroomDone && (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> {backroomDone}
                  </p>
                )}

                {(backroomMatched.length > 0 || backroomUnmatched.length > 0) && (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider">
                      <span className="rounded-md border border-emerald-500/20 bg-emerald-500/[0.08] px-2 py-1 text-emerald-300/90">
                        Найдено: {backroomMatched.length}
                      </span>
                      <span className="rounded-md border border-rose-500/20 bg-rose-500/[0.08] px-2 py-1 text-rose-300/90">
                        Не найдено: {backroomUnmatched.length}
                      </span>
                      <button
                        type="button"
                        onClick={resetBackroom}
                        className="ml-auto text-muted-foreground hover:text-foreground"
                      >
                        Сбросить
                      </button>
                    </div>

                    {backroomMatched.length > 0 && (
                      <div className="max-h-80 overflow-auto rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04]">
                        <table className="min-w-[560px] w-full text-[11px]">
                          <thead className="sticky top-0 bg-[#0f172a]/95 backdrop-blur">
                            <tr className="text-left text-muted-foreground">
                              <th className="px-2 py-1.5 font-normal">Товар</th>
                              <th className="px-2 py-1.5 font-normal text-right">Каталог</th>
                              <th className="px-2 py-1.5 font-normal text-right">Подсобка</th>
                              <th className="px-2 py-1.5 font-normal text-right">Витрина</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.05]">
                            {backroomMatched.map((m) => {
                              const nameMismatch = m.excel_name && m.excel_name.trim().toLowerCase() !== m.catalog_name.trim().toLowerCase()
                              return (
                                <tr key={m.item_id} className="hover:bg-white/[0.03]">
                                  <td className="px-2 py-1.5 align-top">
                                    <div className="break-words font-medium">{m.catalog_name}</div>
                                    <div className="break-all text-[10px] font-mono text-muted-foreground">{m.barcode}</div>
                                    {nameMismatch && (
                                      <div className="break-words text-[10px] text-amber-300/80">
                                        В файле: «{m.excel_name}»
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-2 py-1.5 text-right align-top">
                                    <div className="text-sky-200 font-semibold">{m.new_catalog}</div>
                                    <div className="text-[10px] text-muted-foreground">
                                      было {m.current_catalog}
                                      {m.catalog_changed && <span className="text-amber-300/80"> ↑</span>}
                                    </div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right align-top">
                                    <div className="text-amber-300 font-semibold">{m.new_warehouse}</div>
                                    <div className="text-[10px] text-muted-foreground">было {m.current_warehouse}</div>
                                  </td>
                                  <td className="px-2 py-1.5 text-right align-top">
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

                    {backroomUnmatched.length > 0 && (
                      <details className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-2">
                        <summary className="cursor-pointer text-xs font-medium text-rose-200">
                          Не найдены по штрихкоду ({backroomUnmatched.length}) — будут пропущены
                        </summary>
                        <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-[11px]">
                          {backroomUnmatched.map((u, i) => (
                            <li key={`${u.barcode}-${i}`} className="grid grid-cols-[1fr,2fr,auto] items-start gap-2 text-muted-foreground">
                              <span className="break-all font-mono">{u.barcode}</span>
                              <span className="break-words">{u.name}</span>
                              <span className="text-rose-300">{u.quantity}</span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}

                    {backroomMatched.length > 0 && (
                      <Button
                        onClick={handleBackroomApply}
                        disabled={backroomApplying}
                        className="w-full bg-amber-600 hover:bg-amber-700"
                      >
                        {backroomApplying ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Boxes className="mr-2 h-4 w-4" />}
                        Применить ({backroomMatched.length} поз.)
                      </Button>
                    )}
                  </div>
                )}
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
                      ? 'Прибавится к каталогу (общий остаток магазина).'
                      : 'Остаток в каталоге будет заменён (синхронизация с Wipon).'}
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
          </CardContent>
        </Card>
      </div>

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
    </div>
  )
}
