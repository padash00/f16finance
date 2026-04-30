'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Receipt, FileText, Wallet, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

export default function BillingPage() {
  const [activeTab, setActiveTab] = useState<'debts' | 'invoices'>('debts')
  const [statusFilter, setStatusFilter] = useState<'open' | 'paid' | 'written_off' | 'all'>('open')
  const [debts, setDebts] = useState<Debt[]>([])
  const [receipts, setReceipts] = useState<ReceiptLite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const [payDebt, setPayDebt] = useState<Debt | null>(null)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
  const [payMethod, setPayMethod] = useState<'cash' | 'kaspi'>('cash')
  const [payReceiptUrl, setPayReceiptUrl] = useState('')
  const [payComment, setPayComment] = useState('')
  const [paying, setPaying] = useState(false)
  const [uploadingReceipt, setUploadingReceipt] = useState(false)

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

  const totalsByStatus = useMemo(() => {
    const result = { open: 0, openCount: 0, overdue: 0, overdueCount: 0 }
    const now = Date.now()
    for (const d of debts) {
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
  }, [debts])

  const groupedReceipts = useMemo(() => {
    const map = new Map<string, ReceiptLite[]>()
    for (const r of receipts) {
      const key = String(r.received_at || '').slice(0, 10) || 'unknown'
      const list = map.get(key) || []
      list.push(r)
      map.set(key, list)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a < b ? 1 : -1))
      .map(([date, items]) => ({ date, items }))
  }, [receipts])

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
    <div className="app-page max-w-[1500px] space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
            <Wallet className="w-6 h-6 text-emerald-300" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Долги и накладные</h1>
            <p className="text-sm text-muted-foreground">Учёт обязательств перед поставщиками и история приёмок</p>
          </div>
        </div>
      </div>

      <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl w-fit border border-gray-700">
        <button
          onClick={() => setActiveTab('debts')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'debts' ? 'bg-emerald-500/20 text-emerald-200' : 'text-muted-foreground hover:text-white'}`}
        >
          <Wallet className="w-4 h-4" /> Долги
        </button>
        <button
          onClick={() => setActiveTab('invoices')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${activeTab === 'invoices' ? 'bg-emerald-500/20 text-emerald-200' : 'text-muted-foreground hover:text-white'}`}
        >
          <FileText className="w-4 h-4" /> Накладные
        </button>
      </div>

      {error ? (
        <Card className="p-3 border-red-500/30 bg-red-500/10 text-sm text-red-200">{error}</Card>
      ) : null}
      {success ? (
        <Card className="p-3 border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-200">{success}</Card>
      ) : null}

      {activeTab === 'debts' ? (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Card className="p-3 bg-gray-900/60 border-gray-800">
              <div className="text-[11px] text-muted-foreground uppercase">Открытых долгов</div>
              <div className="text-lg font-bold text-amber-300">{totalsByStatus.openCount}</div>
              <div className="text-xs text-muted-foreground">{formatMoney(totalsByStatus.open)} ₸</div>
            </Card>
            <Card className="p-3 bg-gray-900/60 border-gray-800">
              <div className="text-[11px] text-muted-foreground uppercase">Просрочено</div>
              <div className="text-lg font-bold text-red-300">{totalsByStatus.overdueCount}</div>
              <div className="text-xs text-muted-foreground">{formatMoney(totalsByStatus.overdue)} ₸</div>
            </Card>
            <Card className="p-3 bg-gray-900/60 border-gray-800">
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

          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка...
            </div>
          ) : debts.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground text-center">Долгов нет.</Card>
          ) : (
            <div className="space-y-2">
              {debts.map((debt) => (
                <Card key={debt.id} className="p-4 bg-gray-900/60 border-gray-800">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-semibold">{debt.supplier?.organization_name || debt.supplier?.name || 'Поставщик не указан'}</span>
                        {debt.supplier?.bin_iin ? <span className="text-xs text-muted-foreground">· {debt.supplier.bin_iin}</span> : null}
                        {debt.is_consignment ? (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-200 border border-purple-500/30">реализация</span>
                        ) : null}
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full border ${
                            debt.status === 'open'
                              ? 'bg-amber-500/15 text-amber-200 border-amber-500/30'
                              : debt.status === 'paid'
                              ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
                              : 'bg-gray-500/15 text-gray-200 border-gray-500/30'
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
                          <a href={debt.receipt.invoice_file_url} target="_blank" rel="noreferrer" className="text-emerald-300 underline">
                            Накладная ↗
                          </a>
                        ) : null}
                        {debt.payment_receipt_file_url ? (
                          <a href={debt.payment_receipt_file_url} target="_blank" rel="noreferrer" className="text-emerald-300 underline">
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
                      {debt.status === 'open' ? (
                        <Button onClick={() => openPay(debt)}>Оплатить</Button>
                      ) : null}
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка...
            </div>
          ) : groupedReceipts.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground text-center">Накладных нет.</Card>
          ) : (
            <div className="space-y-4">
              {groupedReceipts.map(({ date, items }) => (
                <div key={date} className="space-y-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground border-b border-white/10 pb-1">
                    {fmtDate(date)} · накладных: {items.length}
                  </div>
                  {items.map((r) => (
                    <Card key={r.id} className="p-4 bg-gray-900/60 border-gray-800">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Receipt className="w-4 h-4 text-emerald-300" />
                            <span className="font-semibold">{r.invoice_number || `#${(r.id || '').slice(0, 8)}`}</span>
                            <span className="text-muted-foreground">· {r.supplier?.organization_name || r.supplier?.name || '—'}</span>
                            {r.location?.name ? (
                              <span className="text-xs text-muted-foreground">→ {r.location.name}</span>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                            <span>Позиций: {r.items?.length || 0}</span>
                            {r.invoice_file_url ? (
                              <a href={r.invoice_file_url} target="_blank" rel="noreferrer" className="text-emerald-300 underline">
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={closePay}>
          <div
            className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold">Оплата долга</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  {payDebt.supplier?.organization_name || payDebt.supplier?.name || '—'} · {formatMoney(payDebt.total_amount)} ₸
                </p>
              </div>
              <button onClick={closePay} className="rounded-xl border border-white/10 p-2 text-muted-foreground hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Дата оплаты</Label>
                <Input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Способ оплаты</Label>
                <Select value={payMethod} onValueChange={(value) => setPayMethod(value === 'kaspi' ? 'kaspi' : 'cash')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Наличные</SelectItem>
                    <SelectItem value="kaspi">Kaspi</SelectItem>
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
                  <a href={payReceiptUrl} target="_blank" rel="noreferrer" className="text-xs text-emerald-300 underline">
                    Чек загружен — открыть файл
                  </a>
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
      ) : null}
    </div>
  )
}
