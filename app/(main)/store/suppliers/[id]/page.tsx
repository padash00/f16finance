'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { ArrowLeft, Building2, FileText, Loader2, Plus, Receipt, Tag, Trash2, Wallet } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatMoney } from '@/lib/core/format'

type Supplier = {
  id: string
  name: string
  organization_name: string | null
  bin_iin: string | null
  contact_name: string | null
  phone: string | null
  notes: string | null
  preferred_expense_category_id: string | null
  preferred_expense_category_name: string | null
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

  const [tab, setTab] = useState<'overview' | 'receipts' | 'debts' | 'aliases'>('overview')
  const [supplier, setSupplier] = useState<Supplier | null>(null)
  const [receipts, setReceipts] = useState<ReceiptLite[]>([])
  const [debts, setDebts] = useState<Debt[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  // Add-alias form state
  const [addAliasOpen, setAddAliasOpen] = useState(false)
  const [aliasName, setAliasName] = useState('')
  const [aliasItemId, setAliasItemId] = useState('')
  const [aliasUnit, setAliasUnit] = useState('')
  const [aliasSale, setAliasSale] = useState('')
  const [savingAlias, setSavingAlias] = useState(false)
  const [catalog, setCatalog] = useState<CatalogItem[]>([])

  const load = async () => {
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/suppliers/${supplierId}`, { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить поставщика')
      setSupplier(json.data.supplier)
      setReceipts(json.data.receipts || [])
      setDebts(json.data.debts || [])
      setAliases(json.data.aliases || [])
      setStats(json.data.stats || null)
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
        <Link href="/store/suppliers" className="inline-flex items-center text-sm text-emerald-300 hover:text-emerald-200">
          <ArrowLeft className="w-4 h-4 mr-1" /> К списку поставщиков
        </Link>
        <Card className="p-6 text-sm text-red-200 border-red-500/30 bg-red-500/10">{error || 'Поставщик не найден'}</Card>
      </div>
    )
  }

  return (
    <div className="app-page max-w-[1400px] space-y-5">
      <Link href="/store/suppliers" className="inline-flex items-center text-sm text-emerald-300 hover:text-emerald-200">
        <ArrowLeft className="w-4 h-4 mr-1" /> К списку поставщиков
      </Link>

      <div className="flex items-start gap-4">
        <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20 shrink-0">
          <Building2 className="w-6 h-6 text-emerald-300" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-semibold">{supplier.organization_name || supplier.name}</h1>
          {supplier.organization_name && supplier.organization_name !== supplier.name ? (
            <p className="text-sm text-muted-foreground">{supplier.name}</p>
          ) : null}
          <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
            {supplier.bin_iin ? <span>БИН/ИИН: <span className="font-mono">{supplier.bin_iin}</span></span> : null}
            {supplier.contact_name ? <span>Контакт: {supplier.contact_name}</span> : null}
            {supplier.phone ? <span>Тел: {supplier.phone}</span> : null}
            {supplier.preferred_expense_category_name ? (
              <span>COGS-категория: {supplier.preferred_expense_category_name}</span>
            ) : null}
          </div>
        </div>
      </div>

      {error ? <Card className="p-3 border-red-500/30 bg-red-500/10 text-sm text-red-200">{error}</Card> : null}
      {success ? <Card className="p-3 border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-200">{success}</Card> : null}

      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3 bg-gray-900/60 border-gray-800">
            <div className="text-[11px] text-muted-foreground uppercase">Накладных</div>
            <div className="text-lg font-bold">{stats.receiptsCount}</div>
            <div className="text-xs text-muted-foreground">{formatMoney(stats.totalSpend)} ₸ оборот</div>
          </Card>
          <Card className="p-3 bg-gray-900/60 border-gray-800">
            <div className="text-[11px] text-muted-foreground uppercase">Открытые долги</div>
            <div className="text-lg font-bold text-amber-300">{stats.openDebtsCount}</div>
            <div className="text-xs text-muted-foreground">{formatMoney(stats.openDebtsSum)} ₸</div>
          </Card>
          <Card className="p-3 bg-gray-900/60 border-gray-800">
            <div className="text-[11px] text-muted-foreground uppercase">Алиасов AI</div>
            <div className="text-lg font-bold">{stats.aliasesCount}</div>
            <div className="text-xs text-muted-foreground">обученных строк</div>
          </Card>
          <Card className="p-3 bg-gray-900/60 border-gray-800">
            <div className="text-[11px] text-muted-foreground uppercase">Средний срок оплаты</div>
            <div className="text-lg font-bold">{stats.avgDaysToPay == null ? '—' : `${stats.avgDaysToPay} дн`}</div>
            <div className="text-xs text-muted-foreground">от приёмки до платежа</div>
          </Card>
        </div>
      ) : null}

      <div className="flex gap-2 p-1 bg-gray-800/50 rounded-xl w-fit border border-gray-700">
        <TabBtn active={tab === 'overview'} onClick={() => setTab('overview')} icon={<Building2 className="w-4 h-4" />} label="Обзор" />
        <TabBtn active={tab === 'receipts'} onClick={() => setTab('receipts')} icon={<Receipt className="w-4 h-4" />} label={`Накладные (${receipts.length})`} />
        <TabBtn active={tab === 'debts'} onClick={() => setTab('debts')} icon={<Wallet className="w-4 h-4" />} label={`Долги (${openDebts.length}/${debts.length})`} />
        <TabBtn active={tab === 'aliases'} onClick={() => setTab('aliases')} icon={<Tag className="w-4 h-4" />} label={`Алиасы (${aliases.length})`} />
      </div>

      {tab === 'overview' ? (
        <Card className="p-4 bg-gray-900/60 border-gray-800 text-sm space-y-2">
          <p className="text-muted-foreground">
            Здесь сводная информация о поставщике. Открытые долги и накладные перейдите по соответствующим вкладкам.
          </p>
          {supplier.notes ? (
            <div>
              <p className="text-[11px] uppercase text-muted-foreground">Заметки</p>
              <p className="mt-1">{supplier.notes}</p>
            </div>
          ) : null}
        </Card>
      ) : null}

      {tab === 'receipts' ? (
        receipts.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground text-center">Накладных от этого поставщика нет.</Card>
        ) : (
          <div className="space-y-2">
            {receipts.map((r) => (
              <Card key={r.id} className="p-3 bg-gray-900/60 border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm">
                      <FileText className="w-4 h-4 text-emerald-300 shrink-0" />
                      <span className="font-medium">{r.invoice_number || `#${r.id.slice(0, 8)}`}</span>
                      <span className="text-muted-foreground text-xs">· {fmtDate(r.received_at)}</span>
                      {r.location?.name ? <span className="text-muted-foreground text-xs">→ {r.location.name}</span> : null}
                    </div>
                    {r.invoice_file_url ? (
                      <a href={r.invoice_file_url} target="_blank" rel="noreferrer" className="text-xs text-emerald-300 underline">
                        Накладная ↗
                      </a>
                    ) : null}
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold">{formatMoney(r.total_amount)} ₸</div>
                    <div className="text-xs text-muted-foreground">{r.items?.length || 0} позиций</div>
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
              <Card key={d.id} className="p-3 bg-gray-900/60 border-gray-800">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium">{formatMoney(d.total_amount)} ₸</span>
                      {d.is_consignment ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-200 border border-purple-500/30">реализация</span> : null}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full border ${
                        d.status === 'open'
                          ? 'bg-amber-500/15 text-amber-200 border-amber-500/30'
                          : d.status === 'paid'
                          ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30'
                          : 'bg-gray-500/15 text-gray-200 border-gray-500/30'
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
                  <Link href={`/store/billing`} className="text-xs text-emerald-300 hover:text-emerald-200">
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
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.04] text-left text-xs text-muted-foreground">
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
                <tbody className="divide-y divide-white/[0.04]">
                  {aliases.map((a) => (
                    <tr key={a.id} className="hover:bg-white/[0.02]">
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
                          className="text-muted-foreground hover:text-red-300 transition"
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
            className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl"
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
    </div>
  )
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition ${
        active ? 'bg-emerald-500/20 text-emerald-200' : 'text-muted-foreground hover:text-white'
      }`}
    >
      {icon}
      {label}
    </button>
  )
}
