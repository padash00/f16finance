'use client'

import { useEffect, useMemo, useState } from 'react'
import { ClipboardList, Loader2, MessageCircle, Plus, Trash2, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useModalEscape } from '@/lib/client/use-modal-escape'

type OrderStatus = 'draft' | 'sent' | 'received' | 'cancelled'

type SupplierLite = {
  id: string
  name: string
  organization_name: string | null
  sales_rep_name: string | null
  sales_rep_phone: string | null
}

type OrderRow = {
  id: string
  supplier_id: string
  status: OrderStatus
  is_auto: boolean
  comment: string | null
  sent_at: string | null
  received_at: string | null
  cancelled_at: string | null
  created_at: string
  item_count: number
  supplier: SupplierLite | null
}

type OrderItem = {
  id: string
  item_id: string
  current_qty: number
  threshold: number | null
  suggested_qty: number
  comment: string | null
  item: { id: string; name: string; barcode: string; unit: string | null } | null
}

type OrderDetail = {
  id: string
  status: OrderStatus
  is_auto: boolean
  comment: string | null
  sent_at: string | null
  received_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  created_at: string
  supplier: (SupplierLite & { bin_iin: string | null; phone: string | null; lead_time_days: number | null }) | null
  items: OrderItem[]
}

type CatalogItem = { id: string; name: string; barcode: string; unit?: string | null }

type DraftLine = { item_id: string; qty: string }

const STATUS_META: Record<OrderStatus, { label: string; cls: string }> = {
  draft: { label: 'Черновик', cls: 'bg-slate-500/15 text-slate-200 border-slate-500/30' },
  sent: { label: 'Отправлена', cls: 'bg-sky-500/15 text-sky-200 border-sky-500/30' },
  received: { label: 'Получена', cls: 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30' },
  cancelled: { label: 'Отменена', cls: 'bg-rose-500/15 text-rose-200 border-rose-500/30' },
}

const fmtDate = (value: string | null | undefined) => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('ru-RU')
  } catch {
    return String(value)
  }
}

