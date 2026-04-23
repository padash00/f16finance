'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, MoreHorizontal, Package, PackagePlus, RefreshCw, Search, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
  sale_price: number
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
  sale_price: string
  markup_percent: string
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
  sale_price: '',
  markup_percent: '',
  comment: '',
})

function calcMarkupPercent(unitCostRaw: string, salePriceRaw: string) {
  const unitCost = parseMoney(unitCostRaw)
  const salePrice = parseMoney(salePriceRaw)
  if (unitCost <= 0) return ''
  const pct = ((salePrice - unitCost) / unitCost) * 100
  if (!Number.isFinite(pct)) return ''
  return String(Math.round((pct + Number.EPSILON) * 100) / 100)
}

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
  const [quickQuery, setQuickQuery] = useState('')
  const [quickError, setQuickError] = useState<string | null>(null)
  const quickInputRef = useRef<HTMLInputElement>(null)
  const [templateName, setTemplateName] = useState('')
  const [savedTemplates, setSavedTemplates] = useState<Array<{ name: string; lines: ReceiptLine[] }>>([])
  const [bulkMarkupPercent, setBulkMarkupPercent] = useState('')
  const [bulkSalePrice, setBulkSalePrice] = useState('')
  const [scope, setScope] = useState<'all' | 'warehouse' | 'showcase'>('all')
  const [formSheetOpen, setFormSheetOpen] = useState(false)
  const [receiptSearch, setReceiptSearch] = useState('')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/receipts?scope=${scope}`, { cache: 'no-store' })
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
    try {
      const params = new URLSearchParams(window.location.search)
      const q = params.get('q')
      if (q) setQuickQuery(q)
    } catch { /* ignore query parse errors */ }
    void load()
  }, [scope])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('store-receipts-templates-v1')
      if (!raw) return
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) setSavedTemplates(parsed)
    } catch { /* ignore parse errors */ }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem('store-receipts-templates-v1', JSON.stringify(savedTemplates))
    } catch { /* ignore write errors */ }
  }, [savedTemplates])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        quickInputRef.current?.focus()
        quickInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const receiptTotal = useMemo(() => {
    return lines.reduce((sum, line) => sum + parseQty(line.quantity) * parseMoney(line.unit_cost), 0)
  }, [lines])

  const quickMatches = useMemo(() => {
    const q = quickQuery.trim().toLowerCase()
    if (!q) return []
    return (data?.items || [])
      .filter((item) => {
        const barcode = String(item.barcode || '').toLowerCase()
        const name = String(item.name || '').toLowerCase()
        return barcode.includes(q) || name.includes(q)
      })
      .slice(0, 8)
  }, [data?.items, quickQuery])

  const upsertReceiptLine = (itemId: string, mode: 'increment' | 'set' = 'increment') => {
    const item = (data?.items || []).find((row) => row.id === itemId)
    if (!item) return false

    setLines((current) => {
      const existingIndex = current.findIndex((line) => line.item_id === itemId)
      if (existingIndex >= 0) {
        return current.map((line, idx) => {
          if (idx !== existingIndex) return line
          const currentQty = parseQty(line.quantity)
          const nextQty = mode === 'increment' ? currentQty + 1 : Math.max(1, currentQty)
          return {
            ...line,
            quantity: String(nextQty),
            unit_cost: line.unit_cost || String(item.default_purchase_price || ''),
            sale_price: line.sale_price || String(item.sale_price || ''),
            markup_percent:
              line.markup_percent || calcMarkupPercent(line.unit_cost || String(item.default_purchase_price || ''), line.sale_price || String(item.sale_price || '')),
          }
        })
      }

      const nextLine: ReceiptLine = {
        item_id: itemId,
        quantity: '1',
        unit_cost: String(item.default_purchase_price || ''),
        sale_price: String(item.sale_price || ''),
        markup_percent: calcMarkupPercent(String(item.default_purchase_price || ''), String(item.sale_price || '')),
        comment: '',
      }
      const hasOnlyEmpty = current.length === 1 && !current[0].item_id && !current[0].quantity && !current[0].unit_cost && !current[0].sale_price && !current[0].markup_percent && !current[0].comment
      if (hasOnlyEmpty) return [nextLine]
      return [...current, nextLine]
    })
    return true
  }

  const handleQuickAdd = () => {
    setQuickError(null)
    const q = quickQuery.trim()
    if (!q) return

    const exactBarcode = (data?.items || []).find((item) => String(item.barcode || '').trim() === q)
    if (exactBarcode) {
      upsertReceiptLine(exactBarcode.id, 'increment')
      setQuickQuery('')
      return
    }

    const byContains = (data?.items || []).filter((item) => {
      const barcode = String(item.barcode || '').toLowerCase()
      const name = String(item.name || '').toLowerCase()
      const query = q.toLowerCase()
      return barcode.includes(query) || name.includes(query)
    })

    if (byContains.length === 1) {
      upsertReceiptLine(byContains[0].id, 'increment')
      setQuickQuery('')
      return
    }

    if (byContains.length === 0) {
      setQuickError('Товар не найден. Проверь штрихкод или название.')
      return
    }

    setQuickError('Найдено несколько товаров — выбери ниже из подсказок.')
  }

  const createReceipt = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payloadItems = lines
      .map((line) => ({
        item_id: line.item_id,
        quantity: parseQty(line.quantity),
        unit_cost: parseMoney(line.unit_cost),
        sale_price: parseMoney(line.sale_price),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id && line.quantity > 0 && line.unit_cost >= 0 && line.sale_price >= 0)

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
      setSuccess('Приемка проведена. Остатки и цены обновлены везде.')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось провести приемку')
    } finally {
      setSaving(false)
    }
  }

  const saveTemplate = () => {
    const name = templateName.trim()
    if (!name) {
      setError('Введите название шаблона')
      return
    }
    const nonEmptyLines = lines.filter((line) => line.item_id && parseQty(line.quantity) > 0)
    if (nonEmptyLines.length === 0) {
      setError('Нет заполненных строк для шаблона')
      return
    }
    setSavedTemplates((prev) => {
      const rest = prev.filter((tpl) => tpl.name !== name)
      return [{ name, lines: nonEmptyLines }, ...rest].slice(0, 25)
    })
    setTemplateName('')
    setSuccess(`Шаблон «${name}» сохранён`)
  }

  const applyTemplate = (name: string) => {
    const tpl = savedTemplates.find((item) => item.name === name)
    if (!tpl) return
    setLines(tpl.lines.map((line) => ({ ...line })))
    setSuccess(`Шаблон «${name}» применён`)
  }

  const deleteTemplate = (name: string) => {
    setSavedTemplates((prev) => prev.filter((tpl) => tpl.name !== name))
  }

  const applyBulkMarkupPercent = () => {
    const pct = parseMoney(bulkMarkupPercent)
    setLines((prev) =>
      prev.map((line) => {
        if (!line.item_id) return line
        const base = parseMoney(line.unit_cost)
        const sale = base > 0 ? String(Math.round((base * (1 + pct / 100) + Number.EPSILON) * 100) / 100) : line.sale_price
        return { ...line, markup_percent: String(pct), sale_price: sale }
      }),
    )
  }

  const applyBulkSalePrice = () => {
    const sale = parseMoney(bulkSalePrice)
    setLines((prev) =>
      prev.map((line) => {
        if (!line.item_id) return line
        return {
          ...line,
          sale_price: String(sale),
          markup_percent: calcMarkupPercent(line.unit_cost, String(sale)),
        }
      }),
    )
  }

  const exportCsv = () => {
    const rows = lines
      .filter((line) => line.item_id)
      .map((line) => {
        const item = (data?.items || []).find((i) => i.id === line.item_id)
        return {
          name: item?.name || '',
          barcode: item?.barcode || '',
          quantity: line.quantity,
          unit_cost: line.unit_cost,
          sale_price: line.sale_price,
          markup_percent: line.markup_percent,
          comment: line.comment || '',
        }
      })
    if (rows.length === 0) return
    const headers = ['name', 'barcode', 'quantity', 'unit_cost', 'sale_price', 'markup_percent', 'comment']
    const csv = [headers.join(',')]
      .concat(rows.map((r) => headers.map((h) => `"${String((r as any)[h] ?? '').replace(/"/g, '""')}"`).join(',')))
      .join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `receipts-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const filteredReceipts = useMemo(() => {
    const q = receiptSearch.trim().toLowerCase()
    const list = data?.receipts || []
    if (!q) return list
    return list.filter((r) => {
      const parts = [
        r.supplier?.name,
        r.location?.name,
        r.invoice_number,
        r.comment,
        ...(r.items || []).map((i) => i.item?.name || ''),
      ]
      return parts.filter(Boolean).join(' ').toLowerCase().includes(q)
    })
  }, [data?.receipts, receiptSearch])

  const totalReceiptsAmount = useMemo(() => {
    return (data?.receipts || []).reduce((s, r) => s + Number(r.total_amount || 0), 0)
  }, [data?.receipts])

  return (
    <TooltipProvider delayDuration={200}>
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/10">
            <PackagePlus className="h-5 w-5 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-foreground">Приёмка</h1>
            <p className="truncate text-xs text-muted-foreground">Приходные документы от поставщиков</p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
            {(['all', 'warehouse', 'showcase'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setScope(s)}
                className={`rounded-md px-3 py-1.5 transition ${scope === s ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
              >
                {s === 'all' ? 'Все' : s === 'warehouse' ? 'Подсобка' : 'Витрина'}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          <Button
            size="sm"
            onClick={() => setFormSheetOpen(true)}
            className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
          >
            <PackagePlus className="h-3.5 w-3.5" />
            Новый документ
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Документов</p>
          <p className="mt-1 text-xl font-semibold">{(data?.receipts || []).length}</p>
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">Сумма всех приёмок</p>
          <p className="mt-1 truncate text-xl font-semibold text-emerald-200" title={formatMoney(totalReceiptsAmount)}>{formatMoney(totalReceiptsAmount)}</p>
        </Card>
        <Card className="border-blue-500/20 bg-blue-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70">Поставщиков</p>
          <p className="mt-1 text-xl font-semibold text-blue-200">{(data?.suppliers || []).length}</p>
        </Card>
      </div>

      {error ? (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-300">{error}</div>
      ) : null}
      {success ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-300">{success}</div>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={receiptSearch}
            onChange={(e) => setReceiptSearch(e.target.value)}
            placeholder="Поиск по поставщику, товару, накладной..."
            className="h-9 pl-9"
          />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" className="h-9 gap-1.5">
              <MoreHorizontal className="h-3.5 w-3.5" />
              Действия
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>Приёмка</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setFormSheetOpen(true)}>
              <PackagePlus className="h-4 w-4" />
              Новый документ
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                setSupplierId('')
                setInvoiceNumber('')
                setComment('')
                setLines([emptyLine()])
              }}
            >
              <Trash2 className="h-4 w-4" />
              Очистить форму
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
        ) : filteredReceipts.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Package className="h-8 w-8 opacity-50" />
            {receiptSearch ? 'Ничего не найдено' : 'Документов приёмки пока нет — нажмите «Новый документ»'}
          </div>
        ) : (
          <div className="max-h-[calc(100vh-380px)] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-24 py-2.5 pl-4 pr-2 font-normal">Дата</th>
                  <th className="py-2.5 px-2 font-normal">Поставщик</th>
                  <th className="w-40 py-2.5 px-2 font-normal">Локация</th>
                  <th className="w-32 py-2.5 px-2 font-normal">Накладная</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal">Позиций</th>
                  <th className="w-32 py-2.5 px-2 pr-4 text-right font-normal text-emerald-300/70">Сумма</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredReceipts.map((receipt) => (
                  <tr key={receipt.id} className="transition hover:bg-white/[0.02]">
                    <td className="w-24 py-2.5 pl-4 pr-2 align-middle">
                      <span className="text-xs text-muted-foreground">{formatDate(receipt.received_at)}</span>
                    </td>
                    <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="truncate text-sm font-medium">{receipt.supplier?.name || 'Без поставщика'}</p>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-md">
                          {receipt.supplier?.name || 'Без поставщика'}
                          {receipt.comment ? <div className="mt-1 text-xs text-muted-foreground">{receipt.comment}</div> : null}
                        </TooltipContent>
                      </Tooltip>
                      {receipt.comment ? (
                        <p className="truncate text-[11px] text-muted-foreground">{receipt.comment}</p>
                      ) : null}
                    </td>
                    <td className="w-40 py-2.5 px-2 align-middle">
                      <span className="line-clamp-1 text-xs text-muted-foreground">{receipt.location?.name || '—'}</span>
                    </td>
                    <td className="w-32 py-2.5 px-2 align-middle">
                      <span className="truncate font-mono text-xs text-muted-foreground">{receipt.invoice_number || '—'}</span>
                    </td>
                    <td className="w-20 py-2.5 px-2 text-right align-middle">
                      <span className="text-sm font-semibold">{(receipt.items || []).length}</span>
                    </td>
                    <td className="w-32 py-2.5 px-2 pr-4 text-right align-middle">
                      <span className="text-sm font-semibold text-emerald-300">{formatMoney(receipt.total_amount || 0)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create receipt Sheet */}
      <Sheet open={formSheetOpen} onOpenChange={setFormSheetOpen}>
        <SheetContent className="w-full sm:max-w-3xl flex flex-col gap-0 p-0">
          <SheetHeader className="border-b border-white/10 p-5">
            <SheetTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-emerald-300" />
              Новый документ приёмки
            </SheetTitle>
            <SheetDescription>
              Каталог, поставщик, дата и товарные строки. Приход увеличивает общий остаток и обновляет цены.
            </SheetDescription>
          </SheetHeader>
          <form onSubmit={createReceipt} className="flex-1 space-y-5 overflow-y-auto p-5">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  ref={quickInputRef}
                  value={quickQuery}
                  onChange={(event) => {
                    setQuickQuery(event.target.value)
                    if (quickError) setQuickError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleQuickAdd()
                    }
                  }}
                  placeholder="Сканируй штрихкод или введи название товара"
                  className="min-w-[260px] flex-1"
                />
                <Button type="button" onClick={handleQuickAdd}>
                  Добавить товар
                </Button>
              </div>
              <p className="mt-2 text-[11px] text-emerald-200/80">Горячая клавиша: Ctrl/Cmd + K — фокус на сканер</p>
              {quickError ? <p className="mt-2 text-xs text-rose-300">{quickError}</p> : null}
              {quickMatches.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {quickMatches.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        upsertReceiptLine(item.id, 'increment')
                        setQuickQuery('')
                        setQuickError(null)
                        quickInputRef.current?.focus()
                      }}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-slate-200 hover:bg-white/[0.08]"
                    >
                      {item.name} · {item.barcode}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Массовые операции по строкам</p>
              <div className="grid gap-2 md:grid-cols-2">
                <div className="flex gap-2">
                  <Input value={bulkMarkupPercent} onChange={(e) => setBulkMarkupPercent(e.target.value)} placeholder="Наценка % для всех" />
                  <Button type="button" variant="outline" onClick={applyBulkMarkupPercent}>Применить</Button>
                </div>
                <div className="flex gap-2">
                  <Input value={bulkSalePrice} onChange={(e) => setBulkSalePrice(e.target.value)} placeholder="Цена продажи для всех" />
                  <Button type="button" variant="outline" onClick={applyBulkSalePrice}>Применить</Button>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <p className="mb-2 text-xs uppercase tracking-[0.14em] text-slate-400">Шаблоны приемки</p>
              <div className="flex flex-wrap gap-2">
                <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Название шаблона" className="min-w-[220px] flex-1" />
                <Button type="button" variant="outline" onClick={saveTemplate}>Сохранить шаблон</Button>
                <Button type="button" variant="outline" onClick={exportCsv}>Экспорт CSV</Button>
              </div>
              {savedTemplates.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {savedTemplates.map((tpl) => (
                    <div key={tpl.name} className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs">
                      <button type="button" onClick={() => applyTemplate(tpl.name)} className="text-slate-200 hover:text-white">{tpl.name}</button>
                      <button type="button" onClick={() => deleteTemplate(tpl.name)} className="text-rose-300 hover:text-rose-200">×</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Куда</Label>
                <Select value={locationId} onValueChange={setLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите локацию" /></SelectTrigger>
                  <SelectContent>
                    {(data?.locations || []).map((location) => (
                      <SelectItem key={location.id} value={location.id}>
                        {location.location_type === 'warehouse' ? 'Подсобка' : 'Витрина'} · {location.name}
                      </SelectItem>
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

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-sm text-emerald-200">
              Цены применяются автоматически: закуп обновляет себестоимость, продажа и наценка синхронизируются по всем точкам.
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => (
                <div key={index} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:grid-cols-[minmax(0,1.4fr)_110px_130px_130px_110px_minmax(0,1fr)_auto]">
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
                              sale_price: selectedItem ? String(selectedItem.sale_price || '') : item.sale_price,
                              markup_percent: selectedItem
                                ? calcMarkupPercent(String(selectedItem.default_purchase_price || ''), String(selectedItem.sale_price || ''))
                                : item.markup_percent,
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
                    <Input
                      value={line.unit_cost}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  unit_cost: event.target.value,
                                  markup_percent: calcMarkupPercent(event.target.value, item.sale_price),
                                }
                              : item,
                          ),
                        )
                      }
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Цена продажи</Label>
                    <Input
                      value={line.sale_price}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...item,
                                  sale_price: event.target.value,
                                  markup_percent: calcMarkupPercent(item.unit_cost, event.target.value),
                                }
                              : item,
                          ),
                        )
                      }
                      placeholder="0"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Наценка %</Label>
                    <Input
                      value={line.markup_percent}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) => {
                            if (itemIndex !== index) return item
                            const pct = parseMoney(event.target.value)
                            const base = parseMoney(item.unit_cost)
                            const sale = base > 0 ? String(Math.round((base * (1 + pct / 100) + Number.EPSILON) * 100) / 100) : item.sale_price
                            return {
                              ...item,
                              markup_percent: event.target.value,
                              sale_price: sale,
                            }
                          }),
                        )
                      }
                      placeholder="0"
                    />
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
        </SheetContent>
      </Sheet>
    </div>
    </TooltipProvider>
  )
}
