'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { InventoryLegacyRedirect } from '../legacy-redirect'

type ConsumableItem = { id: string; name: string; barcode: string; unit: string; category?: { id: string; name: string } | null }
type ConsumptionNorm = { id: string; item_id: string; location_id: string; monthly_qty: number; alert_days: number }
type PointLimit = { id: string; item_id: string; company_id: string; monthly_limit_qty: number }
type Balance = { location_id: string; item_id: string; quantity: number; item?: { id: string; name: string } | null; location?: { id: string; name: string; location_type: string; company_id: string | null } | null }
type InventoryLocation = { id: string; name: string; location_type: string; company_id: string | null; company?: { id: string; name: string; code: string | null } | null }
type ConsumableIssueItem = {
  id: string
  requested_qty: number
  approved_qty: number
  item?: { id: string; name: string; barcode: string; unit: string } | null
}
type ConsumableIssue = {
  id: string
  created_at: string | null
  approved_at: string | null
  issued_at: string | null
  received_at: string | null
  issued_by: string | null
  approved_by: string | null
  created_by: string | null
  status: string
  comment: string | null
  company?: { id: string; name: string } | null
  target_location?: { id: string; name: string } | null
  items: ConsumableIssueItem[]
}

type DashboardData = {
  items: ConsumableItem[]
  norms: ConsumptionNorm[]
  limits: PointLimit[]
  balances: Balance[]
  locations: InventoryLocation[]
  companies: Array<{ id: string; name: string; code: string | null }>
  issues?: ConsumableIssue[]
}

type Tab = 'balances' | 'issues' | 'norms'

function stockStatus(quantity: number, norm: ConsumptionNorm | undefined): { icon: string; label: string } {
  if (!norm) return { icon: '⚪', label: 'Нет нормы' }
  const daysLeft = Math.floor(quantity / (norm.monthly_qty / 30))
  if (daysLeft > norm.alert_days * 2) return { icon: '🟢', label: `${daysLeft} дн.` }
  if (daysLeft > norm.alert_days) return { icon: '🟡', label: `${daysLeft} дн.` }
  return { icon: '🔴', label: `${daysLeft} дн.` }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  )
}

