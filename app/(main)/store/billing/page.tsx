'use client'

import { useEffect, useMemo, useState } from 'react'
import { Download, Loader2, Receipt, FileText, Wallet, X, Trash2 } from 'lucide-react'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import { useStoreScope } from '@/components/store/store-scope'

import { downloadReportPdf } from '@/lib/client/download-pdf'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { CardSkeleton } from '@/components/skeleton'
import { ModalPortal } from '@/components/ui/modal-portal'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatMoney } from '@/lib/core/format'

type Supplier = {
  id: string
  name: string
  bin_iin: string | null
  organization_name: string | null
}

type ReceiptLite = {
  id: string
  received_at: string
  invoice_number: string | null
  invoice_file_url: string | null
  total_amount: number | null
  comment?: string | null
  supplier?: Supplier | null
  location?: { id: string; name: string; code: string | null; location_type: string } | null
  items?: Array<{
    id: string
    quantity: number
    unit_cost: number
    total_cost: number
    item?: { id: string; name: string; barcode: string; unit?: string | null } | null
  }>
}

type Debt = {
  id: string
  receipt_id: string
  supplier_id: string | null
  company_id: string | null
  organization_id: string | null
  total_amount: number
  status: 'open' | 'paid' | 'written_off'
  due_date: string | null
  is_consignment: boolean
  payment_paid_at: string | null
  payment_cash_amount: number
  payment_kaspi_amount: number
  payment_receipt_file_url: string | null
  payment_comment: string | null
  expense_id: string | null
  created_at: string
  supplier?: Supplier | null
  company?: { id: string; name: string; code: string | null } | null
  receipt?: ReceiptLite | null
}

type DebtsResponse = {
  ok: boolean
  data?: { debts: Debt[]; receipts: ReceiptLite[] }
  error?: string
}

const fmtDate = (value: string | null | undefined) => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('ru-RU')
  } catch {
    return value
  }
}

