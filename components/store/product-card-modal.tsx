'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Boxes,
  Camera,
  Loader2,
  Package,
  Pencil,
  TrendingUp,
  Truck,
  Warehouse,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

// ─── Types ─────────────────────────────────────────────────────────────────────

type StockRow = {
  location_id: string
  location: string
  location_type: string
  company: string | null
  quantity: number
}

type CardData = {
  id: string
  name: string
  barcode: string
  unit: string
  brand: string | null
  description: string | null
  image_url: string | null
  category: string | null
  pack_size: number
  low_stock_threshold: number | null
  sale_price: number
  default_purchase_price: number
  purchase_price: number
  margin_pct: number
  margin_abs: number
  total_stock: number
  stock_by_location: StockRow[]
  sold_30d: number
  velocity_per_week: number
  last_supplier: string | null
  last_purchase_price: number | null
  last_received_at: string | null
}

const fmt = (n: number) => Number(n || 0).toLocaleString('ru-RU')
const fmtMoney = (n: number) => `${fmt(Math.round((n + Number.EPSILON) * 100) / 100)} ₸`

function marginColor(pct: number): string {
  if (pct >= 30) return 'text-emerald-600 dark:text-emerald-400'
  if (pct >= 15) return 'text-amber-600 dark:text-amber-400'
  if (pct > 0) return 'text-orange-600 dark:text-orange-400'
  return 'text-rose-600 dark:text-rose-400'
}

// ─── Component ───────────────────────────────────────────────────────────────────