export default function PurchaseOrdersPage() {
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all')

  // create dialog
  const [createOpen, setCreateOpen] = useState(false)
  const [suppliers, setSuppliers] = useState<SupplierLite[]>([])
  const [catalog, setCatalog] = useState<CatalogItem[]>([])
  const [formSupplier, setFormSupplier] = useState('')
  const [formComment, setFormComment] = useState('')
  const [formLines, setFormLines] = useState<DraftLine[]>([{ item_id: '', qty: '' }])
  const [saving, setSaving] = useState(false)
  useModalEscape(createOpen, () => { if (!saving) setCreateOpen(false) })

  // detail dialog
  const [detail, setDetail] = useState<OrderDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  useModalEscape(!!detail, () => { if (!statusBusy) setDetail(null) })

  const load = async () => {
    setError(null)
    try {
      const url = statusFilter === 'all'
        ? '/api/admin/store/purchase-orders'
        : `/api/admin/store/purchase-orders?status=${statusFilter}`
      const response = await fetch(url, { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить заявки')
      setOrders(json.data?.orders || [])
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

  // Подгружаем поставщиков и каталог при первом открытии формы создания.
  useEffect(() => {
    if (!createOpen || (suppliers.length > 0 && catalog.length > 0)) return
    void (async () => {
      try {
        const [supRes, recRes] = await Promise.all([
          fetch('/api/admin/store/suppliers', { cache: 'no-store' }),
          fetch('/api/admin/store/receipts', { cache: 'no-store' }),
        ])
        const supJson = await supRes.json().catch(() => null)
        const recJson = await recRes.json().catch(() => null)
        if (supRes.ok && supJson?.ok) setSuppliers(supJson.data?.suppliers || [])
        if (recRes.ok && recJson?.ok) {
          setCatalog((recJson.data?.items || []).map((it: any) => ({
            id: it.id, name: it.name, barcode: it.barcode, unit: it.unit,
          })))
        }
      } catch {
        // ignore
      }
    })()
  }, [createOpen, suppliers.length, catalog.length])

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/purchase-orders/${id}`, { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить заявку')
      setDetail(json.data.order)
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setDetailLoading(false)
    }
  }

  const submitCreate = async () => {
    if (!formSupplier) {
      setError('Выберите поставщика')
      return
    }
    const items = formLines
      .map((l) => ({ item_id: l.item_id, suggested_qty: Number(String(l.qty).replace(',', '.')) }))
      .filter((l) => l.item_id && Number.isFinite(l.suggested_qty) && l.suggested_qty > 0)
    if (items.length === 0) {
      setError('Добавьте хотя бы одну позицию с количеством')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/store/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplier_id: formSupplier, comment: formComment.trim() || null, items }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось создать заявку')
      setSuccess('Заявка создана')
      setCreateOpen(false)
      setFormSupplier('')
      setFormComment('')
      setFormLines([{ item_id: '', qty: '' }])
      await load()
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  const buildWhatsAppText = (d: OrderDetail) => {
    const supplierName = d.supplier?.organization_name || d.supplier?.name || 'Поставщик'
    const today = new Date().toLocaleDateString('ru-RU')
    const lines = (d.items || []).map((it, i) => {
      const unit = it.item?.unit || 'шт'
      return `${i + 1}. ${it.item?.name || 'Товар'} — ${it.suggested_qty} ${unit}`
    })
    let text = `Заявка на закуп\n${supplierName}\nДата: ${today}\n\n${lines.join('\n')}`
    if (d.comment) text += `\n\nКомментарий: ${d.comment}`
    return text
  }

  const sendWhatsApp = async () => {
    if (!detail) return
    const phone = (detail.supplier?.sales_rep_phone || '').replace(/\D/g, '')
    if (!phone) {
      setError('У поставщика не указан WhatsApp торгпреда — заполните в карточке поставщика')
      return
    }
    const url = `https://wa.me/${phone}?text=${encodeURIComponent(buildWhatsAppText(detail))}`
    window.open(url, '_blank', 'noopener,noreferrer')
    // Полу-авто: открыли чат с готовым текстом → помечаем заявку отправленной.
    await changeStatus('sent')
  }

  const changeStatus = async (next: OrderStatus, cancelReason?: string) => {
    if (!detail) return
    setStatusBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/admin/store/purchase-orders/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next, cancel_reason: cancelReason || null }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось обновить статус')
      setSuccess('Статус обновлён')
      setDetail(null)
      await load()
    } catch (err: any) {
      setError(err?.message || 'Ошибка')
    } finally {
      setStatusBusy(false)
    }
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: orders.length, draft: 0, sent: 0, received: 0, cancelled: 0 }
    for (const o of orders) c[o.status] = (c[o.status] || 0) + 1
    return c
  }, [orders])

  return (
    <div className="app-page max-w-[1600px] space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 shrink-0">
            <ClipboardList className="w-6 h-6 text-amber-300" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold">Заявки поставщикам</h1>
            <p className="text-sm text-muted-foreground">Заказы на закуп товара. Создавайте вручную, скоро — авто по остаткам.</p>
          </div>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="w-4 h-4 mr-1" /> Создать заявку
        </Button>
      </div>

      {error ? <Card className="p-3 border-red-500/30 bg-red-500/10 text-sm text-red-200">{error}</Card> : null}
      {success ? <Card className="p-3 border-emerald-500/30 bg-emerald-500/10 text-sm text-emerald-200">{success}</Card> : null}

      <div className="flex flex-wrap gap-2 p-1 bg-slate-800/50 rounded-xl w-fit border border-slate-700">
        {(['all', 'draft', 'sent', 'received', 'cancelled'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition ${
              statusFilter === s ? 'bg-emerald-500/20 text-emerald-200' : 'text-muted-foreground hover:text-white'
            }`}
          >
            {s === 'all' ? 'Все' : STATUS_META[s].label} ({counts[s] || 0})
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : orders.length === 0 ? (
        <Card className="p-8 text-sm text-muted-foreground text-center">Заявок нет. Создайте первую кнопкой выше.</Card>
      ) : (
        <div className="space-y-2">
          {orders.map((o) => (
            <Card
              key={o.id}
              className="p-3 bg-slate-900/60 border-slate-800 cursor-pointer hover:border-emerald-500/40 transition"
              onClick={() => void openDetail(o.id)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium truncate">
                      {o.supplier?.organization_name || o.supplier?.name || 'Поставщик'}
                    </span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META[o.status].cls}`}>
                      {STATUS_META[o.status].label}
                    </span>
                    {o.is_auto ? (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-200 border-amber-500/30">авто</span>
                    ) : null}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {o.item_count} позиций · создана {fmtDate(o.created_at)}
                    {o.sent_at ? ` · отправлена ${fmtDate(o.sent_at)}` : ''}
                  </div>
                </div>
                <span className="text-emerald-300 text-sm shrink-0">Открыть →</span>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Создание заявки */}
      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!saving) setCreateOpen(false) }}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h2 className="text-lg font-semibold">Новая заявка поставщику</h2>
              <button onClick={() => setCreateOpen(false)} className="text-muted-foreground hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            <div className="space-y-3 mt-4">
              <div className="space-y-1.5">
                <Label>Поставщик</Label>
                <Select value={formSupplier || '__none__'} onValueChange={(v) => setFormSupplier(v === '__none__' ? '' : v)}>
                  <SelectTrigger><SelectValue placeholder="Выберите поставщика" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Выберите поставщика</SelectItem>
                    {suppliers.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.organization_name || s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Позиции</Label>
                {formLines.map((line, index) => (
                  <div key={index} className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2">
                    <Select
                      value={line.item_id || `__none__${index}`}
                      onValueChange={(v) =>
                        setFormLines((cur) => cur.map((l, i) => i === index ? { ...l, item_id: v.startsWith('__none__') ? '' : v } : l))
                      }
                    >
                      <SelectTrigger className="min-w-0 [&>span]:block [&>span]:truncate"><SelectValue placeholder="Товар" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value={`__none__${index}`}>Выберите товар</SelectItem>
                        {catalog.map((it) => (
                          <SelectItem key={it.id} value={it.id} title={`${it.name} · ${it.barcode}`}>
                            <span className="block max-w-[360px] truncate">{it.name} · {it.barcode}</span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      inputMode="decimal"
                      placeholder="Кол-во"
                      value={line.qty}
                      onChange={(e) => setFormLines((cur) => cur.map((l, i) => i === index ? { ...l, qty: e.target.value } : l))}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setFormLines((cur) => cur.length === 1 ? cur : cur.filter((_, i) => i !== index))}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setFormLines((cur) => [...cur, { item_id: '', qty: '' }])}>
                  <Plus className="w-4 h-4 mr-1" /> Добавить позицию
                </Button>
              </div>

              <div className="space-y-1.5">
                <Label>Комментарий (опц.)</Label>
                <Input value={formComment} onChange={(e) => setFormComment(e.target.value)} placeholder="Например: срочно, до пятницы" />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={saving}>Отмена</Button>
              <Button onClick={submitCreate} disabled={saving}>
                {saving ? <><Loader2 className="w-4 h-4 animate-spin mr-1" />Создаю...</> : 'Создать заявку'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Детали заявки */}
      {detail ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => { if (!statusBusy) setDetail(null) }}>
          <div
            className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl border border-white/10 bg-slate-950/95 p-6 text-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-semibold">{detail.supplier?.organization_name || detail.supplier?.name || 'Заявка'}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_META[detail.status].cls}`}>
                    {STATUS_META[detail.status].label}
                  </span>
                  {detail.is_auto ? (
                    <span className="text-[10px] px-2 py-0.5 rounded-full border bg-amber-500/15 text-amber-200 border-amber-500/30">авто</span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">создана {fmtDate(detail.created_at)}</span>
                </div>
              </div>
              <button onClick={() => setDetail(null)} className="text-muted-foreground hover:text-white"><X className="w-5 h-5" /></button>
            </div>

            {detail.supplier ? (
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
                {detail.supplier.sales_rep_name ? <span>Торгпред: {detail.supplier.sales_rep_name}</span> : null}
                {detail.supplier.sales_rep_phone ? <span>WhatsApp: {detail.supplier.sales_rep_phone}</span> : null}
                {detail.supplier.lead_time_days != null ? <span>Срок поставки: {detail.supplier.lead_time_days} дн</span> : null}
              </div>
            ) : null}

            {detail.comment ? (
              <p className="mt-2 text-sm text-muted-foreground">Комментарий: {detail.comment}</p>
            ) : null}
            {detail.cancel_reason ? (
              <p className="mt-2 text-sm text-rose-300">Причина отмены: {detail.cancel_reason}</p>
            ) : null}

            <div className="mt-4 overflow-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/[0.03] text-xs text-muted-foreground">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-normal">Товар</th>
                    <th className="px-3 py-2 text-right font-normal">Остаток был</th>
                    <th className="px-3 py-2 text-right font-normal">Заказать</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.items || []).map((it) => (
                    <tr key={it.id} className="border-t border-white/[0.06]">
                      <td className="px-3 py-2">
                        <span className="block truncate">{it.item?.name || 'Товар'}</span>
                        <span className="block font-mono text-[10px] text-muted-foreground">{it.item?.barcode || '—'}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                        {it.current_qty} {it.item?.unit || 'шт'}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold text-emerald-200">
                        {it.suggested_qty} {it.item?.unit || 'шт'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              {detail.status === 'draft' ? (
                <>
                  <Button
                    className="bg-amber-600 hover:bg-amber-700"
                    onClick={() => void sendWhatsApp()}
                    disabled={statusBusy}
                  >
                    {statusBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <MessageCircle className="w-4 h-4 mr-1" />}
                    Отправить в WhatsApp
                  </Button>
                  <Button variant="outline" onClick={() => void changeStatus('sent')} disabled={statusBusy}>
                    Просто отметить «Отправлена»
                  </Button>
                </>
              ) : null}
              {detail.status === 'sent' ? (
                <Button onClick={() => void changeStatus('received')} disabled={statusBusy}>
                  {statusBusy ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                  Отметить «Получена»
                </Button>
              ) : null}
              {detail.status === 'draft' || detail.status === 'sent' ? (
                <Button
                  variant="outline"
                  className="border-rose-500/40 text-rose-200 hover:bg-rose-500/10"
                  disabled={statusBusy}
                  onClick={() => {
                    const reason = window.prompt('Причина отмены (необязательно):') ?? undefined
                    void changeStatus('cancelled', reason || undefined)
                  }}
                >
                  Отменить
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {detailLoading ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
          <Loader2 className="w-6 h-6 animate-spin text-emerald-300" />
        </div>
      ) : null}
    </div>
  )
}
