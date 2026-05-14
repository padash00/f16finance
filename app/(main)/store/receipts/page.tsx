'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Loader2, MoreHorizontal, Package, PackagePlus, RefreshCw, Search, Sparkles, Trash2 } from 'lucide-react'
import { useCapabilities } from '@/lib/client/use-capabilities'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatMoney } from '@/lib/core/format'
import { StoreDataTableSkeleton } from '@/components/store/store-data-table-skeleton'
import { Skeleton } from '@/components/ui/skeleton'
import { isAbortError } from '@/lib/is-abort-error'

type InventoryLocation = {
  id: string
  name: string
  code: string | null
  location_type: 'warehouse' | 'point_display'
}

type InventorySupplier = {
  id: string
  name: string
  bin_iin: string | null
  organization_name: string | null
  preferred_expense_category_id?: string | null
}

type ExpenseCategoryOption = {
  id: string
  name: string
  accounting_group: string
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
  invoice_file_url: string | null
  comment: string | null
  status: 'posted' | 'cancelled'
  kind: 'supplier' | 'posting'
  cancelled_at: string | null
  cancel_reason: string | null
  supplier?: InventorySupplier | null
  location?: InventoryLocation | null
  items?: Array<{
    id: string
    quantity: number
    unit_cost: number
    total_cost: number
    is_bonus?: boolean
    item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  }>
}

type InventoryReceiptDraft = {
  id: string
  title: string | null
  payload: {
    location_id?: string | null
    supplier_id?: string | null
    supplier_create?: {
      name?: string
      organization_name?: string
      bin_iin?: string
    } | null
    received_at?: string | null
    invoice_number?: string | null
    invoice_file_url?: string | null
    expense_category_id?: string | null
    payment_method?: 'cash' | 'kaspi' | null
    comment?: string | null
    items?: Array<{
      item_id?: string
      quantity?: number | string
      unit_cost?: number | string
      sale_price?: number | string
      is_bonus?: boolean
      comment?: string | null
    }>
  }
  status: string
  created_at: string
  updated_at: string
}

type ReceiptsResponse = {
  ok: boolean
  data?: {
    items: InventoryItem[]
    suppliers: InventorySupplier[]
    locations: InventoryLocation[]
    receipts: InventoryReceipt[]
    drafts?: InventoryReceiptDraft[]
    expense_categories?: ExpenseCategoryOption[]
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
  is_bonus?: boolean
  invoice_name?: string
  last_unit_cost?: number | null
}

type AiParseItem = {
  invoice_name: string
  quantity: number
  unit_cost: number
  total_cost: number
  barcode: string | null
  matched_item_id: string | null
  matched_item_name: string | null
  match_source: 'barcode' | 'mapping' | 'mapping_supplier' | 'mapping_global' | 'gpt' | null
  last_unit_cost?: number | null
  last_sale_price?: number | null
  unit_cost_change_pct?: number | null
  manual_item_id?: string | null
}

type AiParseResult = {
  supplier_name: string | null
  invoice_number: string | null
  invoice_date: string | null
  raw_text: string | null
  total_amount: number
  matched_count: number
  unmatched_count: number
  cogs_suggestion?: {
    recommended_category_id: string | null
    recommended_category_name: string | null
    reason: string | null
    confidence?: 'high' | 'medium' | 'low' | null
    alternatives?: Array<{ id: string; name: string }>
  } | null
  items: AiParseItem[]
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
    invoice_file_url: raw?.invoice_file_url || null,
    comment: raw?.comment || null,
    status: raw?.status === 'cancelled' ? 'cancelled' : 'posted',
    kind: raw?.kind === 'posting' ? 'posting' : 'supplier',
    cancelled_at: raw?.cancelled_at || null,
    cancel_reason: raw?.cancel_reason || null,
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

function parseUnitCost(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 10000) / 10000
}

function parseQty(value: string) {
  const numeric = Number(String(value).replace(',', '.').trim())
  if (!Number.isFinite(numeric)) return 0
  return Math.round((numeric + Number.EPSILON) * 1000) / 1000
}

function formatUnitCost(value: number) {
  const normalized = Number(value || 0)
  if (!Number.isFinite(normalized)) return '0 ₸'
  const hasFraction = Math.abs(normalized - Math.round(normalized)) > 0.00001
  return `${normalized.toLocaleString('ru-RU', {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 4,
  })} ₸`
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
  is_bonus: false,
})

function calcMarkupPercent(unitCostRaw: string, salePriceRaw: string) {
  const unitCost = parseUnitCost(unitCostRaw)
  const salePrice = parseMoney(salePriceRaw)
  if (unitCost <= 0) return ''
  const pct = ((salePrice - unitCost) / unitCost) * 100
  if (!Number.isFinite(pct)) return ''
  return String(Math.round((pct + Number.EPSILON) * 100) / 100)
}