export default function BillingPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { can } = useCapabilities()
  const canPayDebt = can('store-billing.pay_debt')
  const canWriteOff = can('store-billing.write_off_debt')
  const canBulkPay = can('store-billing.bulk_pay')
  const canReschedule = can('store-billing.reschedule_debt')
  const canParseReceipt = can('store-billing.parse_receipt')
  const canExport = can('store-billing.export')

  const [activeTab, setActiveTab] = useState<'debts' | 'invoices'>('debts')
  const [statusFilter, setStatusFilter] = useState<'open' | 'paid' | 'written_off' | 'all'>('open')
  const [debts, setDebts] = useState<Debt[]>([])
  const [receipts, setReceipts] = useState<ReceiptLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const { storeCompanyId } = useStoreScope()

  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')

  const [payDebt, setPayDebt] = useState<Debt | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState<'cash' | 'kaspi'>('cash')
  const [payReceiptUrl, setPayReceiptUrl] = useState('')
  const [payComment, setPayComment] = useState('')
  const [paying, setPaying] = useState(false)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)
  const [parsingReceipt, setParsingReceipt] = useState(false)
  const [receiptParseHint, setReceiptParseHint] = useState<{ total: number | null; method: 'cash' | 'kaspi' | null; paid_at: string | null; merchant: string | null; warning: string | null } | null>(null)

  const [writeOffDebt, setWriteOffDebt] = useState<Debt | null>(null)
  const [writeOffReason, setWriteOffReason] = useState('')
  const [writingOff, setWritingOff] = useState(false)

  const [deletingId, setDeletingId] = useState<string | null>(null)

  const [reschedDebt, setReschedDebt] = useState<Debt | null>(null)
  const [reschedDate, setReschedDate] = useState('')
  const [reschedReason, setReschedReason] = useState('')
  const [rescheduling, setRescheduling] = useState(false)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkPayOpen, setBulkPayOpen] = useState(false)
  const [bulkDate, setBulkDate] = useState(new Date().toISOString().slice(0, 10))
  const [bulkMethod, setBulkMethod] = useState<'cash' | 'kaspi'>('cash')
  const [bulkReceiptUrl, setBulkReceiptUrl] = useState('')
  const [bulkComment, setBulkComment] = useState('')
  const [bulkPaying, setBulkPaying] = useState(false)
  const [bulkUploading, setBulkUploading] = useState(false)
  // Esc + scroll-lock для всех 4-х модалок страницы
  useModalEscape(!!payDebt, () => { if (!paying) setPayDebt(null) })
  useModalEscape(!!writeOffDebt, () => { if (!writingOff) setWriteOffDebt(null) })
  useModalEscape(bulkPayOpen, () => { if (!bulkPaying) setBulkPayOpen(false) })
  useModalEscape(!!reschedDebt, () => { if (!rescheduling) setReschedDebt(null) })

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const url = `/api/admin/store/debts?status=${statusFilter}&include_receipts=1`
      const response = await fetch(url, { cache: 'no-store' })
      const json = (await response.json().catch(() => null)) as DebtsResponse | null
      if (!response.ok || !json?.ok || !json.data) {
        throw new Error(json?.error || 'Не удалось загрузить долги')
      }
      setDebts(json.data.debts || [])
      setReceipts(json.data.receipts || [])
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter])

  const filterDebt = (d: Debt) => {
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      const supplierMatch =
        (d.supplier?.organization_name || '').toLowerCase().includes(q)
        || (d.supplier?.name || '').toLowerCase().includes(q)
        || (d.supplier?.bin_iin || '').includes(q)
        || (d.receipt?.invoice_number || '').toLowerCase().includes(q)
      if (!supplierMatch) return false
    }
    const ref = d.receipt?.received_at || d.created_at
    if (dateFrom && ref && ref < dateFrom) return false
    if (dateTo && ref && ref > dateTo) return false
    if (companyFilter && d.company_id !== companyFilter) return false
    return true
  }

  const filterReceipt = (r: ReceiptLite) => {
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      const supplierMatch =
        (r.supplier?.organization_name || '').toLowerCase().includes(q)
        || (r.supplier?.name || '').toLowerCase().includes(q)
        || (r.supplier?.bin_iin || '').includes(q)
        || (r.invoice_number || '').toLowerCase().includes(q)
      if (!supplierMatch) return false
    }
    if (dateFrom && r.received_at && r.received_at < dateFrom) return false
    if (dateTo && r.received_at && r.received_at > dateTo) return false
    return true
  }

  const filteredDebts = useMemo(() => debts.filter(filterDebt), [debts, searchQuery, dateFrom, dateTo, companyFilter])
  const filteredReceipts = useMemo(() => receipts.filter(filterReceipt), [receipts, searchQuery, dateFrom, dateTo])

  const companies = useMemo(() => {
    const map = new Map<string, string>()
    for (const d of debts) {
      if (d.company_id && d.company?.name) map.set(d.company_id, d.company.name)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [debts])

  const totalsByStatus = useMemo(() => {
    const result = { open: 0, openCount: 0, overdue: 0, overdueCount: 0 }
    const now = Date.now()
    for (const d of filteredDebts) {
      if (d.status === 'open') {
        result.open += Number(d.total_amount || 0)
        result.openCount += 1
        if (d.due_date && new Date(d.due_date).getTime() < now) {
          result.overdue += Number(d.total_amount || 0)
          result.overdueCount += 1
        }
      }
    }
    return result
  }, [filteredDebts])

  const groupedReceipts = useMemo(() => {
    const map = new Map<string, ReceiptLite[]>()
    for (const r of filteredReceipts) {
      const key = String(r.received_at || '').slice(0, 10) || 'unknown'
      const list = map.get(key) || []
      list.push(r)
      map.set(key, list)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, items]) => ({ date, items }))
  }, [filteredReceipts])

  const openPay = (debt: Debt) => {
    setPayDebt(debt)
    setPayDate(new Date().toISOString().slice(0, 10))
    setPayMethod('cash')
    setPayReceiptUrl('')
    setPayComment('')
    setError(null)
  }

  const closePay = () => {
    setPayDebt(null)
    setPayDate(new Date().toISOString().slice(0, 10))
    setPayReceiptUrl('')
    setPayComment('')
    setReceiptParseHint(null)
  }

  const parsePayReceipt = async () => {
    if (!payReceiptUrl || !payDebt) return
    setParsingReceipt(true)
    setReceiptParseHint(null)
    try {
      const response = await fetch('/api/admin/store/receipts/ai-parse-payment-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receipt_file_url: payReceiptUrl }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'ИИ не смог распознать чек')

      const total: number | null = json.data?.total_amount ?? null
      const method: 'cash' | 'kaspi' | null = json.data?.payment_method ?? null
      const paid_at: string | null = json.data?.paid_at ?? null
      const merchant: string | null = json.data?.merchant ?? null

      const expected = Number(payDebt.total_amount || 0)
      const warnings: string[] = []
      if (total != null && expected > 0 && Math.abs(total - expected) > Math.max(1, expected * 0.005)) {
        warnings.push(`Сумма в чеке (${Math.round(total)} ₸) не совпадает с долгом (${Math.round(expected)} ₸)`)
      }
      if (paid_at && payDate && paid_at !== payDate) {
        warnings.push(`Дата в чеке (${paid_at}) не совпадает с выбранной датой оплаты`)
      }

      // auto-apply non-conflicting hints
      if (method && !warnings.find((w) => w.startsWith('Метод'))) setPayMethod(method)
      if (paid_at) setPayDate(paid_at)

      setReceiptParseHint({ total, method, paid_at, merchant, warning: warnings.join(' · ') || null })
    } catch (err: any) {
      setError(err?.message || 'Не удалось распознать чек')
    } finally {
      setParsingReceipt(false)
    }
  }

  const uploadPayReceipt = async (file: File | null) => {
    if (!file) return
    setUploadingReceipt(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/admin/store/receipts/upload', {
        method: 'POST',
        body: formData,
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить чек')
      setPayReceiptUrl(String(json.document_url || ''))
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить чек')
    } finally {
      setUploadingReceipt(false)
    }
  }

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedSum = useMemo(() => {
    let sum = 0
    for (const d of filteredDebts) {
      if (selectedIds.has(d.id) && d.status === 'open') sum += Number(d.total_amount || 0)
    }
    return sum
  }, [filteredDebts, selectedIds])

  const uploadBulkReceipt = async (file: File | null) => {
    if (!file) return
    setBulkUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/admin/store/receipts/upload', {
        method: 'POST',
        body: formData,
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить чек')
      setBulkReceiptUrl(String(json.document_url || ''))
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить чек')
    } finally {
      setBulkUploading(false)
    }
  }

  const submitBulkPay = async () => {
    if (!bulkReceiptUrl) {
      setError('Загрузите чек об оплате')
      return
    }
    setBulkPaying(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/store/debts/bulk-pay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          debt_ids: Array.from(selectedIds),
          paid_at: bulkDate,
          payment_method: bulkMethod,
          receipt_file_url: bulkReceiptUrl,
          comment: bulkComment.trim() || null,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось провести объединённую оплату')
      setSuccess(`Закрыто ${json.data?.closed || 0} долгов`)
      setBulkPayOpen(false)
      setBulkReceiptUrl('')
      setBulkComment('')
      setSelectedIds(new Set())
      await load()
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setBulkPaying(false)
    }
  }

  const exportDebtsExcel = async () => {
    try {
      const now = Date.now()
      const ageBucket = (createdAt: string | null | undefined) => {
        if (!createdAt) return '—'
        const days = Math.floor((now - new Date(createdAt).getTime()) / 86_400_000)
        if (days <= 30) return '0–30 дней'
        if (days <= 60) return '31–60 дней'
        return '60+ дней'
      }

      const sheetRows = filteredDebts.map((d) => ({
        supplier: d.supplier?.organization_name || d.supplier?.name || '—',
        bin_iin: d.supplier?.bin_iin || '',
        invoice: d.receipt?.invoice_number || `#${(d.receipt_id || '').slice(0, 8)}`,
        received_at: d.receipt?.received_at ? new Date(d.receipt.received_at).toLocaleDateString('ru-RU') : '',
        due_date: d.due_date ? new Date(d.due_date).toLocaleDateString('ru-RU') : '',
        status:
          d.status === 'open'
            ? d.due_date && new Date(d.due_date).getTime() < now
              ? 'Просрочен'
              : 'Открыт'
            : d.status === 'paid'
            ? 'Оплачен'
            : 'Списан',
        is_consignment: d.is_consignment ? 'да' : '',
        aging: d.status === 'open' ? ageBucket(d.created_at) : '—',
        total: Number(d.total_amount || 0),
      }))

      await downloadReportPdf('table', {
        meta: { title: 'Долги поставщикам', generated: new Date().toLocaleDateString('ru-RU') },
        columns: [
          { key: 'supplier', label: 'Поставщик' },
          { key: 'bin_iin', label: 'БИН/ИИН' },
          { key: 'invoice', label: 'Накладная' },
          { key: 'received_at', label: 'Дата приёмки' },
          { key: 'due_date', label: 'Срок оплаты' },
          { key: 'status', label: 'Статус' },
          { key: 'is_consignment', label: 'Реализация' },
          { key: 'aging', label: 'Возраст' },
          { key: 'total', label: 'Сумма', align: 'right' },
        ],
        rows: sheetRows,
        total: { total: sheetRows.reduce((s, r) => s + r.total, 0) },
      }, `Dolgi_postavshchikam_${new Date().toISOString().slice(0, 10)}`)
    } catch (err: any) {
      setError(err?.message || 'Не удалось сформировать отчёт')
    }
  }

  const submitReschedule = async () => {
    if (!reschedDebt) return
    setRescheduling(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/debts/${reschedDebt.id}/due-date`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          due_date: reschedDate || null,
          reason: reschedReason.trim() || null,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось перенести срок')
      setSuccess('Срок оплаты перенесён')
      setReschedDebt(null)
      setReschedDate('')
      setReschedReason('')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось перенести срок')
    } finally {
      setRescheduling(false)
    }
  }

  const submitWriteOff = async () => {
    if (!writeOffDebt) return
    setWritingOff(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/debts/${writeOffDebt.id}/write-off`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: writeOffReason.trim() || null }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось списать долг')
      setSuccess('Долг списан')
      setWriteOffDebt(null)
      setWriteOffReason('')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось списать долг')
    } finally {
      setWritingOff(false)
    }
  }

  const handleDeleteDebt = async (debt: Debt) => {
    const label = debt.supplier?.organization_name || debt.supplier?.name || 'поставщик'
    if (!confirm(`Удалить долг «${label}» на ${formatMoney(debt.total_amount)} ₸?\n\nЗапись будет удалена безвозвратно. Приход и расход не затрагиваются.`)) return
    setDeletingId(debt.id)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/debts/${debt.id}`, { method: 'DELETE' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось удалить долг')
      setSuccess('Долг удалён')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось удалить долг')
    } finally {
      setDeletingId(null)
    }
  }

  const submitPay = async () => {
    if (!payDebt) return
    if (!payReceiptUrl) {
      setError('Загрузите чек об оплате')
      return
    }
    setPaying(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/debts/${payDebt.id}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          paid_at: payDate,
          payment_method: payMethod,
          receipt_file_url: payReceiptUrl,
          comment: payComment.trim() || null,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось провести оплату')
      setSuccess('Оплата проведена. Долг закрыт.')
      closePay()
      await load()
    } catch (err: any) {
      setError(err?.message || 'Не удалось провести оплату')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className={embedded ? 'space-y-6' : 'app-page-wide space-y-6'}>
      {(() => {
        const hdrActions = (
          activeTab === 'debts' && canExport ? (
            <Button variant="outline" size="sm" onClick={() => void exportDebtsExcel()} disabled={filteredDebts.length === 0}>
              <Download className="w-4 h-4 mr-1" /> Экспорт PDF
            </Button>
          ) : null
        )
        const hdrToolbar = (
          <div className="flex gap-2 p-1 bg-white dark:bg-slate-800/50 rounded-xl w-fit border border-border">
            <button
              onClick={() => setActiveTab('debts')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'debts' ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-200' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'}`}
            >
              <Wallet className="w-4 h-4" /> Долги
            </button>
            <button
              onClick={() => setActiveTab('invoices')}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'invoices' ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-200' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'}`}
            >
              <FileText className="w-4 h-4" /> Накладные
            </button>
          </div>
        )
        return embedded ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {hdrToolbar}
            <div className="flex flex-wrap items-center gap-2">{hdrActions}</div>
          </div>
        ) : (
          <AdminPageHeader
            title="Долги и накладные"
            description="Учёт обязательств перед поставщиками и история приёмок"
            icon={<Wallet className="h-5 w-5" />}
            accent="emerald"
            backHref="/"
            actions={hdrActions}
            toolbar={hdrToolbar}
          />
        )
      })()}

      {error ? (
        <Card className="p-3 border-red-500/30 bg-red-500/10 text-sm text-red-700 dark:text-red-200">{error}</Card>
      ) : null}
      {success ? (
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-700 dark:text-emerald-200">{success}</Card>
      ) : null}

      <Card className="p-3 bg-white dark:bg-slate-900/40 border-slate-200 dark:border-slate-800">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поставщик, БИН/ИИН или № накладной..."
          />
          <DatePicker value={dateFrom} onChange={setDateFrom} placeholder="С" />
          <DatePicker value={dateTo} onChange={setDateTo} placeholder="По" />
          {activeTab === 'debts' && companies.length > 0 && !storeCompanyId ? (
            <Select value={companyFilter || '__all__'} onValueChange={(v) => setCompanyFilter(v === '__all__' ? '' : v)}>
              <SelectTrigger><SelectValue placeholder="Все точки" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Все точки</SelectItem>
                {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <button
              type="button"
              onClick={() => { setSearchQuery(''); setDateFrom(''); setDateTo(''); setCompanyFilter('') }}
              className="rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:text-slate-900 dark:hover:text-white hover:bg-white/5"
            >
              Сбросить фильтры
            </button>
          )}
        </div>
      </Card>

      {activeTab === 'debts' ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
            <Card className="p-3 bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-muted-foreground uppercase">Открытых долгов</div>
              <div className="text-lg font-bold text-amber-700 dark:text-amber-300">{totalsByStatus.openCount}</div>
              <div className="text-xs text-muted-foreground">{formatMoney(totalsByStatus.open)} ₸</div>
            </Card>
            <Card className="p-3 bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-muted-foreground uppercase">Просрочено</div>
              <div className="text-lg font-bold text-red-700 dark:text-red-300">{totalsByStatus.overdueCount}</div>
              <div className="text-xs text-muted-foreground">{formatMoney(totalsByStatus.overdue)} ₸</div>
            </Card>
            <Card className="p-3 bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800">
              <div className="text-[11px] text-muted-foreground uppercase">Фильтр статуса</div>
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as any)}>
                <SelectTrigger className="h-8 mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Открытые</SelectItem>
                  <SelectItem value="paid">Оплаченные</SelectItem>
                  <SelectItem value="written_off">Списанные</SelectItem>
                  <SelectItem value="all">Все</SelectItem>
                </SelectContent>
              </Select>
            </Card>
          </div>

          {selectedIds.size > 0 ? (
            <Card className="sticky top-2 z-10 p-3 bg-emerald-500/15 border-emerald-500/30 flex items-center justify-between flex-wrap gap-2">
              <div className="text-sm">
                Выбрано: <b>{selectedIds.size}</b> · Сумма: <b>{formatMoney(selectedSum)} ₸</b>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setSelectedIds(new Set())}
                >
                  Сбросить
                </Button>
                {canBulkPay && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setBulkDate(new Date().toISOString().slice(0, 10))
                      setBulkMethod('cash')
                      setBulkReceiptUrl('')
                      setBulkComment('')
                      setBulkPayOpen(true)
                    }}
                  >
                    Оплатить выбранные
                  </Button>
                )}
              </div>
            </Card>
          ) : null}

          {loading && filteredDebts.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} rows={2} />)}
            </div>
          ) : filteredDebts.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground text-center">Долгов нет.</Card>
          ) : (
            <div className="space-y-2">
              {filteredDebts.map((debt) => (
                <Card key={debt.id} className="p-4 bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    {debt.status === 'open' ? (
                      <input
                        type="checkbox"
                        className="mt-1.5 h-4 w-4 rounded border-white/20 bg-transparent shrink-0"
                        checked={selectedIds.has(debt.id)}
                        onChange={() => toggleSelected(debt.id)}
                      />
                    ) : null}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold">{debt.supplier?.organization_name || debt.supplier?.name || 'Поставщик не указан'}</span>
                        {debt.supplier?.bin_iin ? <span className="text-xs text-muted-foreground">· {debt.supplier.bin_iin}</span> : null}
                        {debt.is_consignment ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-200 border border-amber-500/30">реализация</span>
                        ) : null}
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            debt.status === 'open'
                              ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200 border-amber-500/30'
                              : debt.status === 'paid'
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-500/30'
                              : 'bg-slate-500/15 text-body border-slate-500/30'
                          }`}
                        >
                          {debt.status === 'open' ? 'Открыт' : debt.status === 'paid' ? 'Оплачен' : 'Списан'}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                        <span>Накладная: {debt.receipt?.invoice_number || `#${(debt.receipt_id || '').slice(0, 8)}`}</span>
                        <span>Дата приёмки: {fmtDate(debt.receipt?.received_at)}</span>
                        {debt.due_date ? <span>Срок: {fmtDate(debt.due_date)}</span> : null}
                        {debt.payment_paid_at ? <span>Оплачено: {fmtDate(debt.payment_paid_at)}</span> : null}
                        {debt.receipt?.invoice_file_url ? (
                          <a href={debt.receipt.invoice_file_url} target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-300 underline">
                            Накладная ↗
                          </a>
                        ) : null}
                        {debt.payment_receipt_file_url ? (
                          <a href={debt.payment_receipt_file_url} target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-300 underline">
                            Чек об оплате ↗
                          </a>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Сумма</div>
                        <div className="text-lg font-semibold">{formatMoney(debt.total_amount)} ₸</div>
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {debt.status === 'open' && (
                          <>
                            {canPayDebt && (
                              <Button onClick={() => openPay(debt)}>Оплатить</Button>
                            )}
                            {canReschedule && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setReschedDebt(debt)
                                  setReschedDate(debt.due_date || '')
                                  setReschedReason('')
                                }}
                              >
                                Перенести срок
                              </Button>
                            )}
                            {canWriteOff && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  setWriteOffDebt(debt)
                                  setWriteOffReason('')
                                }}
                              >
                                Списать
                              </Button>
                            )}
                          </>
                        )}
                        {canWriteOff && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-rose-500/30 text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 hover:text-rose-700 dark:hover:text-rose-200"
                            disabled={deletingId === debt.id}
                            onClick={() => handleDeleteDebt(debt)}
                          >
                            {deletingId === debt.id ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <><Trash2 className="w-3.5 h-3.5 mr-1" />Удалить</>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {loading && groupedReceipts.length === 0 ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <CardSkeleton key={i} rows={2} />)}
            </div>
          ) : groupedReceipts.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground text-center">Накладных нет.</Card>
          ) : (
            <div className="space-y-4">
              {groupedReceipts.map(({ date, items }) => (
                <div key={date} className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground border-b border-border pb-1">
                    {fmtDate(date)} · накладных: {items.length}
                  </div>
                  {items.map((r) => (
                    <Card key={r.id} className="p-4 bg-white dark:bg-slate-900/60 border-slate-200 dark:border-slate-800">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-300" />
                            <span className="font-semibold">{r.invoice_number || `#${(r.id || '').slice(0, 8)}`}</span>
                            <span className="text-muted-foreground">· {r.supplier?.organization_name || r.supplier?.name || '—'}</span>
                            {r.location?.name ? (
                              <span className="text-xs text-muted-foreground">→ {r.location.name}</span>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                            <span>Позиций: {r.items?.length || 0}</span>
                            {r.invoice_file_url ? (
                              <a href={r.invoice_file_url} target="_blank" rel="noreferrer" className="text-emerald-600 dark:text-emerald-300 underline">
                                Накладная ↗
                              </a>
                            ) : null}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-muted-foreground">Сумма</div>
                          <div className="text-lg font-semibold">{formatMoney(r.total_amount || 0)} ₸</div>
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {payDebt ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={closePay}>
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-border bg-white dark:bg-slate-950/95 p-6 text-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Оплата долга</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {payDebt.supplier?.organization_name || payDebt.supplier?.name || '—'} · {formatMoney(payDebt.total_amount)} ₸
                </p>
              </div>
              <button onClick={closePay} className="rounded-xl border border-border p-2 text-muted-foreground hover:text-slate-900 dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Дата оплаты</Label>
                <DatePicker value={payDate} onChange={setPayDate} />
              </div>
              <div className="space-y-1.5">
                <Label>Способ оплаты</Label>
                <Select value={payMethod} onValueChange={(value) => setPayMethod(value === 'kaspi' ? 'kaspi' : 'cash')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Наличные</SelectItem>
                    <SelectItem value="kaspi">Безналичный</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Чек об оплате (обязательно)</Label>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => void uploadPayReceipt(e.target.files?.[0] || null)}
                  disabled={uploadingReceipt}
                />
                {uploadingReceipt ? <p className="text-xs text-muted-foreground"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Загрузка...</p> : null}
                {payReceiptUrl ? (
                  <div className="flex items-center gap-2 flex-wrap">
                    <a href={payReceiptUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 dark:text-emerald-300 underline">
                      Чек загружен — открыть файл
                    </a>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 text-[11px]"
                      onClick={() => void parsePayReceipt()}
                      disabled={parsingReceipt}
                    >
                      {parsingReceipt ? <Loader2 className="w-3 h-3 animate-spin mr-1" /> : null}
                      Распознать ИИ
                    </Button>
                  </div>
                ) : null}
                {receiptParseHint ? (
                  <div className="rounded-lg border border-emerald-300/20 bg-emerald-500/[0.06] p-2 text-[11px] text-emerald-700 dark:text-emerald-100 space-y-1">
                    {receiptParseHint.total != null ? <p>Сумма в чеке: <b>{Math.round(receiptParseHint.total)} ₸</b></p> : null}
                    {receiptParseHint.method ? <p>Способ: {receiptParseHint.method === 'kaspi' ? 'Безналичный' : 'Наличные'}</p> : null}
                    {receiptParseHint.paid_at ? <p>Дата: {receiptParseHint.paid_at}</p> : null}
                    {receiptParseHint.merchant ? <p>Получатель: {receiptParseHint.merchant}</p> : null}
                    {receiptParseHint.warning ? (
                      <p className="text-rose-600 dark:text-rose-300 mt-1">⚠ {receiptParseHint.warning}</p>
                    ) : (
                      <p className="text-emerald-600 dark:text-emerald-300 mt-1">✓ Совпадает с долгом</p>
                    )}
                  </div>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label>Комментарий</Label>
                <Textarea rows={3} value={payComment} onChange={(e) => setPayComment(e.target.value)} placeholder="Опционально" />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={closePay} disabled={paying}>Отмена</Button>
              <Button onClick={submitPay} disabled={paying || !payReceiptUrl}>
                {paying ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Сохраняю...</> : 'Провести оплату'}
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {writeOffDebt ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !writingOff && setWriteOffDebt(null)}>
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-border bg-white dark:bg-slate-950/95 p-6 text-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Списать долг</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {writeOffDebt.supplier?.organization_name || writeOffDebt.supplier?.name || '—'} · {formatMoney(writeOffDebt.total_amount)} ₸
                </p>
              </div>
              <button onClick={() => !writingOff && setWriteOffDebt(null)} className="rounded-xl border border-border p-2 text-muted-foreground hover:text-slate-900 dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <Label>Причина списания</Label>
              <Textarea
                rows={3}
                value={writeOffReason}
                onChange={(e) => setWriteOffReason(e.target.value)}
                placeholder="Например: возврат поставщику, поставщик закрылся, бракованный товар"
              />
              <p className="text-xs text-muted-foreground">
                Списанный долг не создаст расход. Действие будет в журнале аудита.
              </p>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setWriteOffDebt(null)} disabled={writingOff}>Отмена</Button>
              <Button onClick={submitWriteOff} disabled={writingOff} className="bg-amber-600 hover:bg-amber-500">
                {writingOff ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Списываю...</> : 'Списать'}
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {bulkPayOpen ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !bulkPaying && setBulkPayOpen(false)}>
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-border bg-white dark:bg-slate-950/95 p-6 text-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Оплата нескольких долгов</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Будет закрыто {selectedIds.size} долгов на сумму {formatMoney(selectedSum)} ₸ одним чеком.
                </p>
              </div>
              <button onClick={() => !bulkPaying && setBulkPayOpen(false)} className="rounded-xl border border-border p-2 text-muted-foreground hover:text-slate-900 dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Дата оплаты</Label>
                <DatePicker value={bulkDate} onChange={setBulkDate} />
              </div>
              <div className="space-y-1.5">
                <Label>Способ оплаты</Label>
                <Select value={bulkMethod} onValueChange={(v) => setBulkMethod(v === 'kaspi' ? 'kaspi' : 'cash')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Наличные</SelectItem>
                    <SelectItem value="kaspi">Безналичный</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Чек об оплате (общий, обязательно)</Label>
                <Input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => void uploadBulkReceipt(e.target.files?.[0] || null)}
                  disabled={bulkUploading}
                />
                {bulkUploading ? <p className="text-xs text-muted-foreground"><Loader2 className="w-3 h-3 inline animate-spin mr-1" />Загрузка...</p> : null}
                {bulkReceiptUrl ? (
                  <a href={bulkReceiptUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 dark:text-emerald-300 underline">
                    Чек загружен — открыть файл
                  </a>
                ) : null}
                <p className="text-[10px] text-muted-foreground">Один и тот же чек прикрепится ко всем выбранным расходам.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Комментарий</Label>
                <Textarea rows={2} value={bulkComment} onChange={(e) => setBulkComment(e.target.value)} placeholder="Опционально" />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setBulkPayOpen(false)} disabled={bulkPaying}>Отмена</Button>
              <Button onClick={submitBulkPay} disabled={bulkPaying || !bulkReceiptUrl}>
                {bulkPaying ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Сохраняю...</> : `Закрыть ${selectedIds.size} долгов`}
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}

      {reschedDebt ? (
        <ModalPortal>
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !rescheduling && setReschedDebt(null)}>
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-border bg-white dark:bg-slate-950/95 p-6 text-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Перенести срок оплаты</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {reschedDebt.supplier?.organization_name || reschedDebt.supplier?.name || '—'} · {formatMoney(reschedDebt.total_amount)} ₸
                </p>
                {reschedDebt.due_date ? (
                  <p className="text-xs text-muted-foreground mt-1">Текущий срок: {fmtDate(reschedDebt.due_date)}</p>
                ) : null}
              </div>
              <button onClick={() => !rescheduling && setReschedDebt(null)} className="rounded-xl border border-border p-2 text-muted-foreground hover:text-slate-900 dark:hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Новый срок (пусто = снять срок)</Label>
                <DatePicker value={reschedDate} onChange={setReschedDate} />
              </div>
              <div className="space-y-1.5">
                <Label>Причина (опционально)</Label>
                <Textarea
                  rows={2}
                  value={reschedReason}
                  onChange={(e) => setReschedReason(e.target.value)}
                  placeholder="Например: договорились с поставщиком о рассрочке"
                />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReschedDebt(null)} disabled={rescheduling}>Отмена</Button>
              <Button onClick={submitReschedule} disabled={rescheduling}>
                {rescheduling ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Сохраняю...</> : 'Перенести срок'}
              </Button>
            </div>
          </div>
        </div>
        </ModalPortal>
      ) : null}
    </div>
  )
}