export default function ProductCardModal({
  itemId,
  open,
  onOpenChange,
  canEdit = false,
  onSaved,
}: {
  itemId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  canEdit?: boolean
  onSaved?: () => void
}) {
  const [data, setData] = useState<CardData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [savingDesc, setSavingDesc] = useState(false)
  const [editDesc, setEditDesc] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/store/catalog/${id}/card`, { cache: 'no-store' })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Не удалось загрузить карточку')
      setData(json.data)
      setDescDraft(json.data?.description || '')
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && itemId) {
      void load(itemId)
    } else if (!open) {
      setData(null)
      setError(null)
      setEditDesc(false)
    }
  }, [open, itemId, load])

  async function handlePhoto(file: File | null) {
    if (!file || !itemId) return
    if (!file.type.startsWith('image/')) {
      setError('Выберите изображение (JPG, PNG, WEBP)')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Файл слишком большой (макс 5 МБ)')
      return
    }
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const up = await fetch('/api/admin/store/catalog/photo-upload', { method: 'POST', body: fd })
      const upJson = await up.json().catch(() => null)
      if (!up.ok) throw new Error(upJson?.error || 'Не удалось загрузить фото')
      const imageUrl = upJson.image_url as string

      const patch = await fetch(`/api/admin/store/catalog/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: imageUrl }),
      })
      const patchJson = await patch.json().catch(() => null)
      if (!patch.ok) throw new Error(patchJson?.error || 'Не удалось сохранить фото')
      setData((d) => (d ? { ...d, image_url: imageUrl } : d))
      onSaved?.()
    } catch (e: any) {
      setError(e?.message || 'Ошибка загрузки фото')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function saveDescription() {
    if (!itemId) return
    setSavingDesc(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/store/catalog/${itemId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: descDraft }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Не удалось сохранить')
      setData((d) => (d ? { ...d, description: descDraft } : d))
      setEditDesc(false)
      onSaved?.()
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения')
    } finally {
      setSavingDesc(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-6">
            <Package className="h-5 w-5 text-emerald-500" />
            <span className="truncate">{data?.name || 'Карточка товара'}</span>
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Загрузка…
          </div>
        ) : error && !data ? (
          <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </div>
        ) : data ? (
          <div className="space-y-5">
            {error && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                {error}
              </div>
            )}

            <div className="grid gap-5 md:grid-cols-[200px_1fr]">
              {/* ── Фото ── */}
              <div className="space-y-2">
                <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.03]">
                  {data.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={data.image_url} alt={data.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-300 dark:text-white/20">
                      <Package className="h-16 w-16" />
                    </div>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <Loader2 className="h-7 w-7 animate-spin text-white" />
                    </div>
                  )}
                </div>
                {canEdit && (
                  <>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => void handlePhoto(e.target.files?.[0] || null)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={uploading}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Camera className="mr-1.5 h-3.5 w-3.5" />
                      {data.image_url ? 'Заменить фото' : 'Загрузить фото'}
                    </Button>
                  </>
                )}
              </div>

              {/* ── Шапка: название / штрихкод / категория / бренд ── */}
              <div className="space-y-3">
                <div>
                  <div className="text-lg font-semibold text-slate-900 dark:text-white">{data.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="font-mono">{data.barcode || '—'}</span>
                    {data.category && <span>· {data.category}</span>}
                    {data.brand && <span>· {data.brand}</span>}
                    <span>· {data.unit}</span>
                    {data.pack_size > 1 && <span>· уп. по {data.pack_size}</span>}
                  </div>
                </div>

                {/* ── Цены / маржа ── */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
                    <div className="text-[11px] text-muted-foreground">Продажа</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{fmtMoney(data.sale_price)}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
                    <div className="text-[11px] text-muted-foreground">Закуп</div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">{fmtMoney(data.purchase_price)}</div>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
                    <div className="text-[11px] text-muted-foreground">Маржа</div>
                    <div className={`text-sm font-bold ${marginColor(data.margin_pct)}`}>
                      {data.margin_pct}%
                    </div>
                    <div className="text-[10px] text-muted-foreground">{fmtMoney(data.margin_abs)}</div>
                  </div>
                </div>

                {/* ── Продажи / скорость ── */}
                <div className="grid grid-cols-2 gap-2">
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
                    <TrendingUp className="h-4 w-4 shrink-0 text-emerald-500" />
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{fmt(data.sold_30d)} {data.unit}</div>
                      <div className="text-[11px] text-muted-foreground">продано за 30 дней</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.02]">
                    <Boxes className="h-4 w-4 shrink-0 text-sky-500" />
                    <div>
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">~{data.velocity_per_week} {data.unit}/нед</div>
                      <div className="text-[11px] text-muted-foreground">скорость продаж</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* ── Остатки по точкам ── */}
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                <Warehouse className="h-3.5 w-3.5" /> Остатки по точкам · всего {fmt(data.total_stock)} {data.unit}
              </div>
              {data.stock_by_location.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-muted-foreground dark:border-white/10 dark:bg-white/[0.02]">
                  Нет остатков ни на одной точке.
                </div>
              ) : (
                <div className="space-y-1">
                  {data.stock_by_location.map((s) => {
                    const low = data.low_stock_threshold != null && s.quantity <= data.low_stock_threshold
                    return (
                      <div
                        key={s.location_id}
                        className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm dark:border-white/10 dark:bg-white/[0.02]"
                      >
                        <div className="min-w-0">
                          <span className="font-medium text-slate-900 dark:text-white">{s.location}</span>
                          {s.company && <span className="ml-1 text-xs text-muted-foreground">· {s.company}</span>}
                          {s.location_type === 'warehouse' && <span className="ml-1 text-[10px] text-blue-500">склад</span>}
                          {s.location_type === 'point_display' && <span className="ml-1 text-[10px] text-amber-500">витрина</span>}
                        </div>
                        <div className={`shrink-0 font-semibold ${low ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
                          {fmt(s.quantity)} {data.unit}
                          {low && <span className="ml-1 text-[10px]">низкий</span>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* ── Поставщик ── */}
            <div className="flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.02]">
              <Truck className="mt-0.5 h-4 w-4 shrink-0 text-indigo-500" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Последний поставщик</div>
                {data.last_supplier ? (
                  <div className="mt-0.5 text-sm text-slate-900 dark:text-white">
                    {data.last_supplier}
                    {data.last_purchase_price != null && (
                      <span className="ml-2 text-muted-foreground">· {fmtMoney(data.last_purchase_price)}</span>
                    )}
                    {data.last_received_at && (
                      <span className="ml-2 text-[11px] text-muted-foreground">
                        {new Date(data.last_received_at).toLocaleDateString('ru-RU')}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="mt-0.5 text-sm text-muted-foreground">Нет приёмок по этому товару.</div>
                )}
              </div>
            </div>

            {/* ── Описание ── */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Описание</div>
                {canEdit && !editDesc && (
                  <button
                    type="button"
                    onClick={() => { setDescDraft(data.description || ''); setEditDesc(true) }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="h-3 w-3" /> {data.description ? 'Изменить' : 'Добавить'}
                  </button>
                )}
              </div>
              {editDesc ? (
                <div className="space-y-2">
                  <textarea
                    value={descDraft}
                    onChange={(e) => setDescDraft(e.target.value)}
                    rows={3}
                    className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-400 dark:border-white/10 dark:bg-white/[0.02] dark:text-white"
                    placeholder="Заметки о товаре…"
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" size="sm" onClick={() => setEditDesc(false)} disabled={savingDesc}>
                      Отмена
                    </Button>
                    <Button type="button" size="sm" onClick={() => void saveDescription()} disabled={savingDesc}>
                      {savingDesc ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Сохранить'}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-700 dark:text-slate-300">
                  {data.description || <span className="text-muted-foreground">—</span>}
                </div>
              )}
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
