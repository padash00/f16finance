'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Plus, Trash2, Upload } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

type Item = {
  id: string
  name: string
  barcode: string
  unit?: string | null
  default_purchase_price?: number | null
}

type Location = {
  id: string
  name: string
  code?: string | null
  location_type: 'warehouse' | 'point_display'
  company?: { id?: string; name?: string | null } | null
}

type PostingLine = {
  key: string
  item_id: string
  quantity: string
  unit_cost: string
  comment: string
}

type RecentPosting = {
  id: string
  received_at: string
  comment: string | null
  total_amount: number
  status: 'posted' | 'cancelled'
  kind: 'supplier' | 'posting'
  location?: Location | null
  items?: Array<{ id: string; quantity: number; unit_cost: number; total_cost: number; item?: Item | null }>
}

function newLine(): PostingLine {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: '',
    quantity: '',
    unit_cost: '',
    comment: '',
  }
}

function parseNum(v: string) {
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export default function StorePostingsPage() {
  const [locations, setLocations] = useState<Location[]>([])
  const [items, setItems] = useState<Item[]>([])
  const [recent, setRecent] = useState<RecentPosting[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const [locationId, setLocationId] = useState('')
  const [receivedAt, setReceivedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [comment, setComment] = useState('')
  const [lines, setLines] = useState<PostingLine[]>([newLine()])
  const [search, setSearch] = useState<Record<string, string>>({})

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/store/receipts?scope=warehouse', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки')
      const data = json.data || {}
      setItems(data.items || [])
      setLocations((data.locations || []).filter((l: Location) => l.location_type === 'warehouse'))
      setRecent(((data.receipts as RecentPosting[]) || []).filter((r) => r.kind === 'posting').slice(0, 20))
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  useEffect(() => {
    if (!locationId && locations.length === 1) setLocationId(locations[0].id)
  }, [locations, locationId])

  const itemById = useMemo(() => {
    const m = new Map<string, Item>()
    for (const it of items) m.set(it.id, it)
    return m
  }, [items])

  const filteredItemsFor = (lineKey: string) => {
    const q = (search[lineKey] || '').trim().toLowerCase()
    if (!q) return items.slice(0, 30)
    return items
      .filter((i) => i.name.toLowerCase().includes(q) || i.barcode.includes(q))
      .slice(0, 30)
  }

  const submit = async () => {
    setError(null)
    setSuccess(null)
    if (!locationId) {
      setError('Выберите склад')
      return
    }
    const payloadItems = lines
      .map((l) => ({
        item_id: l.item_id,
        quantity: parseNum(l.quantity),
        unit_cost: parseNum(l.unit_cost),
        comment: l.comment.trim() || null,
      }))
      .filter((l) => l.item_id && l.quantity > 0)
    if (payloadItems.length === 0) {
      setError('Добавьте хотя бы одну строку с положительным количеством')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/store/receipts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createPosting',
          posting: {
            location_id: locationId,
            received_at: receivedAt,
            comment: comment.trim() || null,
            items: payloadItems,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.message || json.error || 'Не удалось оприходовать')
      setSuccess('Оприходование проведено.')
      setLines([newLine()])
      setComment('')
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto w-full max-w-screen-2xl space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-300">
          <Upload className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-white">Оприходование</h1>
          <p className="truncate text-xs text-muted-foreground">
            Добавление товара на склад без поставщика — для начальных остатков, корректировок прихода или излишков.
          </p>
        </div>
      </div>

      <Card className="border-white/10 bg-card/70 p-0">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Склад</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger><SelectValue placeholder="Выберите склад" /></SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Дата</Label>
              <Input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Комментарий</Label>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: начальный остаток" />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Товары</Label>
              <Button type="button" variant="outline" size="sm" onClick={() => setLines((prev) => [...prev, newLine()])}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Добавить строку
              </Button>
            </div>
            <div className="space-y-2">
              {lines.map((line) => {
                const it = itemById.get(line.item_id)
                return (
                  <div key={line.key} className="rounded-lg border border-white/10 bg-white/[0.02] p-3 space-y-2">
                    <div className="grid gap-2 sm:grid-cols-12">
                      <div className="sm:col-span-6">
                        <Input
                          placeholder="Поиск товара по названию или штрихкоду…"
                          value={it ? `${it.name} · ${it.barcode}` : (search[line.key] || '')}
                          onChange={(e) => {
                            setSearch((s) => ({ ...s, [line.key]: e.target.value }))
                            if (line.item_id) {
                              setLines((prev) => prev.map((l) => l.key === line.key ? { ...l, item_id: '' } : l))
                            }
                          }}
                        />
                        {!line.item_id && (search[line.key] || '').length > 0 && (
                          <div className="mt-1 max-h-44 overflow-auto rounded-md border border-white/10 bg-background">
                            {filteredItemsFor(line.key).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-white/5"
                                onClick={() => {
                                  setLines((prev) => prev.map((l) => l.key === line.key ? {
                                    ...l,
                                    item_id: opt.id,
                                    unit_cost: l.unit_cost || (opt.default_purchase_price ? String(opt.default_purchase_price) : ''),
                                  } : l))
                                  setSearch((s) => ({ ...s, [line.key]: '' }))
                                }}
                              >
                                {opt.name} <span className="text-muted-foreground">· {opt.barcode}</span>
                              </button>
                            ))}
                            {filteredItemsFor(line.key).length === 0 && (
                              <div className="px-2 py-1.5 text-xs text-muted-foreground">Ничего не найдено</div>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="sm:col-span-2">
                        <Input
                          type="number"
                          step="0.001"
                          min="0"
                          placeholder="Кол-во"
                          value={line.quantity}
                          onChange={(e) => setLines((prev) => prev.map((l) => l.key === line.key ? { ...l, quantity: e.target.value } : l))}
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          placeholder="Цена закупа (опц.)"
                          value={line.unit_cost}
                          onChange={(e) => setLines((prev) => prev.map((l) => l.key === line.key ? { ...l, unit_cost: e.target.value } : l))}
                        />
                      </div>
                      <div className="sm:col-span-2 flex items-center gap-2">
                        <Input
                          placeholder="Комментарий"
                          value={line.comment}
                          onChange={(e) => setLines((prev) => prev.map((l) => l.key === line.key ? { ...l, comment: e.target.value } : l))}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-rose-300 hover:bg-rose-500/10"
                          onClick={() => setLines((prev) => prev.length === 1 ? [newLine()] : prev.filter((l) => l.key !== line.key))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{error}</div>}
          {success && <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-300">{success}</div>}

          <div className="flex justify-end">
            <Button type="button" onClick={() => void submit()} disabled={saving || loading}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Package className="h-3.5 w-3.5 mr-1" />}
              Оприходовать
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-card/70 p-0">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Package className="h-4 w-4 text-emerald-300" /> Последние оприходования
          </div>
          {loading ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока нет оприходований.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pl-2 pr-2 font-normal">Дата</th>
                    <th className="py-2 px-2 font-normal">Склад</th>
                    <th className="py-2 px-2 font-normal">Комментарий</th>
                    <th className="py-2 px-2 text-right font-normal">Позиций</th>
                    <th className="py-2 px-2 text-right font-normal">Сумма</th>
                    <th className="py-2 px-2 font-normal">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.04]">
                  {recent.map((r) => (
                    <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-50 line-through' : ''}>
                      <td className="py-2 pl-2 pr-2 text-xs text-muted-foreground">{r.received_at}</td>
                      <td className="py-2 px-2 text-xs">{r.location?.name || '—'}</td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{r.comment || '—'}</td>
                      <td className="py-2 px-2 text-right text-xs">{(r.items || []).length}</td>
                      <td className="py-2 px-2 text-right text-xs">{Number(r.total_amount || 0).toLocaleString('ru-RU')}</td>
                      <td className="py-2 px-2 text-xs">
                        {r.status === 'cancelled' ? (
                          <Badge variant="outline" className="border-rose-500/40 bg-rose-500/15 text-rose-200">Отменён</Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-200">Проведён</Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
