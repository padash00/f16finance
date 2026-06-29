'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Building2, FileText, Loader2, Plus, Receipt, Tag, Trash2, Wallet } from 'lucide-react'

import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/core/format'
import { useModalEscape } from '@/lib/client/use-modal-escape'

type Supplier = {
  id: string
  name: string
  organization_name: string | null
  bin_iin: string | null
  contact_name: string | null
  phone: string | null
  notes: string | null
  sales_rep_name: string | null
  sales_rep_phone: string | null
  lead_time_days: number | null
  preferred_expense_category_id: string | null
  preferred_expense_category_name: string | null
}

type Product = {
  id: string
  name: string
  barcode: string
  unit: string | null
  default_purchase_price: number
  supplier_unit_cost: number | null
  low_stock_threshold: number | null
  is_active: boolean
  stock: number
  avg_daily_consumption: number
  smart_threshold: number
  effective_threshold: number
  threshold_source: 'manual' | 'smart'
  needs_reorder: boolean
  suggested_qty: number
}

type ReceiptLite = {
  id: string
  received_at: string
  invoice_number: string | null
  invoice_file_url: string | null
  total_amount: number
  comment: string | null
  location: { id: string; name: string; code: string | null; location_type: string } | null
  items: Array<{ id: string }> | null
}

type Debt = {
  id: string
  receipt_id: string
  total_amount: number
  status: 'open' | 'paid' | 'written_off'
  due_date: string | null
  is_consignment: boolean
  payment_paid_at: string | null
  created_at: string
}

type Alias = {
  id: string
  invoice_name: string
  item_id: string
  last_unit_cost: number | null
  last_sale_price: number | null
  usage_count: number
  last_seen_at: string | null
  item: { name: string; barcode: string } | null
}

type Stats = {
  totalSpend: number
  openDebtsSum: number
  openDebtsCount: number
  receiptsCount: number
  aliasesCount: number
  productsCount: number
  reorderCount: number
  avgDaysToPay: number | null
}

type CatalogItem = { id: string; name: string; barcode: string; sale_price?: number }

const fmtDate = (value: string | null | undefined) => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('ru-RU')
  } catch {
    return String(value)
  }
}