export default function StoreReceiptsPage() {
  const { can } = useCapabilities()
  const canCreate = can('store-receipts.create')
  const canEdit = can('store-receipts.edit')
  const canDelete = can('store-receipts.delete')
  const canCancel = can('store-receipts.cancel')
  const canExport = can('store-receipts.export')
  const canAiParse = can('store-receipts.ai_parse')
  const canSaveTemplate = can('store-receipts.save_template')

  const [data, setData] = useState<ReceiptsResponse['data'] | null>(null)
  const [debtByReceiptId, setDebtByReceiptId] = useState<Map<string, { status: 'open' | 'paid' | 'written_off'; total_amount: number; due_date: string | null; is_consignment: boolean }>>(new Map())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [locationId, setLocationId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [draftId, setDraftId] = useState<string | null>(null)
  const [supplierMode, setSupplierMode] = useState<'existing' | 'new'>('existing')
  const [supplierName, setSupplierName] = useState('')
  const [supplierOrganizationName, setSupplierOrganizationName] = useState('')
  const [supplierBinIin, setSupplierBinIin] = useState('')
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10))
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceFileUrl, setInvoiceFileUrl] = useState('')
  const [expenseCategoryId, setExpenseCategoryId] = useState('')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'kaspi'>('cash')
  const [paymentMode, setPaymentMode] = useState<'now' | 'deferred'>('now')
  const [paymentReceiptFileUrl, setPaymentReceiptFileUrl] = useState('')
  const [uploadingPaymentReceipt, setUploadingPaymentReceipt] = useState(false)
  const [isConsignment, setIsConsignment] = useState(false)
  const [dueDate, setDueDate] = useState('')
  const [expenseCategoriesFallback, setExpenseCategoriesFallback] = useState<ExpenseCategoryOption[]>([])
  const [uploadingInvoice, setUploadingInvoice] = useState(false)
  const [aiParsing, setAiParsing] = useState(false)
  const [aiParseResult, setAiParseResult] = useState<AiParseResult | null>(null)
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<ReceiptLine[]>([emptyLine()])
  const [quickQuery, setQuickQuery] = useState('')
  const [quickError, setQuickError] = useState<string | null>(null)
  const quickInputRef = useRef<HTMLInputElement>(null)
  const [templateName, setTemplateName] = useState('')
  const [savedTemplates, setSavedTemplates] = useState<Array<{ name: string; lines: ReceiptLine[] }>>([])
  const [bulkMarkupPercent, setBulkMarkupPercent] = useState('')
  const [bulkSalePrice, setBulkSalePrice] = useState('')
  const [showBulkTools, setShowBulkTools] = useState(false)
  const [showTemplatesTools, setShowTemplatesTools] = useState(false)
  const [scope, setScope] = useState<'all' | 'warehouse' | 'showcase'>('all')
  const [formSheetOpen, setFormSheetOpen] = useState(false)
  const [receiptSearch, setReceiptSearch] = useState('')
  const [selectedReceipt, setSelectedReceipt] = useState<InventoryReceipt | null>(null)
  const [receiptDetailsOpen, setReceiptDetailsOpen] = useState(false)

  const load = async (signal?: AbortSignal, opts?: { soft?: boolean }) => {
    const soft = Boolean(opts?.soft)
    if (soft) {
      setRefreshing(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/receipts?scope=${scope}`, { cache: 'no-store', signal })
      const json = (await response.json().catch(() => null)) as ReceiptsResponse | null
      if (signal?.aborted) return
      if (!response.ok || !json?.ok || !json.data) throw new Error(json?.error || 'Не удалось загрузить приемку')
      const normalized = {
        items: asArray(json.data.items),
        suppliers: asArray(json.data.suppliers),
        locations: asArray(json.data.locations),
        receipts: asArray(json.data.receipts).map(normalizeReceipt),
        drafts: asArray(json.data.drafts),
        expense_categories: asArray(json.data.expense_categories),
      }
      setData(normalized)
      setLocationId((current) => current || normalized.locations?.[0]?.id || '')

      // load debts and build a map by receipt_id
      try {
        const debtsResponse = await fetch('/api/admin/store/debts?status=all', { cache: 'no-store', signal })
        const debtsJson = await debtsResponse.json().catch(() => null)
        if (debtsResponse.ok && debtsJson?.ok && Array.isArray(debtsJson.data?.debts)) {
          const map = new Map<string, { status: 'open' | 'paid' | 'written_off'; total_amount: number; due_date: string | null; is_consignment: boolean }>()
          for (const d of debtsJson.data.debts) {
            if (d?.receipt_id) {
              map.set(String(d.receipt_id), {
                status: d.status,
                total_amount: Number(d.total_amount || 0),
                due_date: d.due_date || null,
                is_consignment: Boolean(d.is_consignment),
              })
            }
          }
          setDebtByReceiptId(map)
        }
      } catch {
        // non-fatal
      }
    } catch (err: any) {
      if (isAbortError(err) || signal?.aborted) return
      if (!soft) setData(null)
      setError(err?.message || 'Не удалось загрузить приемку')
    } finally {
      if (!signal?.aborted) {
        if (soft) setRefreshing(false)
        else setLoading(false)
      }
    }
  }

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const q = params.get('q')
      if (q) setQuickQuery(q)
    } catch { /* ignore query parse errors */ }
    const ac = new AbortController()
    void load(ac.signal)
    return () => ac.abort()
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
    if (expenseCategoryId) return
    const first = (data?.expense_categories || []).find((c) => String(c.accounting_group || '').trim().toLowerCase() === 'cogs')
      || expenseCategoriesFallback.find((c) => String(c.accounting_group || '').trim().toLowerCase() === 'cogs')
    if (first?.id) setExpenseCategoryId(first.id)
  }, [data?.expense_categories, expenseCategoriesFallback, expenseCategoryId])

  // Auto-pick supplier's preferred COGS category when supplier changes.
  useEffect(() => {
    if (!supplierId) return
    const supplier = (data?.suppliers || []).find((s) => s.id === supplierId)
    const preferred = supplier?.preferred_expense_category_id
    if (!preferred) return
    const isCogs = (data?.expense_categories || []).some(
      (c) => c.id === preferred && String(c.accounting_group || '').trim().toLowerCase() === 'cogs',
    )
    if (isCogs) setExpenseCategoryId(preferred)
  }, [supplierId, data?.suppliers, data?.expense_categories])

  useEffect(() => {
    const serverCogs = (data?.expense_categories || []).filter((c) => String(c.accounting_group || '').trim().toLowerCase() === 'cogs')
    if (serverCogs.length > 0) return
    let cancelled = false
    const loadExpenseCategories = async () => {
      try {
        const response = await fetch('/api/admin/expense-categories', { cache: 'no-store' })
        const json = await response.json().catch(() => null)
        if (!response.ok) return
        if (cancelled) return
        const rows = Array.isArray(json?.data) ? json.data : []
        setExpenseCategoriesFallback(rows as ExpenseCategoryOption[])
      } catch {
        if (!cancelled) setExpenseCategoriesFallback([])
      }
    }
    void loadExpenseCategories()
    return () => { cancelled = true }
  }, [data?.expense_categories])

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
    // Бонусные строки в сумму накладной не идут — товар получен бесплатно.
    return lines.reduce((sum, line) => sum + (line.is_bonus ? 0 : parseQty(line.quantity) * parseUnitCost(line.unit_cost)), 0)
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

  const cancelReceipt = async (receipt: InventoryReceipt) => {
    if (receipt.status === 'cancelled') return
    const reason = window.prompt(
      `Отменить приёмку от ${receipt.received_at} на сумму ${receipt.total_amount}? Укажите причину (опционально):`,
    )
    if (reason === null) return
    try {
      const response = await fetch('/api/admin/store/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'cancelReceipt',
          receipt_id: receipt.id,
          cancel_reason: reason || null,
        }),
      })
      const json = await response.json()
      if (!response.ok) {
        alert(json?.message || json?.error || 'Не удалось отменить приёмку')
        return
      }
      setReceiptDetailsOpen(false)
      setSelectedReceipt(null)
      await load(undefined, { soft: true })
    } catch (e: any) {
      alert(e?.message || 'Ошибка сети')
    }
  }

  const createReceipt = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSuccess(null)

    const payloadItems = lines
      .map((line) => ({
        item_id: line.item_id,
        quantity: parseQty(line.quantity),
        unit_cost: line.is_bonus ? 0 : parseUnitCost(line.unit_cost),
        sale_price: parseMoney(line.sale_price),
        is_bonus: Boolean(line.is_bonus),
        comment: line.comment.trim() || null,
        invoice_name: line.invoice_name?.trim() || null,
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
    if (!invoiceFileUrl) {
      setError('Загрузите файл накладной. Без документа приемка запрещена.')
      return
    }
    if (!expenseCategoryId) {
      setError('Выберите категорию расхода COGS для автодобавления')
      return
    }
    if (supplierMode === 'existing' && !supplierId) {
      setError('Выберите поставщика')
      return
    }
    if (supplierMode === 'new') {
      if (!supplierName.trim()) {
        setError('Введите название поставщика')
        return
      }
      if (!supplierOrganizationName.trim()) {
        setError('Введите название организации')
        return
      }
      const onlyDigits = supplierBinIin.replace(/\D/g, '')
      if (!/^\d{12}$/.test(onlyDigits)) {
        setError('ИИН/БИН должен состоять из 12 цифр')
        return
      }
    }

    setSaving(true)
    try {
      const response = await fetch('/api/admin/store/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createReceipt',
          draft_id: draftId,
          payload: {
            location_id: locationId,
            supplier_id: supplierMode === 'existing' ? supplierId || null : null,
            supplier_create: supplierMode === 'new'
              ? {
                  name: supplierName.trim(),
                  organization_name: supplierOrganizationName.trim(),
                  bin_iin: supplierBinIin.replace(/\D/g, ''),
                }
              : null,
            received_at: receivedAt,
            invoice_number: invoiceNumber.trim() || null,
            invoice_file_url: invoiceFileUrl,
            expense_category_id: expenseCategoryId || null,
            payment_method: paymentMethod,
            payment_mode: paymentMode,
            payment_receipt_file_url: paymentMode === 'now' ? paymentReceiptFileUrl || null : null,
            is_consignment: isConsignment,
            due_date: paymentMode === 'deferred' && dueDate ? dueDate : null,
            comment: comment.trim() || null,
            items: payloadItems,
          },
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось провести приемку')

      setSupplierId('')
      setDraftId(null)
      setSupplierMode('existing')
      setSupplierName('')
      setSupplierOrganizationName('')
      setSupplierBinIin('')
      setInvoiceNumber('')
      setInvoiceFileUrl('')
      setAiParseResult(null)
      setExpenseCategoryId('')
      setPaymentMethod('cash')
      setPaymentMode('now')
      setPaymentReceiptFileUrl('')
      setIsConsignment(false)
      setDueDate('')
      setComment('')
      setLines([emptyLine()])
      setSuccess('Приемка проведена. Остатки и цены обновлены везде.')
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось провести приемку')
    } finally {
      setSaving(false)
    }
  }

  const saveDraft = async () => {
    setError(null)
    setSuccess(null)
    const payloadItems = lines
      .map((line) => ({
        item_id: line.item_id,
        quantity: parseQty(line.quantity),
        unit_cost: line.is_bonus ? 0 : parseUnitCost(line.unit_cost),
        sale_price: parseMoney(line.sale_price),
        is_bonus: Boolean(line.is_bonus),
        comment: line.comment.trim() || null,
      }))
      .filter((line) => line.item_id)

    try {
      const response = await fetch('/api/admin/store/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'saveDraft',
          draft_id: draftId,
          draft_title: invoiceNumber.trim() || `Черновик ${new Date().toLocaleDateString('ru-RU')}`,
          payload: {
            location_id: locationId,
            supplier_id: supplierMode === 'existing' ? supplierId || null : null,
            supplier_create: supplierMode === 'new'
              ? {
                  name: supplierName.trim(),
                  organization_name: supplierOrganizationName.trim(),
                  bin_iin: supplierBinIin.replace(/\D/g, ''),
                }
              : null,
            received_at: receivedAt,
            invoice_number: invoiceNumber.trim() || null,
            invoice_file_url: invoiceFileUrl || null,
            expense_category_id: expenseCategoryId || null,
            payment_method: paymentMethod,
            payment_mode: paymentMode,
            payment_receipt_file_url: paymentReceiptFileUrl || null,
            is_consignment: isConsignment,
            due_date: dueDate || null,
            comment: comment.trim() || null,
            items: payloadItems,
          },
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить черновик')
      setDraftId(String(json?.data?.id || draftId || ''))
      setSuccess('Черновик сохранен')
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось сохранить черновик')
    }
  }

  const applyDraft = (draft: InventoryReceiptDraft) => {
    const payload = draft.payload || {}
    const items = Array.isArray(payload.items) ? payload.items : []
    setDraftId(draft.id)
    setLocationId(String(payload.location_id || ''))
    setReceivedAt(String(payload.received_at || new Date().toISOString().slice(0, 10)))
    setInvoiceNumber(String(payload.invoice_number || ''))
    setInvoiceFileUrl(String(payload.invoice_file_url || ''))
    setAiParseResult(null)
    setExpenseCategoryId(String(payload.expense_category_id || ''))
    setPaymentMethod(payload.payment_method === 'kaspi' ? 'kaspi' : 'cash')
    setPaymentMode((payload as any).payment_mode === 'deferred' ? 'deferred' : 'now')
    setPaymentReceiptFileUrl(String((payload as any).payment_receipt_file_url || ''))
    setIsConsignment(Boolean((payload as any).is_consignment))
    setDueDate(String((payload as any).due_date || ''))
    setComment(String(payload.comment || ''))
    if (payload.supplier_create?.bin_iin || payload.supplier_create?.organization_name || payload.supplier_create?.name) {
      setSupplierMode('new')
      setSupplierName(String(payload.supplier_create?.name || ''))
      setSupplierOrganizationName(String(payload.supplier_create?.organization_name || ''))
      setSupplierBinIin(String(payload.supplier_create?.bin_iin || ''))
      setSupplierId('')
    } else {
      setSupplierMode('existing')
      setSupplierId(String(payload.supplier_id || ''))
      setSupplierName('')
      setSupplierOrganizationName('')
      setSupplierBinIin('')
    }
    const mappedLines = items.length > 0
      ? items.map((item) => {
          const isBonus = Boolean((item as any).is_bonus)
          return {
            item_id: String(item.item_id || ''),
            quantity: String(item.quantity ?? ''),
            unit_cost: isBonus ? '0' : String(item.unit_cost ?? ''),
            sale_price: String(item.sale_price ?? ''),
            markup_percent: isBonus ? '' : calcMarkupPercent(String(item.unit_cost ?? ''), String(item.sale_price ?? '')),
            comment: String(item.comment || ''),
            is_bonus: isBonus,
          }
        })
      : [emptyLine()]
    setLines(mappedLines)
    setFormSheetOpen(true)
    setSuccess('Черновик загружен в форму')
  }

  const deleteDraft = async (id: string) => {
    try {
      const response = await fetch('/api/admin/store/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteDraft', draft_id: id }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось удалить черновик')
      if (draftId === id) setDraftId(null)
      await load(undefined, { soft: true })
    } catch (err: any) {
      setError(err?.message || 'Не удалось удалить черновик')
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
        const base = parseUnitCost(line.unit_cost)
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

  const uploadInvoice = async (file: File | null) => {
    if (!file) return
    setError(null)
    setUploadingInvoice(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/admin/store/receipts/upload', {
        method: 'POST',
        body: formData,
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить накладную')
      setInvoiceFileUrl(String(json.document_url || ''))
      setAiParseResult(null)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить накладную')
    } finally {
      setUploadingInvoice(false)
    }
  }

  const uploadPaymentReceipt = async (file: File | null) => {
    if (!file) return
    setError(null)
    setUploadingPaymentReceipt(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/admin/store/receipts/upload', {
        method: 'POST',
        body: formData,
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить чек')
      setPaymentReceiptFileUrl(String(json.document_url || ''))
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить чек')
    } finally {
      setUploadingPaymentReceipt(false)
    }
  }

  const runAiInvoiceParse = async () => {
    setError(null)
    setSuccess(null)
    if (!invoiceFileUrl) {
      setError('Сначала загрузите накладную, потом запустите ИИ-распознавание.')
      return
    }
    if (supplierMode === 'existing' && !supplierId) {
      setError('Выберите поставщика — без него ИИ не может использовать обученные алиасы.')
      return
    }
    if (supplierMode === 'new' && !supplierName.trim()) {
      setError('Заполните данные поставщика — без него ИИ не может использовать обученные алиасы.')
      return
    }
    setAiParsing(true)
    try {
      const response = await fetch('/api/admin/store/receipts/ai-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_file_url: invoiceFileUrl,
          supplier_id: supplierMode === 'existing' ? supplierId || null : null,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok || !json?.data) throw new Error(json?.error || 'ИИ не смог распознать накладную')
      const normalized = json.data as AiParseResult
      setAiParseResult({
        ...normalized,
        items: (normalized.items || []).map((item) => ({
          ...item,
          manual_item_id: item.matched_item_id || null,
        })),
      })
      setSuccess('ИИ распознал накладную. Проверьте и примените данные.')
    } catch (err: any) {
      setAiParseResult(null)
      setError(err?.message || 'Не удалось распознать накладную')
    } finally {
      setAiParsing(false)
    }
  }

  const applyAiParseResult = () => {
    if (!aiParseResult) return
    if (aiParseResult.supplier_name) {
      const normalizedName = aiParseResult.supplier_name.trim().toLowerCase()
      const existingSupplier = (data?.suppliers || []).find((s) => String(s.name || '').trim().toLowerCase() === normalizedName)
      if (existingSupplier) {
        setSupplierMode('existing')
        setSupplierId(existingSupplier.id)
        setSupplierName('')
        setSupplierOrganizationName('')
        setSupplierBinIin('')
      } else {
        setSupplierMode('new')
        setSupplierId('')
        setSupplierName(aiParseResult.supplier_name)
        setSupplierOrganizationName(aiParseResult.supplier_name)
      }
    }
    if (aiParseResult.invoice_number) setInvoiceNumber(aiParseResult.invoice_number)
    if (aiParseResult.invoice_date) setReceivedAt(aiParseResult.invoice_date)
    if (aiParseResult.cogs_suggestion?.recommended_category_id) {
      setExpenseCategoryId(aiParseResult.cogs_suggestion.recommended_category_id)
    }

    const parsedLines = (aiParseResult.items || [])
      .map((item) => ({ ...item, resolved_item_id: item.manual_item_id || item.matched_item_id }))
      .filter((item) => item.resolved_item_id && Number(item.quantity || 0) > 0)
      .map((item) => {
        const catalog = (data?.items || []).find((row) => row.id === item.resolved_item_id)
        const unitCost = Number(item.unit_cost || 0)
        const lastUnit = item.last_unit_cost != null ? Number(item.last_unit_cost) : null
        const lastSale = item.last_sale_price != null ? Number(item.last_sale_price) : null
        const fallbackCost = String(catalog?.default_purchase_price || '')
        const finalUnit = unitCost > 0 ? String(unitCost) : (lastUnit && lastUnit > 0 ? String(lastUnit) : fallbackCost)
        const finalSale = lastSale && lastSale > 0
          ? String(lastSale)
          : String(Number(catalog?.sale_price || 0) || '')
        return {
          item_id: String(item.resolved_item_id),
          quantity: String(item.quantity || ''),
          unit_cost: finalUnit,
          sale_price: finalSale,
          markup_percent: calcMarkupPercent(finalUnit, finalSale),
          comment: '',
          invoice_name: item.invoice_name || '',
          last_unit_cost: lastUnit,
        } as ReceiptLine
      })

    if (parsedLines.length > 0) {
      setLines(parsedLines)
      setSuccess(`Применено ${parsedLines.length} строк из распознанной накладной.`)
    } else {
      setError('ИИ не нашел сопоставленных товаров. Добавьте строки вручную.')
    }
  }

  const setAiManualItem = (index: number, itemId: string) => {
    setAiParseResult((current) => {
      if (!current) return current
      const nextItems = current.items.map((item, i) => (i === index ? { ...item, manual_item_id: itemId || null } : item))
      const matchedCount = nextItems.filter((item) => item.manual_item_id || item.matched_item_id).length
      return {
        ...current,
        items: nextItems,
        matched_count: matchedCount,
        unmatched_count: nextItems.length - matchedCount,
      }
    })
  }

  const applyAiCogsCategory = () => {
    const categoryId = aiParseResult?.cogs_suggestion?.recommended_category_id || ''
    if (!categoryId) return
    setExpenseCategoryId(categoryId)
    setSuccess('Категория COGS из AI-подсказки применена.')
  }

  const applySpecificCogsCategory = (categoryId: string, categoryName: string) => {
    if (!categoryId) return
    setExpenseCategoryId(categoryId)
    setSuccess(`Категория COGS «${categoryName}» применена.`)
  }

  const cogsConfidence = aiParseResult?.cogs_suggestion?.confidence || null
  const cogsConfidenceLabel = cogsConfidence === 'high'
    ? 'Высокая уверенность'
    : cogsConfidence === 'medium'
      ? 'Средняя уверенность'
      : cogsConfidence === 'low'
        ? 'Низкая уверенность'
        : 'Уверенность не определена'
  const cogsConfidenceClass = cogsConfidence === 'high'
    ? 'border-emerald-300/30 bg-emerald-400/15 text-emerald-100'
    : cogsConfidence === 'medium'
      ? 'border-amber-300/30 bg-amber-400/15 text-amber-100'
      : 'border-rose-300/30 bg-rose-400/15 text-rose-100'

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

  const cogsExpenseCategories = useMemo(() => {
    const fromServer = (data?.expense_categories || []).filter((c) => String(c.accounting_group || '').trim().toLowerCase() === 'cogs')
    if (fromServer.length > 0) return fromServer
    return expenseCategoriesFallback.filter((c) => String(c.accounting_group || '').trim().toLowerCase() === 'cogs')
  }, [data?.expense_categories, expenseCategoriesFallback])

  return (
    <TooltipProvider delayDuration={200}>
    <div className="app-page-wide space-y-6">
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
          <Button variant="outline" size="sm" onClick={() => void load(undefined, { soft: true })} disabled={loading || refreshing} className="h-9 gap-1.5">
            <RefreshCw className={`h-3.5 w-3.5 ${loading || refreshing ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          {canCreate && (
            <Button
              size="sm"
              onClick={() => setFormSheetOpen(true)}
              className="h-9 gap-1.5 bg-emerald-600 hover:bg-emerald-700"
            >
              <PackagePlus className="h-3.5 w-3.5" />
              Новый документ
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="border-white/10 bg-white/[0.03] p-3">
          <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Документов</p>
          {loading ? <Skeleton className="mt-1 h-7 w-14" /> : (
            <p className="mt-1 text-xl font-semibold">{(data?.receipts || []).length}</p>
          )}
        </Card>
        <Card className="border-emerald-500/20 bg-emerald-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-emerald-300/70">Сумма всех приёмок</p>
          {loading ? <Skeleton className="mt-1 h-7 w-28" /> : (
            <p className="mt-1 truncate text-xl font-semibold text-emerald-200" title={formatMoney(totalReceiptsAmount)}>{formatMoney(totalReceiptsAmount)}</p>
          )}
        </Card>
        <Card className="border-blue-500/20 bg-blue-500/[0.05] p-3">
          <p className="text-[10px] uppercase tracking-widest text-blue-300/70">Поставщиков</p>
          {loading ? <Skeleton className="mt-1 h-7 w-12" /> : (
            <p className="mt-1 text-xl font-semibold text-blue-200">{(data?.suppliers || []).length}</p>
          )}
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

      {(data?.drafts || []).length > 0 ? (
        <Card className="border-amber-500/20 bg-amber-500/[0.05] p-3">
          <p className="text-[11px] uppercase tracking-wider text-amber-300/80 mb-2">Черновики приемки</p>
          <div className="flex flex-wrap gap-2">
            {(data?.drafts || []).map((draft) => (
              <div key={draft.id} className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-black/20 px-3 py-1 text-xs">
                <button type="button" onClick={() => applyDraft(draft)} className="text-amber-200 hover:text-white">
                  {draft.title || 'Черновик'}
                </button>
                <button type="button" onClick={() => void deleteDraft(draft.id)} className="text-rose-300 hover:text-rose-100">×</button>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {/* Main table */}
      <Card className="overflow-hidden border-white/10 bg-card/70 p-0">
        {loading && filteredReceipts.length === 0 ? (
          <StoreDataTableSkeleton columns={7} />
        ) : filteredReceipts.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
            <Package className="h-8 w-8 opacity-50" />
            {receiptSearch ? 'Ничего не найдено' : 'Документов приёмки пока нет — нажмите «Новый документ»'}
          </div>
        ) : (
          <div className="relative max-h-[calc(100vh-380px)] overflow-auto">
            {refreshing ? (
              <div className="absolute inset-0 z-20 flex items-start justify-center bg-background/35 pt-10 backdrop-blur-[0.5px]">
                <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-md">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Обновление…
                </div>
              </div>
            ) : null}
            <div className={refreshing ? 'pointer-events-none opacity-50' : undefined}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-[#0f172a]/95 backdrop-blur">
                <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="w-24 py-2.5 pl-4 pr-2 font-normal">Дата</th>
                  <th className="py-2.5 px-2 font-normal">Поставщик</th>
                  <th className="w-40 py-2.5 px-2 font-normal">Локация</th>
                  <th className="w-32 py-2.5 px-2 font-normal">Накладная</th>
                  <th className="w-20 py-2.5 px-2 text-right font-normal">Позиций</th>
                  <th className="w-32 py-2.5 px-2 pr-4 text-right font-normal text-emerald-300/70">Сумма</th>
                  <th className="w-28 py-2.5 px-2 font-normal">Оплата</th>
                  <th className="w-28 py-2.5 px-2 pr-4 text-right font-normal">Акт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {filteredReceipts.map((receipt) => (
                  <tr
                    key={receipt.id}
                    className={`transition hover:bg-white/[0.02] ${receipt.status === 'cancelled' ? 'opacity-50 line-through' : ''}`}
                  >
                    <td className="w-24 py-2.5 pl-4 pr-2 align-middle">
                      <span className="text-xs text-muted-foreground">{formatDate(receipt.received_at)}</span>
                    </td>
                    <td className="min-w-0 max-w-0 py-2.5 px-2 align-middle">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <p className="truncate text-sm font-medium">
                            {receipt.kind === 'posting'
                              ? 'Оприходование'
                              : receipt.supplier?.name || 'Без поставщика'}
                            {receipt.status === 'cancelled' ? (
                              <span className="ml-2 inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[9px] font-normal text-rose-200 no-underline">
                                Отменена
                              </span>
                            ) : null}
                          </p>
                        </TooltipTrigger>
                        <TooltipContent side="top" align="start" className="max-w-md">
                          {receipt.kind === 'posting' ? 'Оприходование (без поставщика)' : receipt.supplier?.name || 'Без поставщика'}
                          {receipt.comment ? <div className="mt-1 text-xs text-muted-foreground">{receipt.comment}</div> : null}
                          {receipt.cancel_reason ? <div className="mt-1 text-xs text-rose-300">Причина отмены: {receipt.cancel_reason}</div> : null}
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
                      {receipt.invoice_file_url ? (
                        <a href={receipt.invoice_file_url} target="_blank" rel="noreferrer" className="truncate font-mono text-xs text-emerald-300 underline">
                          {receipt.invoice_number || 'Открыть'}
                        </a>
                      ) : (
                        <span className="truncate font-mono text-xs text-rose-300">Нет файла</span>
                      )}
                    </td>
                    <td className="w-20 py-2.5 px-2 text-right align-middle">
                      <span className="text-sm font-semibold">{(receipt.items || []).length}</span>
                    </td>
                    <td className="w-32 py-2.5 px-2 pr-4 text-right align-middle">
                      <span className="text-sm font-semibold text-emerald-300">{formatMoney(receipt.total_amount || 0)}</span>
                    </td>
                    <td className="w-28 py-2.5 px-2 align-middle">
                      {(() => {
                        const debt = debtByReceiptId.get(String(receipt.id))
                        if (!debt) return <span className="text-xs text-muted-foreground">—</span>
                        if (debt.status === 'paid') {
                          return <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-200">Оплачен</span>
                        }
                        if (debt.status === 'written_off') {
                          return <span className="inline-flex items-center rounded-full border border-gray-500/30 bg-gray-500/15 px-2 py-0.5 text-[10px] text-gray-200">Списан</span>
                        }
                        const overdue = debt.due_date ? new Date(debt.due_date).getTime() < Date.now() : false
                        return (
                          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${overdue ? 'border-red-500/40 bg-red-500/15 text-red-200' : 'border-amber-500/30 bg-amber-500/15 text-amber-200'}`}>
                            {overdue ? 'Просрочен' : debt.is_consignment ? 'Реализация' : 'Долг'}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="w-28 py-2.5 px-2 pr-4 text-right align-middle">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedReceipt(receipt)
                          setReceiptDetailsOpen(true)
                        }}
                      >
                        Открыть
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </Card>

      {/* Create receipt dialog */}
      <Dialog open={formSheetOpen} onOpenChange={setFormSheetOpen}>
        <DialogContent className="flex h-[90vh] !w-[96vw] !max-w-[96vw] sm:!max-w-[1400px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-white/10 p-5 text-left">
            <DialogTitle className="flex items-center gap-2">
              <PackagePlus className="h-5 w-5 text-emerald-300" />
              Новый документ приёмки
            </DialogTitle>
            <DialogDescription>
              Каталог, поставщик, дата и товарные строки. Приход увеличивает общий остаток и обновляет цены.
            </DialogDescription>
          </DialogHeader>
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
                      title={`${item.name} · ${item.barcode}`}
                    >
                      <span className="block max-w-[340px] truncate">{item.name} · {item.barcode}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <button
                type="button"
                onClick={() => setShowBulkTools((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Массовые операции по строкам</p>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition ${showBulkTools ? 'rotate-180' : ''}`} />
              </button>
              {showBulkTools ? (
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  <div className="flex gap-2">
                    <Input value={bulkMarkupPercent} onChange={(e) => setBulkMarkupPercent(e.target.value)} placeholder="Наценка % для всех" />
                    <Button type="button" variant="outline" onClick={applyBulkMarkupPercent}>Применить</Button>
                  </div>
                  <div className="flex gap-2">
                    <Input value={bulkSalePrice} onChange={(e) => setBulkSalePrice(e.target.value)} placeholder="Цена продажи для всех" />
                    <Button type="button" variant="outline" onClick={applyBulkSalePrice}>Применить</Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-3">
              <button
                type="button"
                onClick={() => setShowTemplatesTools((v) => !v)}
                className="flex w-full items-center justify-between"
              >
                <p className="text-xs uppercase tracking-[0.14em] text-slate-400">Шаблоны приемки</p>
                <ChevronDown className={`h-4 w-4 text-slate-400 transition ${showTemplatesTools ? 'rotate-180' : ''}`} />
              </button>
              {showTemplatesTools ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Input value={templateName} onChange={(e) => setTemplateName(e.target.value)} placeholder="Название шаблона" className="min-w-[220px] flex-1" />
                    {canSaveTemplate && (
                      <Button type="button" variant="outline" onClick={saveTemplate}>Сохранить шаблон</Button>
                    )}
                    {canExport && (
                      <Button type="button" variant="outline" onClick={exportCsv}>Экспорт CSV</Button>
                    )}
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
                </>
              ) : null}
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

              <div className="space-y-2">
                <Label>Поставщик (обязательно)</Label>
                <div className="inline-flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setSupplierMode('existing')}
                    className={`rounded-md px-3 py-1.5 transition ${supplierMode === 'existing' ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Из списка
                  </button>
                  <button
                    type="button"
                    onClick={() => setSupplierMode('new')}
                    className={`rounded-md px-3 py-1.5 transition ${supplierMode === 'new' ? 'bg-white/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                  >
                    Новый поставщик
                  </button>
                </div>
                {supplierMode === 'existing' ? (
                  <Select value={supplierId || '__none__'} onValueChange={(value) => setSupplierId(value === '__none__' ? '' : value)}>
                    <SelectTrigger><SelectValue placeholder="Выберите поставщика" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Выберите поставщика</SelectItem>
                      {(data?.suppliers || []).map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name} {supplier.bin_iin ? `· ${supplier.bin_iin}` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="grid gap-2">
                    <Input value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder="Название поставщика" />
                    <Input value={supplierOrganizationName} onChange={(e) => setSupplierOrganizationName(e.target.value)} placeholder="Название организации" />
                    <Input
                      value={supplierBinIin}
                      onChange={(e) => setSupplierBinIin(e.target.value.replace(/\D/g, '').slice(0, 12))}
                      placeholder="ИИН/БИН (12 цифр)"
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Дата приемки</Label>
                <Input type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
              </div>

              <div className="space-y-1.5">
                <Label>Номер накладной</Label>
                <Input value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} placeholder="Например, INV-104" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Категория расхода (COGS, обязательно)</Label>
                <Select value={expenseCategoryId || '__none__'} onValueChange={(value) => setExpenseCategoryId(value === '__none__' ? '' : value)}>
                  <SelectTrigger><SelectValue placeholder="Выберите категорию COGS" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Выберите категорию COGS</SelectItem>
                    {cogsExpenseCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  После приемки расход создается автоматически в выбранной категории.
                  {cogsExpenseCategories.length === 0 ? ' COGS-категории не найдены в справочнике.' : ''}
                </p>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label>Оплата</Label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setPaymentMode('now')}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${paymentMode === 'now' ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-200' : 'border-white/10 text-muted-foreground hover:bg-white/5'}`}
                  >
                    Сразу
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentMode('deferred')}
                    className={`px-3 py-1.5 rounded-lg text-xs border ${paymentMode === 'deferred' ? 'bg-amber-500/15 border-amber-500/40 text-amber-200' : 'border-white/10 text-muted-foreground hover:bg-white/5'}`}
                  >
                    В долг / Под реализацию
                  </button>
                </div>
              </div>

              {paymentMode === 'now' ? (
                <>
                  <div className="space-y-1.5">
                    <Label>Способ оплаты</Label>
                    <Select value={paymentMethod} onValueChange={(value) => setPaymentMethod(value === 'kaspi' ? 'kaspi' : 'cash')}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="cash">Наличные</SelectItem>
                        <SelectItem value="kaspi">Безналичный</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Чек об оплате (обязательно)</Label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        onChange={(event) => void uploadPaymentReceipt(event.target.files?.[0] || null)}
                        disabled={uploadingPaymentReceipt}
                      />
                      {uploadingPaymentReceipt ? <Loader2 className="h-4 w-4 animate-spin text-emerald-300" /> : null}
                    </div>
                    {paymentReceiptFileUrl ? (
                      <a href={paymentReceiptFileUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-300 underline">
                        Чек загружен — открыть файл
                      </a>
                    ) : (
                      <p className="text-xs text-muted-foreground">Этот чек попадет в расход (не накладная).</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label>Срок оплаты (опционально)</Label>
                    <Input type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                  </div>
                  <div className="space-y-1.5 flex items-end">
                    <label className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-white/20 bg-transparent"
                        checked={isConsignment}
                        onChange={(event) => setIsConsignment(event.target.checked)}
                      />
                      Под реализацию (consignment)
                    </label>
                  </div>
                  <p className="text-xs text-muted-foreground md:col-span-2">
                    Расход не создается. Долг повиснет в разделе «Долги и накладные» и закроется при оплате.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-2 rounded-2xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
              <Label>Файл накладной (обязательно)</Label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => void uploadInvoice(event.target.files?.[0] || null)}
                  disabled={uploadingInvoice}
                />
                {uploadingInvoice ? <Loader2 className="h-4 w-4 animate-spin text-amber-300" /> : null}
                {canAiParse && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void runAiInvoiceParse()}
                  disabled={!invoiceFileUrl || uploadingInvoice || aiParsing}
                >
                  {aiParsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  Распознать ИИ
                </Button>
                )}
              </div>
              {invoiceFileUrl ? (
                <a href={invoiceFileUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-300 underline">
                  Накладная загружена — открыть файл
                </a>
              ) : (
                <p className="text-xs text-amber-200">Без загруженной накладной приемка не будет проведена.</p>
              )}
              {aiParseResult ? (
                <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.06] p-3 text-xs text-emerald-100">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium">
                      ИИ-черновик: найдено {aiParseResult.items.length} строк, сопоставлено {aiParseResult.matched_count}, без совпадения {aiParseResult.unmatched_count}.
                    </p>
                    {aiParseResult.unmatched_count > 0 ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 text-[11px] gap-1"
                        onClick={() => void runAiInvoiceParse()}
                        disabled={aiParsing}
                      >
                        {aiParsing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                        Дораспознать
                      </Button>
                    ) : null}
                  </div>
                  {(() => {
                    const learned = aiParseResult.items.filter((it) => it.match_source === 'mapping_supplier').length
                    return learned > 0 ? (
                      <p className="text-[11px] text-emerald-200/90">🎯 Узнано по предыдущим приёмкам этого поставщика: {learned}</p>
                    ) : null
                  })()}
                  <p className="mt-1 text-emerald-200/90">
                    {aiParseResult.supplier_name ? `Поставщик: ${aiParseResult.supplier_name}. ` : ''}
                    {aiParseResult.invoice_number ? `Номер: ${aiParseResult.invoice_number}. ` : ''}
                    {aiParseResult.invoice_date ? `Дата: ${aiParseResult.invoice_date}.` : ''}
                  </p>
                  {aiParseResult.cogs_suggestion?.recommended_category_name ? (
                    <div className="mt-2 rounded-lg border border-emerald-300/20 bg-black/20 px-2 py-2 text-[11px] text-emerald-100">
                      <p>
                        Рекомендованная COGS-категория: <span className="font-medium">{aiParseResult.cogs_suggestion.recommended_category_name}</span>
                      </p>
                      <p className={`mt-1 inline-flex rounded-full border px-2 py-0.5 ${cogsConfidenceClass}`}>
                        {cogsConfidenceLabel}
                      </p>
                      {aiParseResult.cogs_suggestion.reason ? (
                        <p className="mt-1 text-emerald-200/85">{aiParseResult.cogs_suggestion.reason}</p>
                      ) : null}
                      <div className="mt-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 text-[11px]"
                          onClick={applyAiCogsCategory}
                        >
                          Применить категорию
                        </Button>
                      </div>
                      {(aiParseResult.cogs_suggestion.alternatives || []).length > 0 ? (
                        <div className="mt-2 space-y-1">
                          <p className="text-emerald-200/80">Альтернативы:</p>
                          <div className="flex flex-wrap gap-1.5">
                            {(aiParseResult.cogs_suggestion.alternatives || []).map((alt) => (
                              <Button
                                key={alt.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-7 text-[11px]"
                                onClick={() => applySpecificCogsCategory(alt.id, alt.name)}
                              >
                                {alt.name}
                              </Button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <div className="mt-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 bg-emerald-600 hover:bg-emerald-700"
                      onClick={applyAiParseResult}
                    >
                      Применить в форму
                    </Button>
                  </div>
                  {aiParseResult.items.some((item) => !(item.manual_item_id || item.matched_item_id)) ? (
                    <div className="mt-3 space-y-2 rounded-lg border border-emerald-300/20 bg-black/20 p-2">
                      <p className="text-[11px] text-emerald-200/90">Ручное сопоставление несвязанных строк:</p>
                      {aiParseResult.items.map((item, index) => {
                        const resolvedId = item.manual_item_id || item.matched_item_id || '__none__'
                        if (resolvedId !== '__none__') return null
                        return (
                          <div key={`${item.invoice_name}-${index}`} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(240px,320px)]">
                            <p className="truncate text-emerald-100">
                              {item.invoice_name} · {item.quantity} шт
                            </p>
                            <Select
                              value={resolvedId}
                              onValueChange={(value) => setAiManualItem(index, value === '__none__' ? '' : value)}
                            >
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="Выберите товар из каталога" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Без сопоставления</SelectItem>
                                {(data?.items || []).map((catalogItem) => (
                                  <SelectItem key={catalogItem.id} value={catalogItem.id} title={`${catalogItem.name} · ${catalogItem.barcode}`}>
                                    <span className="block max-w-[380px] truncate">{catalogItem.name} · {catalogItem.barcode}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )
                      })}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Комментарий</Label>
              <Textarea value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Что важно по этой приемке" rows={3} />
            </div>

            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2 text-sm text-emerald-200">
              Цены применяются автоматически: закуп обновляет себестоимость, продажа и наценка синхронизируются по всем точкам.
            </div>

            <div className="space-y-3">
              {lines.map((line, index) => {
                const lineItem = (data?.items || []).find((row) => row.id === line.item_id) || null
                return (
                <div key={index} className="grid gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:grid-cols-[minmax(0,1.2fr)_160px_110px_130px_130px_110px_minmax(0,1fr)_auto]">
                  <div className="space-y-1.5 min-w-0">
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
                              // Для бонусной строки цену закупа держим 0 независимо от каталога.
                              unit_cost: item.is_bonus
                                ? '0'
                                : selectedItem ? String(selectedItem.default_purchase_price || '') : item.unit_cost,
                              sale_price: selectedItem ? String(selectedItem.sale_price || '') : item.sale_price,
                              markup_percent: item.is_bonus
                                ? ''
                                : selectedItem
                                  ? calcMarkupPercent(String(selectedItem.default_purchase_price || ''), String(selectedItem.sale_price || ''))
                                  : item.markup_percent,
                            }
                          }),
                        )
                      }
                    >
                      <SelectTrigger className="min-w-0 w-full overflow-hidden [&>span]:block [&>span]:truncate">
                        <SelectValue placeholder="Выберите товар" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__empty__${index}`}>Выберите товар</SelectItem>
                        {(data?.items || []).map((item) => (
                          <SelectItem key={item.id} value={item.id} title={`${item.name} · ${item.barcode}`}>
                            <span className="block max-w-[420px] truncate">{item.name} · {item.barcode}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 min-w-0">
                    <Label>Штрихкод</Label>
                    <Input value={lineItem?.barcode || '—'} readOnly className="bg-white/[0.03] truncate" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Кол-во</Label>
                    <Input inputMode="decimal" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} placeholder="0" />
                  </div>

                  <div className="space-y-1.5">
                    <Label>Цена закупа</Label>
                    <Input
                      inputMode="decimal"
                      value={line.is_bonus ? '0' : line.unit_cost}
                      readOnly={line.is_bonus}
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
                      placeholder="499,6757"
                      className={line.is_bonus ? 'opacity-50' : undefined}
                    />
                    <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11px]">
                      <input
                        type="checkbox"
                        checked={!!line.is_bonus}
                        onChange={(event) =>
                          setLines((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...item,
                                    is_bonus: event.target.checked,
                                    unit_cost: event.target.checked ? '0' : item.unit_cost,
                                    markup_percent: event.target.checked ? '' : item.markup_percent,
                                  }
                                : item,
                            ),
                          )
                        }
                        className="h-3.5 w-3.5 accent-emerald-500"
                      />
                      <span className={line.is_bonus ? 'font-medium text-emerald-300' : 'text-muted-foreground'}>
                        Бонус (подарок поставщика)
                      </span>
                    </label>
                    {!line.is_bonus && (() => {
                      if (!line.last_unit_cost || line.last_unit_cost <= 0) return null
                      const current = parseUnitCost(line.unit_cost)
                      if (current <= 0) return null
                      const change = ((current - line.last_unit_cost) / line.last_unit_cost) * 100
                      const abs = Math.abs(change)
                      if (abs < 1) {
                        return (
                          <p className="text-[10px] text-muted-foreground">Прошлая закупка: {line.last_unit_cost} ₸</p>
                        )
                      }
                      const up = change > 0
                      return (
                        <p className={`text-[10px] ${up ? 'text-rose-300' : 'text-emerald-300'}`}>
                          {up ? '↑' : '↓'} {Math.round(abs * 10) / 10}% к прошлой ({line.last_unit_cost} ₸)
                        </p>
                      )
                    })()}
                  </div>

                  <div className="space-y-1.5">
                    <Label>Цена продажи</Label>
                    <Input
                      inputMode="decimal"
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
                      inputMode="decimal"
                      value={line.is_bonus ? '' : line.markup_percent}
                      readOnly={line.is_bonus}
                      onChange={(event) =>
                        setLines((current) =>
                          current.map((item, itemIndex) => {
                            if (itemIndex !== index) return item
                            const pct = parseMoney(event.target.value)
                            const base = parseUnitCost(item.unit_cost)
                            const sale = base > 0 ? String(Math.round((base * (1 + pct / 100) + Number.EPSILON) * 100) / 100) : item.sale_price
                            return {
                              ...item,
                              markup_percent: event.target.value,
                              sale_price: sale,
                            }
                          }),
                        )
                      }
                      placeholder={line.is_bonus ? '—' : '0'}
                      className={line.is_bonus ? 'opacity-50' : undefined}
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
              )})}
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
            <Button type="button" variant="outline" onClick={() => void saveDraft()} className="w-full">
              Сохранить как черновик
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={receiptDetailsOpen} onOpenChange={setReceiptDetailsOpen}>
        <DialogContent className="flex h-[85vh] !w-[92vw] !max-w-[92vw] sm:!max-w-[1200px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-white/10 p-5 text-left">
            <DialogTitle>Детали приёмки</DialogTitle>
            <DialogDescription>
              {selectedReceipt
                ? `${formatDate(selectedReceipt.received_at)} · ${selectedReceipt.supplier?.name || 'Без поставщика'}`
                : 'Проведенный акт приёмки'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 overflow-auto p-5">
            {!selectedReceipt ? (
              <p className="text-sm text-muted-foreground">Документ не выбран.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-sm text-muted-foreground">
                    Локация: <span className="text-foreground">{selectedReceipt.location?.name || '—'}</span>
                    {selectedReceipt.invoice_number ? (
                      <span> · Накладная: <span className="text-foreground">{selectedReceipt.invoice_number}</span></span>
                    ) : null}
                    {selectedReceipt.invoice_file_url ? (
                      <span> · <a href={selectedReceipt.invoice_file_url} target="_blank" rel="noreferrer" className="underline text-emerald-300">Файл накладной</a></span>
                    ) : null}
                    <span> · Сумма: <span className="text-foreground">{formatMoney(Number(selectedReceipt.total_amount || 0))}</span></span>
                    {selectedReceipt.kind === 'posting' ? (
                      <span> · <span className="text-blue-300">Оприходование</span></span>
                    ) : null}
                  </div>
                  <div className="ml-auto">
                    {selectedReceipt.status === 'cancelled' ? (
                      <span className="inline-flex items-center rounded-full border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-xs text-rose-200">
                        Отменена{selectedReceipt.cancelled_at ? ` · ${formatDate(selectedReceipt.cancelled_at)}` : ''}
                      </span>
                    ) : canCancel ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="border-rose-500/40 text-rose-300 hover:bg-rose-500/10"
                        onClick={() => void cancelReceipt(selectedReceipt)}
                      >
                        Отменить приёмку
                      </Button>
                    ) : null}
                  </div>
                </div>
                {selectedReceipt.cancel_reason ? (
                  <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2 text-xs text-rose-300">
                    Причина отмены: {selectedReceipt.cancel_reason}
                  </div>
                ) : null}
                <div className="overflow-auto rounded-xl border border-white/10">
                  <table className="w-full table-fixed text-sm">
                    <thead className="bg-white/[0.03]">
                      <tr className="text-left text-xs text-muted-foreground">
                        <th className="px-3 py-2 font-normal">Товар</th>
                        <th className="px-3 py-2 font-normal">Штрихкод</th>
                        <th className="px-3 py-2 text-right font-normal">Кол-во</th>
                        <th className="px-3 py-2 text-right font-normal">Цена закупа</th>
                        <th className="px-3 py-2 text-right font-normal">Сумма</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedReceipt.items || []).map((item) => (
                        <tr key={item.id} className="border-t border-white/[0.06]">
                          <td className="px-3 py-2" title={item.item?.name || 'Товар'}>
                            <span className="flex items-center gap-2 min-w-0">
                              <span className="block truncate">{item.item?.name || 'Товар'}</span>
                              {item.is_bonus ? (
                                <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
                                  Бонус
                                </span>
                              ) : null}
                            </span>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">{item.item?.barcode || '—'}</td>
                          <td className="px-3 py-2 text-right">{formatQty(Number(item.quantity || 0))}</td>
                          <td className="px-3 py-2 text-right">{item.is_bonus ? '—' : formatUnitCost(Number(item.unit_cost || 0))}</td>
                          <td className="px-3 py-2 text-right">{item.is_bonus ? '0' : formatMoney(Number(item.total_cost || 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
