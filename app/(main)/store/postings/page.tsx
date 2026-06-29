'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Plus, ShieldAlert, Store, Trash2, Upload, Warehouse } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

type Item = {
  id: string
  name: string
  barcode: string
  unit?: string | null
  default_purchase_price?: number | null
  requires_expiry?: boolean | null
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
  production_date: string
  expiry_date: string
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

type SessionRole = {
  isSuperAdmin?: boolean
  staffRole?: string | null
  roleLabel?: string
}

const CONFIRM_PHRASE = 'ОПРИХОДОВАТЬ'

function newLine(): PostingLine {
  return {
    key: Math.random().toString(36).slice(2),
    item_id: '',
    quantity: '',
    unit_cost: '',
    comment: '',
    production_date: '',
    expiry_date: '',
  }
}

function parseNum(v: string) {
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

export default function StorePostingsPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { can, isSuperAdmin, isLoading: capsLoading } = useCapabilities()
  const [role, setRole] = useState<SessionRole | null>(null)
  const [roleLoading, setRoleLoading] = useState(true)

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
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmPhrase, setConfirmPhrase] = useState('')
  useModalEscape(confirmOpen, () => { if (!saving) setConfirmOpen(false) })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch('/api/auth/session-role', { cache: 'no-store' })
        const json = await res.json().catch(() => null)
        if (!cancelled && res.ok) {
          setRole({
            isSuperAdmin: json?.isSuperAdmin,
            staffRole: json?.staffRole,
            roleLabel: json?.roleLabel,
          })
        }
      } finally {
        if (!cancelled) setRoleLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // Доступ управляется системой прав (страница access), а не жёсткой ролью.
  const allowed = isSuperAdmin || can('store-postings.create') || can('store-postings.view')

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      // scope=all чтобы получить и склады, и витрины
      const res = await fetch('/api/admin/store/receipts?scope=all', { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки')
      const data = json.data || {}
      setItems(data.items || [])
      setLocations(
        ((data.locations as Location[]) || []).filter(
          (l) => l.location_type === 'warehouse' || l.location_type === 'point_display',
        ),
      )
      setRecent(((data.receipts as RecentPosting[]) || []).filter((r) => r.kind === 'posting').slice(0, 20))
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (allowed) void load()
  }, [allowed])

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

  const selectedLocation = locations.find((l) => l.id === locationId) || null
  const targetLabel = selectedLocation?.location_type === 'point_display' ? 'витрину' : 'склад'

  const validate = (): string | null => {
    if (!locationId) return 'Выберите склад или витрину'
    const payloadLines = lines.filter((l) => l.item_id && parseNum(l.quantity) > 0)
    if (payloadLines.length === 0) return 'Добавьте хотя бы одну строку с положительным количеством'
    const missing = payloadLines
      .filter((l) => itemById.get(l.item_id)?.requires_expiry !== false && !l.expiry_date.trim())
      .map((l) => itemById.get(l.item_id)?.name || 'Товар')
    if (missing.length) return `Укажите «годен до» для: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}. Товары без срока (бургеры/хотдоги) — снимите галочку «требует срок годности» в каталоге.`
    return null
  }

  const openConfirm = () => {
    setError(null)
    setSuccess(null)
    const v = validate()
    if (v) {
      setError(v)
      return
    }
    setConfirmPhrase('')
    setConfirmOpen(true)
  }

  const submit = async () => {
    setError(null)
    const payloadItems = lines
      .map((l) => ({
        item_id: l.item_id,
        quantity: parseNum(l.quantity),
        unit_cost: parseNum(l.unit_cost),
        comment: l.comment.trim() || null,
        production_date: l.production_date.trim() || null,
        expiry_date: l.expiry_date.trim() || null,
      }))
      .filter((l) => l.item_id && l.quantity > 0)

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
      setSuccess(`Оприходование на ${targetLabel} проведено.`)
      setLines([newLine()])
      setComment('')
      setConfirmOpen(false)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  if (roleLoading || capsLoading) {
    return (
      <div className="app-page-wide space-y-6">
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      </div>
    )
  }

  if (!allowed) {
    return (
      <div className="app-page-wide space-y-6">
        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-6 flex items-start gap-3">
            <ShieldAlert className="h-6 w-6 text-rose-700 dark:text-rose-300 shrink-0" />
            <div>
              <h2 className="text-base font-semibold text-rose-700 dark:text-rose-200">Доступ ограничен</h2>
              <p className="mt-1 text-sm text-rose-700/80 dark:text-rose-200/80">
                У вашей роли нет доступа к оприходованию. Текущая роль: <strong>{role?.roleLabel || '—'}</strong>.
              </p>
              <p className="mt-2 text-xs text-rose-700/70 dark:text-rose-300/70">
                Доступ выдаётся на странице «Доступы»: включите путь «Оприходование» для нужной роли.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className={embedded ? 'space-y-6' : 'app-page-wide space-y-6'}>
      {embedded ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">
            {role?.roleLabel || 'Владелец'}
          </Badge>
        </div>
      ) : (
        <AdminPageHeader
          title="Оприходование"
          description="Ручное добавление товара на склад или витрину без поставщика. Только для владельца и суперадмина."
          icon={<Upload className="h-5 w-5" />}
          accent="emerald"
          backHref="/"
          actions={(
            <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">
              {role?.roleLabel || 'Владелец'}
            </Badge>
          )}
        />
      )}

      <Card className="border-amber-500/20 bg-amber-500/5">
        <CardContent className="p-4 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-amber-700 dark:text-amber-300 shrink-0 mt-0.5" />
          <div className="text-sm text-slate-700 dark:text-amber-100">
            <p className="font-medium">Ответственная операция</p>
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-200/80">
              Оприходование изменяет фактический остаток без документа от поставщика. Каждое действие записывается в журнал движений и аудит.
              Перед проведением потребуется подтверждение.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 dark:border-white/10 bg-card/70 p-0">
        <CardContent className="p-4 sm:p-5 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Куда оприходовать</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите склад или витрину" />
                </SelectTrigger>
                <SelectContent>
                  {locations.length === 0 && (
                    <div className="px-2 py-2 text-xs text-muted-foreground">Локаций нет</div>
                  )}
                  {locations
                    .filter((l) => l.location_type === 'warehouse')
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        <div className="flex items-center gap-2">
                          <Warehouse className="h-3.5 w-3.5 text-blue-700 dark:text-blue-300" />
                          <span>{l.name}</span>
                          <span className="text-[10px] text-muted-foreground">склад</span>
                        </div>
                      </SelectItem>
                    ))}
                  {locations
                    .filter((l) => l.location_type === 'point_display')
                    .map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        <div className="flex items-center gap-2">
                          <Store className="h-3.5 w-3.5 text-emerald-700 dark:text-emerald-300" />
                          <span>{l.name}</span>
                          <span className="text-[10px] text-muted-foreground">витрина</span>
                        </div>
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Дата</Label>
              <DatePicker value={receivedAt} onChange={setReceivedAt} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Комментарий (обязательно для отчётности)</Label>
              <Input
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Например: начальный остаток / излишек по ревизии / возврат от сотрудника"
              />
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
                  <div key={line.key} className="rounded-lg border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-3 space-y-2">
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
                          <div className="mt-1 max-h-44 overflow-auto rounded-md border border-slate-200 dark:border-white/10 bg-background">
                            {filteredItemsFor(line.key).map((opt) => (
                              <button
                                key={opt.id}
                                type="button"
                                className="block w-full truncate px-2 py-1.5 text-left text-xs hover:bg-slate-100 dark:hover:bg-white/5"
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
                          className="text-rose-700 dark:text-rose-300 hover:bg-rose-500/10"
                          onClick={() => setLines((prev) => prev.length === 1 ? [newLine()] : prev.filter((l) => l.key !== line.key))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    {/* Срок годности (обязателен, кроме товаров без срока) */}
                    {line.item_id ? (
                      <div className="grid gap-2 sm:grid-cols-12">
                        <div className="sm:col-span-3">
                          <Label className="mb-1 block text-[10px] text-muted-foreground">Изготовлен (от)</Label>
                          <DatePicker value={line.production_date} onChange={(v) => setLines((prev) => prev.map((l) => l.key === line.key ? { ...l, production_date: v } : l))} />
                        </div>
                        <div className="sm:col-span-3">
                          <Label className="mb-1 block text-[10px] text-muted-foreground">
                            Годен до {it?.requires_expiry === false ? '(необяз.)' : '*'}
                          </Label>
                          <DatePicker value={line.expiry_date} onChange={(v) => setLines((prev) => prev.map((l) => l.key === line.key ? { ...l, expiry_date: v } : l))} />
                        </div>
                        {it?.requires_expiry === false ? (
                          <div className="flex items-end sm:col-span-6"><span className="text-[11px] text-muted-foreground">Товар без срока годности (бургеры/хотдоги и пр.)</span></div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </div>

          {error && <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">{error}</div>}
          {success && <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{success}</div>}

          <div className="flex justify-end">
            <Button type="button" onClick={openConfirm} disabled={saving || loading}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Package className="h-3.5 w-3.5 mr-1" />}
              Оприходовать
            </Button>
          </div>
        </CardContent>
      </Card>

      {confirmOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
          onClick={(e) => { if (e.target === e.currentTarget && !saving) setConfirmOpen(false) }}>
          <Card className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto border-amber-500/30 bg-card">
            <CardContent className="p-5 space-y-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="h-5 w-5 text-amber-700 dark:text-amber-300" />
                <h3 className="font-semibold">Подтверждение оприходования</h3>
              </div>
              <p className="text-sm text-muted-foreground">
                Будет проведено оприходование на <strong className="text-foreground">{selectedLocation?.name || '—'}</strong> ({targetLabel}).
                Позиций: <strong className="text-foreground">{lines.filter((l) => l.item_id && parseNum(l.quantity) > 0).length}</strong>.
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-200/80">
                Действие будет записано в журнал движений и аудит. Откатить можно через «Отмену приёмки».
              </p>
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Введите фразу <code className="bg-slate-100 dark:bg-white/10 px-1 rounded text-xs">{CONFIRM_PHRASE}</code> для подтверждения:
                </Label>
                <Input
                  value={confirmPhrase}
                  onChange={(e) => setConfirmPhrase(e.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={saving}>Отмена</Button>
                <Button
                  onClick={() => void submit()}
                  disabled={saving || confirmPhrase.trim() !== CONFIRM_PHRASE}
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  Провести
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card className="border-slate-200 dark:border-white/10 bg-card/70 p-0">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <Package className="h-4 w-4 text-emerald-700 dark:text-emerald-300" /> Последние оприходования
          </div>
          {loading && recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Загрузка…</p>
          ) : recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">Пока нет оприходований.</p>
          ) : (
            <div className="overflow-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/[0.06] text-left text-[10px] uppercase tracking-wider text-muted-foreground">
                    <th className="py-2 pl-2 pr-2 font-normal">Дата</th>
                    <th className="py-2 px-2 font-normal">Куда</th>
                    <th className="py-2 px-2 font-normal">Тип</th>
                    <th className="py-2 px-2 font-normal">Комментарий</th>
                    <th className="py-2 px-2 text-right font-normal">Позиций</th>
                    <th className="py-2 px-2 text-right font-normal">Сумма</th>
                    <th className="py-2 px-2 font-normal">Статус</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {recent.map((r) => (
                    <tr key={r.id} className={r.status === 'cancelled' ? 'opacity-50 line-through' : ''}>
                      <td className="py-2 pl-2 pr-2 text-xs text-muted-foreground">{r.received_at}</td>
                      <td className="py-2 px-2 text-xs">{r.location?.name || '—'}</td>
                      <td className="py-2 px-2 text-xs">
                        {r.location?.location_type === 'point_display' ? (
                          <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300">
                            <Store className="h-3 w-3" /> витрина
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300">
                            <Warehouse className="h-3 w-3" /> склад
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-2 text-xs text-muted-foreground">{r.comment || '—'}</td>
                      <td className="py-2 px-2 text-right text-xs">{(r.items || []).length}</td>
                      <td className="py-2 px-2 text-right text-xs">{Number(r.total_amount || 0).toLocaleString('ru-RU')}</td>
                      <td className="py-2 px-2 text-xs">
                        {r.status === 'cancelled' ? (
                          <Badge variant="outline" className="border-rose-500/40 bg-rose-500/15 text-rose-700 dark:text-rose-200">Отменён</Badge>
                        ) : (
                          <Badge variant="outline" className="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200">Проведён</Badge>
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