export default function SupplierCardPage() {
  const params = useParams()
  const supplierId = String((params as any)?.id || '')

  const [tab, setTab] = useState<'overview' | 'products' | 'receipts' | 'debts' | 'aliases'>('overview')
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [receipts, setReceipts] = useState<ReceiptLite[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Форма настроек поставщика
  const [editForm, setEditForm] = useState({
    name: '',
    organization_name: '',
    bin_iin: '',
    contact_name: '',
    phone: '',
    sales_rep_name: '',
    sales_rep_phone: '',
    lead_time_days: '3',
    notes: '',
  })
  const [savingSupplier, setSavingSupplier] = useState(false)

  // Add-alias form state
  const [addAliasOpen, setAddAliasOpen] = useState(false)
  const [aliasName, setAliasName] = useState('')
  const [aliasItemId, setAliasItemId] = useState('')
  const [aliasUnit, setAliasUnit] = useState('')
  const [aliasSale, setAliasSale] = useState('')
  const [savingAlias, setSavingAlias] = useState(false)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  useModalEscape(addAliasOpen, () => { if (!savingAlias) setAddAliasOpen(false) })

  // Перенос к другому поставщику (товары / накладная)
  const [transferOpen, setTransferOpen] = useState(false)
  const [transferMode, setTransferMode] = useState<'items' | 'receipt'>('items')
  const [transferReceiptId, setTransferReceiptId] = useState<string | null>(null)
  const [transferReceiptLabel, setTransferReceiptLabel] = useState('')
  const [transferTarget, setTransferTarget] = useState('')
  const [supplierOptions, setSupplierOptions] = useState<{ id: string; name: string }[]>([])
  const [transferring, setTransferring] = useState(false)
  useModalEscape(transferOpen, () => { if (!transferring) setTransferOpen(false) })

  useEffect(() => {
    if (!transferOpen || supplierOptions.length > 0) return
    void (async () => {
      try {
        const res = await fetch('/api/admin/store/receipts', { cache: 'no-store' })
        const j = await res.json().catch(() => null)
        if (res.ok && j?.ok) {
          setSupplierOptions(((j.data?.suppliers || []) as any[]).map((s: any) => ({ id: String(s.id), name: s.name })).filter((s) => s.id !== supplierId))
        }
      } catch { /* ignore */ }
    })()
  }, [transferOpen, supplierOptions.length, supplierId])

  const openTransferItems = () => { setTransferMode('items'); setTransferReceiptId(null); setTransferTarget(''); setTransferOpen(true) }
  const openTransferReceipt = (rid: string, label: string) => { setTransferMode('receipt'); setTransferReceiptId(rid); setTransferReceiptLabel(label); setTransferTarget(''); setTransferOpen(true) }

  const doTransfer = async () => {
    if (!transferTarget) { setError('Выберите поставщика-получателя'); return }
    setTransferring(true); setError(null)
    try {
      const res = await fetch(`/api/admin/store/suppliers/${supplierId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          transferMode === 'receipt'
            ? { action: 'transferReceipt', receipt_id: transferReceiptId, target_supplier_id: transferTarget }
            : { action: 'transferItems', target_supplier_id: transferTarget },
        ),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Не удалось перенести')
      setTransferOpen(false); setTransferTarget(''); setTransferReceiptId(null)
      setSuccess(transferMode === 'receipt' ? `Накладная перенесена · товаров: ${j.data?.movedItems ?? 0}` : `Перенесено товаров: ${j.data?.movedItems ?? 0}`)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка переноса')
    } finally {
      setTransferring(false)
    }
  }

  const load = async () => {
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/suppliers/${supplierId}`, { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить поставщика')
      const s = json.data.supplier as Supplier
      setSupplier(s)
      setReceipts(json.data.receipts || [])
      setDebts(json.data.debts || [])
      setAliases(json.data.aliases || [])
      setProducts(json.data.products || [])
      setStats(json.data.stats || null)
      setEditForm({
        name: s.name || '',
        organization_name: s.organization_name || '',
        bin_iin: s.bin_iin || '',
        contact_name: s.contact_name || '',
        phone: s.phone || '',
        sales_rep_name: s.sales_rep_name || '',
        sales_rep_phone: s.sales_rep_phone || '',
        lead_time_days: String(s.lead_time_days ?? 3),
        notes: s.notes || '',
      })
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!supplierId) return
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplierId])

  // Catalog for the add-alias form (only loaded once when needed).
  useEffect(() => {
    if (catalog.length > 0 || !addAliasOpen) return
    void (async () => {
      try {
        const response = await fetch('/api/admin/store/receipts', { cache: 'no-store' })
        const json = await response.json().catch(() => null)
        if (response.ok && json?.ok) {
          setCatalog((json.data?.items || []).map((it: any) => ({
            id: it.id,
            name: it.name,
            barcode: it.barcode,
            sale_price: it.sale_price,
          })))
        }
      } catch {
        // ignore
      }
    })()
  }, [addAliasOpen, catalog.length])

  const submitAlias = async () => {
    if (!aliasName.trim() || !aliasItemId) {
      setError('Введите имя и выберите товар каталога')
      return
    }
    setSavingAlias(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/suppliers/${supplierId}/aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_name: aliasName.trim(),
          item_id: aliasItemId,
          last_unit_cost: aliasUnit ? Number(aliasUnit) : null,
          last_sale_price: aliasSale ? Number(aliasSale) : null,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось добавить алиас')
      setSuccess('Алиас добавлен')
      setAddAliasOpen(false)
      setAliasName('')
      setAliasItemId('')
      setAliasUnit('')
      setAliasSale('')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setSavingAlias(false)
    }
  }

  const deleteAlias = async (aliasId: string) => {
    if (!confirm('Удалить этот алиас? AI-распознавание для этой строки больше не будет автоподставлять данный товар.')) return
    try {
      const response = await fetch(`/api/admin/store/suppliers/${supplierId}/aliases?alias_id=${aliasId}`, {
        method: 'DELETE',
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось удалить')
      setSuccess('Алиас удалён')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    }
  }

  const saveSupplier = async () => {
    if (!editForm.name.trim()) {
      setError('Введите название поставщика')
      return
    }
    setSavingSupplier(true)
    setError(null)
    setSuccess(null)
    try {
      const response = await fetch('/api/admin/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateSupplier',
          id: supplierId,
          payload: {
            name: editForm.name.trim(),
            organization_name: editForm.organization_name.trim() || null,
            bin_iin: editForm.bin_iin.trim() || null,
            contact_name: editForm.contact_name.trim() || null,
            phone: editForm.phone.trim() || null,
            sales_rep_name: editForm.sales_rep_name.trim() || null,
            sales_rep_phone: editForm.sales_rep_phone.trim() || null,
            lead_time_days: editForm.lead_time_days ? Number(editForm.lead_time_days) : 3,
            notes: editForm.notes.trim() || null,
          },
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось сохранить')
      setSuccess('Настройки поставщика сохранены')
      await load()
    } catch (err: any) {
      setError(err?.message || 'Ошибка сохранения')
    } finally {
      setSavingSupplier(false)
    }
  }

  const openDebts = useMemo(() => debts.filter((d) => d.status === 'open'), [debts])

  if (loading) {
    return (
      <div className="app-page flex items-center justify-center py-20">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!supplier) {
    return (
      <div className="app-page max-w-2xl space-y-4">
        <Link href="/store/suppliers" className="inline-flex items-center text-sm text-emerald-600 dark:text-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-200">
          <ArrowLeft className="w-4 h-4 mr-1" /> К списку поставщиков
        </Link>
        <Card className="p-6 text-sm text-red-700 dark:text-red-200 border-red-500/30 bg-red-500/10">{error || 'Поставщик не найден'}</Card>
      </div>
    )
  }

  return (
    <div className="app-page max-w-[1600px] space-y-5">
      <AdminPageHeader
        title={supplier.organization_name || supplier.name}
        description={supplier.organization_name && supplier.organization_name !== supplier.name ? supplier.name : 'Карточка поставщика'}
        icon={<Building2 className="h-5 w-5" />}
        accent="emerald"
        backHref="/store/suppliers"
        toolbar={
          <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
            {supplier.bin_iin ? <span>БИН/ИИН: <span className="font-mono">{supplier.bin_iin}</span></span> : null}
            {supplier.contact_name ? <span>Контакт: {supplier.contact_name}</span> : null}
            {supplier.phone ? <span>Тел: {supplier.phone}</span> : null}
            {supplier.sales_rep_name ? <span>Торгпред: {supplier.sales_rep_name}</span> : null}
            {supplier.sales_rep_phone ? <span>WhatsApp: {supplier.sales_rep_phone}</span> : null}
            <span>Срок поставки: {supplier.lead_time_days ?? 3} дн</span>
            {supplier.preferred_expense_category_name ? (
              <span>COGS-категория: {supplier.preferred_expense_category_name}</span>
            ) : null}
          </div>
        }
      />

      {error ? <Card className="p-3 border-red-500/30 bg-red-500/10 text-sm text-red-700 dark:text-red-200">{error}</Card> : null}
      {success ? <Card className="p-3 border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-700 dark:text-emerald-200">{success}</Card> : null}

      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
            <div className="text-[11px] text-muted-foreground uppercase">Накладных</div>
            <div className="text-lg font-bold">{stats.receiptsCount}</div>
            <div className="text-xs text-muted-foreground">{formatMoney(stats.totalSpend)} ₸ оборот</div>
          </Card>
          <Card className="p-3 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
            <div className="text-[11px] text-muted-foreground uppercase">Открытые долги</div>
            <div className="text-lg font-bold text-amber-600 dark:text-amber-300">{stats.openDebtsCount}</div>
            <div className="text-xs text-muted-foreground">{formatMoney(stats.openDebtsSum)} ₸</div>
          </Card>
          <Card className="p-3 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
            <div className="text-[11px] text-muted-foreground uppercase">Алиасов AI</div>
            <div className="text-lg font-bold">{stats.aliasesCount}</div>
            <div className="text-xs text-muted-foreground">обученных строк</div>
          </Card>
          <Card className="p-3 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
            <div className="text-[11px] text-muted-foreground uppercase">Средний срок оплаты</div>
            <div className="text-lg font-bold">{stats.avgDaysToPay == null ? '—' : `${stats.avgDaysToPay} дн`}</div>
            <div className="text-xs text-muted-foreground">от приёмки до платежа</div>
          </Card>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 p-1 bg-slate-100 dark:bg-gray-800/50 rounded-xl w-fit border border-slate-200 dark:border-gray-700">
        <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')} icon={<Building2 className="w-4 h-4" />} label="Настройки" />
        <TabBtn active={tab === 'products'} onClick={() => setTab('products')} icon={<Tag className="w-4 h-4" />} label={`Товары (${products.length})`} />
        <TabBtn active={tab === 'receipts'} onClick={() => setTab('receipts')} icon={<Receipt className="w-4 h-4" />} label={`Накладные (${receipts.length})`} />
        <TabBtn active={tab === 'debts'} onClick={() => setTab('debts')} icon={<Wallet className="w-4 h-4" />} label={`Долги (${openDebts.length}/${debts.length})`} />
        <TabBtn active={tab === 'aliases'} onClick={() => setTab('aliases')} icon={<Tag className="w-4 h-4" />} label={`Алиасы (${aliases.length})`} />
      </div>

      {tab === 'overview' ? (
        <Card className="p-5 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 space-y-4 max-w-3xl">
          <div>
            <h2 className="text-lg font-semibold">Настройки поставщика</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Реквизиты, торговый представитель и срок поставки. Эти данные используются для авто-заявок и отправки в WhatsApp.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Название поставщика *</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="Coca-Cola Алматы" />
            </div>
            <div className="space-y-1.5">
              <Label>Название организации</Label>
              <Input value={editForm.organization_name} onChange={(e) => setEditForm((f) => ({ ...f, organization_name: e.target.value }))} placeholder="ТОО «...»" />
            </div>
            <div className="space-y-1.5">
              <Label>БИН/ИИН</Label>
              <Input value={editForm.bin_iin} onChange={(e) => setEditForm((f) => ({ ...f, bin_iin: e.target.value }))} placeholder="123456789012" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label>Срок поставки, дней</Label>
              <Input value={editForm.lead_time_days} onChange={(e) => setEditForm((f) => ({ ...f, lead_time_days: e.target.value.replace(/\D/g, '') }))} placeholder="3" inputMode="numeric" />
            </div>
          </div>

          <div className="border-t border-border pt-4 space-y-3">
            <p className="text-[11px] uppercase tracking-wider text-emerald-700 dark:text-emerald-300/80 font-medium">Торговый представитель</p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Имя торгпреда</Label>
                <Input value={editForm.sales_rep_name} onChange={(e) => setEditForm((f) => ({ ...f, sales_rep_name: e.target.value }))} placeholder="Айдос" />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp-номер торгпреда</Label>
                <Input value={editForm.sales_rep_phone} onChange={(e) => setEditForm((f) => ({ ...f, sales_rep_phone: e.target.value }))} placeholder="+7 701 234 56 78" inputMode="tel" />
              </div>
            </div>
            <p className="text-[11px] text-muted-foreground">
              На этот номер будут уходить заявки на закуп через WhatsApp (Этап 5).
            </p>
          </div>

          <div className="border-t border-border pt-4 grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Контактное лицо (общее)</Label>
              <Input value={editForm.contact_name} onChange={(e) => setEditForm((f) => ({ ...f, contact_name: e.target.value }))} placeholder="Бухгалтер, менеджер..." />
            </div>
            <div className="space-y-1.5">
              <Label>Телефон (общий)</Label>
              <Input value={editForm.phone} onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+7 ..." inputMode="tel" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Заметки</Label>
              <Input value={editForm.notes} onChange={(e) => setEditForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Любые заметки о поставщике" />
            </div>
          </div>

          <div className="flex justify-end">
            <Button onClick={saveSupplier} disabled={savingSupplier}>
              {savingSupplier ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Сохраняю...</> : 'Сохранить настройки'}
            </Button>
          </div>
        </Card>
      ) : null}

      {tab === 'products' ? (
        products.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            За этим поставщиком пока не закреплено товаров. Товар закрепляется автоматически при проведении приёмки от этого поставщика.
          </Card>
        ) : (
          <Card className="bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800 overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 p-3 border-b border-border text-xs text-muted-foreground">
              <span>
                Умный порог = расход/день × срок поставки ({supplier.lead_time_days ?? 3} дн) × 1.5.
                {stats && stats.reorderCount > 0 ? (
                  <span className="ml-1 text-amber-600 dark:text-amber-300 font-medium">Пора заказывать: {stats.reorderCount}.</span>
                ) : (
                  <span className="ml-1 text-emerald-600 dark:text-emerald-300">Всё в норме.</span>
                )}
              </span>
              <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={openTransferItems}>
                <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                Перенести все товары к поставщику
              </Button>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-muted text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-normal">Товар</th>
                    <th className="px-3 py-2 text-right font-normal">Остаток</th>
                    <th className="px-3 py-2 text-right font-normal">Закупка</th>
                    <th className="px-3 py-2 text-right font-normal">Расход/день</th>
                    <th className="px-3 py-2 text-right font-normal">Порог</th>
                    <th className="px-3 py-2 text-right font-normal">Дозаказать</th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className={`border-t border-slate-100 dark:border-white/[0.06] ${p.needs_reorder ? 'bg-amber-500/[0.04]' : ''}`}>
                      <td className="px-3 py-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="block truncate">{p.name}</span>
                          {!p.is_active ? (
                            <span className="shrink-0 rounded-full border border-gray-500/30 bg-gray-500/10 px-1.5 py-0.5 text-[10px] text-gray-600 dark:text-gray-300">архив</span>
                          ) : null}
                          {p.needs_reorder ? (
                            <span className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">пора заказывать</span>
                          ) : null}
                        </span>
                        <span className="block font-mono text-[10px] text-muted-foreground mt-0.5">{p.barcode || '—'}</span>
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${p.needs_reorder ? 'text-amber-700 dark:text-amber-300 font-semibold' : ''}`}>
                        {p.stock} {p.unit || 'шт'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {(() => {
                          const cost = p.supplier_unit_cost ?? p.default_purchase_price
                          return cost > 0 ? (
                            <span title={p.supplier_unit_cost != null ? 'последняя цена от этого поставщика' : 'из каталога'}>
                              {Math.round(cost).toLocaleString('ru-RU')} ₸
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {p.avg_daily_consumption > 0 ? `${p.avg_daily_consumption}/дн` : '—'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span>{p.effective_threshold || '—'}</span>
                        <span className={`ml-1 text-[10px] ${p.threshold_source === 'manual' ? 'text-sky-600 dark:text-sky-300' : 'text-violet-600 dark:text-violet-300'}`}>
                          {p.threshold_source === 'manual' ? 'ручной' : 'умный'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {p.needs_reorder && p.suggested_qty > 0 ? (
                          <span className="font-semibold text-amber-700 dark:text-amber-200">+{p.suggested_qty} {p.unit || 'шт'}</span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      ) : null}

      {tab === 'receipts' ? (
        receipts.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">Накладных от этого поставщика нет.</Card>
        ) : (
          <div className="space-y-2">
            {receipts.map((r) => (
              <Card key={r.id} className="p-3 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="w-4 h-4 text-emerald-600 dark:text-emerald-300 shrink-0" />
                      <span className="font-medium">{r.invoice_number || `#${r.id.slice(0, 8)}`}</span>
                      <span className="text-muted-foreground text-xs">· {fmtDate(r.received_at)}</span>
                      {r.location?.name ? <span className="text-muted-foreground text-xs">→ {r.location.name}</span> : null}
                    </div>
                    {r.invoice_file_url ? (
                      <a href={r.invoice_file_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-600 dark:text-emerald-300 underline">
                        Накладная ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <div className="text-right">
                      <div className="text-sm font-semibold">{formatMoney(r.total_amount)} ₸</div>
                      <div className="text-xs text-muted-foreground">{r.items?.length || 0} позиций</div>
                    </div>
                    <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => openTransferReceipt(r.id, r.invoice_number || `#${r.id.slice(0, 8)}`)}>
                      <ArrowLeft className="h-3.5 w-3.5 rotate-180" />
                      Перенести
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'debts' ? (
        debts.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">Долгов нет.</Card>
        ) : (
          <div className="space-y-2">
            {debts.map((d) => (
              <Card key={d.id} className="p-3 bg-white dark:bg-gray-900/60 border-slate-200 dark:border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{formatMoney(d.total_amount)} ₸</span>
                      {d.is_consignment ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-200 border border-purple-500/30">реализация</span> : null}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        d.status === 'open'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200 border-amber-500/30'
                          : d.status === 'paid'
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-200 border-emerald-500/30'
                          : 'bg-gray-500/15 text-gray-600 dark:text-gray-200 border-gray-500/30'
                      }`}>
                        {d.status === 'open' ? 'Открыт' : d.status === 'paid' ? 'Оплачен' : 'Списан'}
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground flex flex-wrap gap-3">
                      <span>Создан: {fmtDate(d.created_at)}</span>
                      {d.due_date ? <span>Срок: {fmtDate(d.due_date)}</span> : null}
                      {d.payment_paid_at ? <span>Оплачен: {fmtDate(d.payment_paid_at)}</span> : null}
                    </div>
                  </div>
                  <Link href={`/store/billing`} className="text-xs text-emerald-600 dark:text-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-200">
                    К долгам →
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )
      ) : null}

      {tab === 'aliases' ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Алиасы — это запомненные «raw_name» из накладных, которые AI автоматически связывает с товарами каталога.
              Удалите неверный или добавьте недостающий вручную.
            </p>
            <Button onClick={() => setAddAliasOpen(true)} size="sm">
              <Plus className="w-4 h-4 mr-1" /> Добавить алиас
            </Button>
          </div>

          {aliases.length === 0 ? (
            <Card className="p-6 text-sm text-muted-foreground text-center">Алиасов нет — заведутся после первой приёмки от этого поставщика.</Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 dark:bg-white/[0.04] text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2.5 font-normal">Имя из накладной (raw)</th>
                    <th className="px-3 py-2.5 font-normal">Товар каталога</th>
                    <th className="px-3 py-2.5 text-right font-normal">Закупка</th>
                    <th className="px-3 py-2.5 text-right font-normal">Розница</th>
                    <th className="px-3 py-2.5 text-right font-normal">Использований</th>
                    <th className="px-3 py-2.5 font-normal">Последний раз</th>
                    <th className="px-2 py-2.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {aliases.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                      <td className="px-3 py-2 max-w-[280px] truncate">{a.invoice_name}</td>
                      <td className="px-3 py-2">
                        <p className="truncate">{a.item?.name || '—'}</p>
                        {a.item?.barcode ? <p className="font-mono text-[10px] text-muted-foreground">{a.item.barcode}</p> : null}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">{a.last_unit_cost != null ? `${a.last_unit_cost} ₸` : '—'}</td>
                      <td className="px-3 py-2 text-right text-xs">{a.last_sale_price != null ? `${a.last_sale_price} ₸` : '—'}</td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">{a.usage_count}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(a.last_seen_at)}</td>
                      <td className="px-2 py-2 text-right">
                        <button
                          onClick={() => void deleteAlias(a.id)}
                          className="text-muted-foreground hover:text-red-600 dark:hover:text-red-300 transition"
                          title="Удалить алиас"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}

      {addAliasOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => !savingAlias && setAddAliasOpen(false)}>
          <div
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-border bg-white dark:bg-slate-950/95 p-6 text-foreground shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-semibold">Добавить алиас вручную</h2>
            <p className="text-xs text-muted-foreground mt-1">
              При следующей приёмке AI узнает указанное имя и автоматически подставит товар.
            </p>
            <div className="space-y-3 mt-4">
              <div className="space-y-1.5">
                <Label>Имя из накладной</Label>
                <Input value={aliasName} onChange={(e) => setAliasName(e.target.value)} placeholder='Например: "Coca-Cola 0.5 ст"' />
              </div>
              <div className="space-y-1.5">
                <Label>Товар каталога</Label>
                <Select value={aliasItemId || '__none__'} onValueChange={(v) => setAliasItemId(v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Выберите товар</SelectItem>
                    {catalog.map((it) => (
                      <SelectItem key={it.id} value={it.id} title={`${it.name} · ${it.barcode}`}>
                        <span className="block max-w-[360px] truncate">{it.name} · {it.barcode}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Закупка ₸ (опц.)</Label>
                  <Input inputMode="decimal" value={aliasUnit} onChange={(e) => setAliasUnit(e.target.value)} placeholder="0" />
                </div>
                <div className="space-y-1.5">
                  <Label>Розница ₸ (опц.)</Label>
                  <Input inputMode="decimal" value={aliasSale} onChange={(e) => setAliasSale(e.target.value)} placeholder="0" />
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddAliasOpen(false)} disabled={savingAlias}>Отмена</Button>
              <Button onClick={submitAlias} disabled={savingAlias}>
                {savingAlias ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Сохраняю...</> : 'Добавить'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {transferOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget && !transferring) setTransferOpen(false) }}>
          <Card className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto border-border bg-white dark:bg-gray-900 p-5">
            <div className="mb-1 text-base font-semibold text-foreground">Перенести к другому поставщику</div>
            <p className="mb-4 text-xs text-muted-foreground">
              {transferMode === 'receipt'
                ? <>Накладная <span className="text-foreground">{transferReceiptLabel}</span> и её товары перейдут выбранному поставщику.</>
                : <>Все товары поставщика <span className="text-foreground">{supplier?.name}</span> ({products.length}) перейдут выбранному поставщику.</>}
            </p>
            <Label className="mb-1.5 block text-xs">Поставщик-получатель</Label>
            <Select value={transferTarget} onValueChange={setTransferTarget}>
              <SelectTrigger><SelectValue placeholder="Выберите поставщика" /></SelectTrigger>
              <SelectContent>
                {supplierOptions.length === 0 ? (
                  <div className="px-2 py-2 text-xs text-muted-foreground">Загрузка…</div>
                ) : supplierOptions.map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setTransferOpen(false)} disabled={transferring}>Отмена</Button>
              <Button onClick={() => void doTransfer()} disabled={transferring || !transferTarget}>
                {transferring ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Переношу…</> : 'Перенести'}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
        active ? 'bg-emerald-500/20 text-emerald-700 dark:text-emerald-200' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