export function ConsumablesPageContent() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<Tab>('balances')
  const [balancesQuery, setBalancesQuery] = useState('')

  // Quick add consumable
  const [newItemName, setNewItemName] = useState('')
  const [newItemBarcode, setNewItemBarcode] = useState('')
  const [newItemUnit, setNewItemUnit] = useState('шт')
  const [newItemAlertThreshold, setNewItemAlertThreshold] = useState('')
  const [creatingItem, setCreatingItem] = useState(false)

  // Norm form state
  const [normItemId, setNormItemId] = useState('')
  const [normLocationId, setNormLocationId] = useState('')
  const [normMonthlyQty, setNormMonthlyQty] = useState('')
  const [normAlertDays, setNormAlertDays] = useState('14')
  const [editingNormId, setEditingNormId] = useState<string | null>(null)
  const [issueDate, setIssueDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [issueLocationId, setIssueLocationId] = useState('')
  const [issueItemId, setIssueItemId] = useState('')
  const [issuePackQty, setIssuePackQty] = useState('1')
  const [issuePackSize, setIssuePackSize] = useState('1')
  const [issueComment, setIssueComment] = useState('')

  async function loadData() {
    setLoading(true)
    setError(null)
    const res = await fetch('/api/admin/inventory/consumables', { cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (!res.ok || !json?.ok) {
      setError(json?.error || 'Не удалось загрузить данные')
      setLoading(false)
      return
    }
    setData(json.data)
    setLoading(false)
  }

  useEffect(() => { void loadData() }, [])

  const pointLocations = useMemo(
    () => (data?.locations || []).filter((l) => l.location_type === 'point_display'),
    [data?.locations],
  )

  async function handleSaveNorm() {
    if (!normItemId || !normLocationId || !normMonthlyQty) return setError('Заполните все поля нормы')
    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/admin/inventory/consumables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'upsertNorm',
          payload: {
            item_id: normItemId,
            location_id: normLocationId,
            monthly_qty: Number(normMonthlyQty),
            alert_days: Number(normAlertDays || 14),
          },
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Ошибка сохранения нормы')
      setSuccess('Норма сохранена')
      setNormItemId('')
      setNormLocationId('')
      setNormMonthlyQty('')
      setNormAlertDays('14')
      setEditingNormId(null)
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Ошибка сохранения нормы')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateIssue() {
    const packs = Number(issuePackQty || 0)
    const packSize = Number(issuePackSize || 0)
    const requestedQty = packs * packSize
    if (!issueDate) return setError('Укажите дату выдачи')
    if (!issueLocationId) return setError('Выберите точку')
    if (!issueItemId) return setError('Выберите расходник')
    if (!Number.isFinite(packs) || packs <= 0) return setError('Укажите корректное кол-во упаковок')
    if (!Number.isFinite(packSize) || packSize <= 0) return setError('Укажите корректную емкость упаковки')
    if (!Number.isFinite(requestedQty) || requestedQty <= 0) return setError('Некорректное итоговое количество')

    setSaving(true)
    setError(null)
    setSuccess(null)
    try {
      const lineComment = `упаковки=${packs};в_упаковке=${packSize}`
      const response = await fetch('/api/admin/inventory/consumables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'recordIssue',
          payload: {
            point_location_id: issueLocationId,
            issue_date: issueDate,
            comment: issueComment.trim() || null,
            items: [{ item_id: issueItemId, requested_qty: requestedQty, comment: lineComment }],
          },
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось записать выдачу')
      setIssueItemId('')
      setIssuePackQty('1')
      setIssuePackSize('1')
      setIssueComment('')
      setSuccess('Выдача зафиксирована и автоматически списана со склада')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось записать выдачу')
    } finally {
      setSaving(false)
    }
  }

  async function handleCreateConsumable() {
    const name = newItemName.trim()
    const barcode = newItemBarcode.trim()
    if (!name) return setError('Введите название расходника')
    if (!barcode) return setError('Введите штрихкод расходника')

    setCreatingItem(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await fetch('/api/admin/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createItem',
          payload: {
            name,
            barcode,
            unit: newItemUnit.trim() || 'шт',
            sale_price: 0,
            default_purchase_price: 0,
            item_type: 'consumable',
            low_stock_threshold: newItemAlertThreshold.trim() ? Number(newItemAlertThreshold) : null,
          },
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Не удалось добавить расходник')

      setNewItemName('')
      setNewItemBarcode('')
      setNewItemUnit('шт')
      setNewItemAlertThreshold('')
      setSuccess('Расходник добавлен. Теперь задайте норму по точке.')
      await loadData()
    } catch (e: any) {
      setError(e?.message || 'Не удалось добавить расходник')
    } finally {
      setCreatingItem(false)
    }
  }

  function startEditNorm(norm: ConsumptionNorm) {
    setEditingNormId(norm.id)
    setNormItemId(norm.item_id)
    setNormLocationId(norm.location_id)
    setNormMonthlyQty(String(norm.monthly_qty))
    setNormAlertDays(String(norm.alert_days))
  }

  function cancelEditNorm() {
    setEditingNormId(null)
    setNormItemId('')
    setNormLocationId('')
    setNormMonthlyQty('')
    setNormAlertDays('14')
  }

  const normsByKey = useMemo(() => {
    const map = new Map<string, ConsumptionNorm>()
    for (const n of data?.norms || []) map.set(`${n.item_id}:${n.location_id}`, n)
    return map
  }, [data?.norms])

  const limitsByKey = useMemo(() => {
    const map = new Map<string, PointLimit>()
    for (const l of data?.limits || []) map.set(`${l.item_id}:${l.company_id}`, l)
    return map
  }, [data?.limits])

  const balancesByKey = useMemo(() => {
    const map = new Map<string, Balance>()
    for (const b of data?.balances || []) map.set(`${b.item_id}:${b.location_id}`, b)
    return map
  }, [data?.balances])

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Расходники</h1>
          <p className="text-sm text-muted-foreground">Нормы потребления и контроль остатков по точкам</p>
        </div>
        <Button variant="outline" size="sm" onClick={loadData} disabled={loading}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {error && <div className="rounded-md border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-300">{error}</div>}
      {success && <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-300">{success}</div>}

      <Card className="border-border/70 bg-background/60 p-4">
        <div className="mb-3 text-sm font-medium">Добавить расходник для контроля</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <Field label="Название">
            <Input value={newItemName} onChange={(e) => setNewItemName(e.target.value)} placeholder="Туалетная бумага, пакеты, салфетки..." />
          </Field>
          <Field label="Штрихкод">
            <Input value={newItemBarcode} onChange={(e) => setNewItemBarcode(e.target.value)} placeholder="Сканируйте или введите штрихкод" />
          </Field>
          <Field label="Ед. изм.">
            <Input value={newItemUnit} onChange={(e) => setNewItemUnit(e.target.value)} placeholder="шт / рул / упак" />
          </Field>
          <Field label="Мин. остаток (опц.)">
            <Input
              value={newItemAlertThreshold}
              onChange={(e) => setNewItemAlertThreshold(e.target.value)}
              placeholder="Напр. 5"
              type="number"
              min="0"
              step="1"
            />
          </Field>
          <div className="flex items-end">
            <Button onClick={handleCreateConsumable} disabled={creatingItem} className="w-full">
              {creatingItem ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Добавить расходник
            </Button>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          После добавления задайте норму потребления по точке во вкладке «Нормы».
        </p>
      </Card>

      <div className="flex gap-2 border-b border-border/50">
        {(['balances', 'issues', 'norms'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors ${tab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
          >
            {t === 'balances' ? 'Остатки' : t === 'issues' ? 'Выдача по точкам' : 'Нормы'}
          </button>
        ))}
      </div>

      {tab === 'balances' && (
        <div className="space-y-6">
          <Card className="border-border/70 bg-background/60 p-4">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Поиск расходника">
                <Input
                  value={balancesQuery}
                  onChange={(e) => setBalancesQuery(e.target.value)}
                  placeholder="Название или штрихкод"
                />
              </Field>
              <div className="text-xs text-muted-foreground">🟢 запас есть · 🟡 скоро закончится · 🔴 критично</div>
            </div>
          </Card>
          {pointLocations.length === 0 && (
            <Card className="border-border/70 bg-background/60 p-6 text-center text-sm text-muted-foreground">
              Нет активных точек продаж
            </Card>
          )}
          {pointLocations.map((location) => {
            const items = (data?.items || []).filter((item) => {
              const q = balancesQuery.trim().toLowerCase()
              if (!q) return true
              return item.name.toLowerCase().includes(q) || String(item.barcode || '').toLowerCase().includes(q)
            })
            return (
              <Card key={location.id} className="border-border/70 bg-background/60">
                <div className="border-b border-border/50 px-4 py-3">
                  <div className="text-sm font-medium">{location.name}</div>
                  {location.company && <div className="text-xs text-muted-foreground">{location.company.name}</div>}
                </div>
                {items.length === 0 ? (
                  <div className="px-4 py-4 text-sm text-muted-foreground">Нет расходников. Добавьте товары с типом "Расходник" в каталоге.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border/50 text-xs text-muted-foreground">
                          <th className="px-4 py-2 text-left font-medium">Товар</th>
                          <th className="px-4 py-2 text-left font-medium">Штрихкод</th>
                          <th className="px-4 py-2 text-right font-medium">Остаток</th>
                          <th className="px-4 py-2 text-right font-medium">Норма/мес</th>
                          <th className="px-4 py-2 text-right font-medium">Хватит на</th>
                          <th className="px-4 py-2 text-center font-medium">Статус</th>
                          <th className="px-4 py-2 text-right font-medium">Лимит/мес</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item) => {
                          const balance = balancesByKey.get(`${item.id}:${location.id}`)
                          const norm = normsByKey.get(`${item.id}:${location.id}`)
                          const qty = Number(balance?.quantity || 0)
                          const status = stockStatus(qty, norm)
                          const limitKey = location.company_id ? limitsByKey.get(`${item.id}:${location.company_id}`) : undefined
                          return (
                            <tr key={item.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                              <td className="px-4 py-2">
                                <span className="font-medium">{item.name}</span>
                                {item.category && <span className="ml-2 text-xs text-muted-foreground">{item.category.name}</span>}
                              </td>
                              <td className="px-4 py-2 font-mono text-xs text-muted-foreground">{item.barcode || '—'}</td>
                              <td className="px-4 py-2 text-right tabular-nums">
                                {qty} {item.unit}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                                {norm ? `${norm.monthly_qty} ${item.unit}` : '—'}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">
                                {norm ? `${Math.floor(qty / (norm.monthly_qty / 30))} дн.` : '—'}
                              </td>
                              <td className="px-4 py-2 text-center">
                                <span title={status.label}>{status.icon}</span>
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">
                                {limitKey ? `${limitKey.monthly_limit_qty} ${item.unit}` : '—'}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="px-4 py-3">
                  <Link href="/store/requests">
                    <Button variant="outline" size="sm">Создать заявку</Button>
                  </Link>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {tab === 'issues' && (
        <div className="space-y-6">
          <Card className="border-border/70 bg-background/60 p-4">
            <div className="mb-3 text-sm font-medium">Новая выдача расходников</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
              <Field label="Дата">
                <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </Field>
              <Field label="Точка">
                <Select value={issueLocationId} onValueChange={setIssueLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите точку" /></SelectTrigger>
                  <SelectContent>
                    {pointLocations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Расходник">
                <Select value={issueItemId} onValueChange={setIssueItemId}>
                  <SelectTrigger><SelectValue placeholder="Выберите расходник" /></SelectTrigger>
                  <SelectContent>
                    {(data?.items || []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Кол-во упаковок">
                <Input type="number" min="0" step="0.001" value={issuePackQty} onChange={(e) => setIssuePackQty(e.target.value)} />
              </Field>
              <Field label="В упаковке (шт)">
                <Input type="number" min="0" step="0.001" value={issuePackSize} onChange={(e) => setIssuePackSize(e.target.value)} />
              </Field>
              <Field label="Итого (шт)">
                <Input
                  value={`${Number(issuePackQty || 0) * Number(issuePackSize || 0) || 0}`}
                  readOnly
                />
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-[1fr_auto] md:items-end">
              <Field label="Комментарий (опц.)">
                <Input value={issueComment} onChange={(e) => setIssueComment(e.target.value)} placeholder="Например: выдали на выходные / срочная выдача" />
              </Field>
              <Button onClick={handleCreateIssue} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Записать выдачу
              </Button>
            </div>
          </Card>

          <Card className="border-border/70 bg-background/60">
            <div className="border-b border-border/50 px-4 py-3 text-sm font-medium">Журнал выдач</div>
            {(data?.issues || []).length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">Выдач пока нет</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Дата</th>
                      <th className="px-4 py-2 text-left font-medium">Точка</th>
                      <th className="px-4 py-2 text-left font-medium">Расходник</th>
                      <th className="px-4 py-2 text-right font-medium">Выдано</th>
                      <th className="px-4 py-2 text-left font-medium">Кто выдал</th>
                      <th className="px-4 py-2 text-left font-medium">Комментарий</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.issues || []).flatMap((issue) => {
                      const markerComment = String(issue.comment || '').replace('[consumable-issue]', '').trim()
                      const markerDate = markerComment.split('·')[0]?.trim() || ''
                      const dateText = markerDate || (issue.received_at || issue.issued_at || issue.approved_at || issue.created_at || '').slice(0, 10)
                      const who = issue.issued_by || issue.approved_by || issue.created_by || '—'
                      return issue.items.map((line) => (
                        <tr key={`${issue.id}:${line.id}`} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2 tabular-nums">{dateText || '—'}</td>
                          <td className="px-4 py-2 truncate" title={issue.target_location?.name || ''}>{issue.target_location?.name || '—'}</td>
                          <td className="px-4 py-2 truncate" title={line.item?.name || ''}>
                            <span className="font-medium">{line.item?.name || '—'}</span>
                            <span className="ml-2 font-mono text-xs text-muted-foreground">{line.item?.barcode || '—'}</span>
                          </td>
                          <td className="px-4 py-2 text-right tabular-nums">{Number(line.approved_qty || line.requested_qty || 0)} {line.item?.unit || 'шт'}</td>
                          <td className="px-4 py-2 text-muted-foreground">{who}</td>
                          <td className="px-4 py-2 truncate text-muted-foreground" title={markerComment || ''}>{markerComment || '—'}</td>
                        </tr>
                      ))
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'norms' && (
        <div className="space-y-6">
          <Card className="border-border/70 bg-background/60 p-4">
            <div className="mb-3 text-sm font-medium">{editingNormId ? 'Редактировать норму' : 'Новая норма'}</div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Расходник">
                <Select value={normItemId} onValueChange={setNormItemId}>
                  <SelectTrigger><SelectValue placeholder="Выберите товар" /></SelectTrigger>
                  <SelectContent>
                    {(data?.items || []).map((item) => (
                      <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Точка">
                <Select value={normLocationId} onValueChange={setNormLocationId}>
                  <SelectTrigger><SelectValue placeholder="Выберите точку" /></SelectTrigger>
                  <SelectContent>
                    {pointLocations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Норма в месяц">
                <Input value={normMonthlyQty} onChange={(e) => setNormMonthlyQty(e.target.value)} placeholder="0" type="number" min="0" step="0.001" />
              </Field>
              <Field label="Предупреждать за (дней)">
                <Input value={normAlertDays} onChange={(e) => setNormAlertDays(e.target.value)} placeholder="14" type="number" min="1" />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="sm" onClick={handleSaveNorm} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Сохранить норму
              </Button>
              {editingNormId && (
                <Button size="sm" variant="outline" onClick={cancelEditNorm} disabled={saving}>Отмена</Button>
              )}
            </div>
          </Card>

          <Card className="border-border/70 bg-background/60">
            <div className="border-b border-border/50 px-4 py-3 text-sm font-medium">Существующие нормы</div>
            {(data?.norms || []).length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">Нормы не заданы</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border/50 text-xs text-muted-foreground">
                      <th className="px-4 py-2 text-left font-medium">Товар</th>
                      <th className="px-4 py-2 text-left font-medium">Точка</th>
                      <th className="px-4 py-2 text-right font-medium">Норма/мес</th>
                      <th className="px-4 py-2 text-right font-medium">Алерт (дней)</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {(data?.norms || []).map((norm) => {
                      const item = (data?.items || []).find((i) => i.id === norm.item_id)
                      const location = (data?.locations || []).find((l) => l.id === norm.location_id)
                      return (
                        <tr key={norm.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20">
                          <td className="px-4 py-2">{item?.name || norm.item_id}</td>
                          <td className="px-4 py-2 text-muted-foreground">{location?.name || norm.location_id}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{norm.monthly_qty} {item?.unit || ''}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{norm.alert_days}</td>
                          <td className="px-4 py-2 text-right">
                            <button
                              type="button"
                              onClick={() => startEditNorm(norm)}
                              className="text-xs text-muted-foreground hover:text-foreground"
                            >
                              Изменить
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  )
}

export default function ConsumablesPage() {
  return <InventoryLegacyRedirect href="/store/consumables" />
}
