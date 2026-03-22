'use client'

import { useCallback, useEffect, useState } from 'react'
import { Users, Plus, Search, Star, TrendingUp, Edit2, Trash2, RefreshCw, ChevronDown, ChevronUp, Download } from 'lucide-react'
import * as XLSX from 'xlsx'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'

// ─── Types ────────────────────────────────────────────────────────────────────

type Customer = {
  id: string
  company_id: string | null
  name: string
  phone: string | null
  card_number: string | null
  email: string | null
  notes: string | null
  loyalty_points: number
  total_spent: number
  visits_count: number
  is_active: boolean
  created_at: string
  updated_at: string
  company: { id: string; name: string; code: string | null } | null
}

type CustomerFormData = {
  name: string
  phone: string
  card_number: string
  email: string
  notes: string
  company_id: string
}

const EMPTY_FORM: CustomerFormData = {
  name: '',
  phone: '',
  card_number: '',
  email: '',
  notes: '',
  company_id: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatMoney(value: number) {
  return new Intl.NumberFormat('ru-KZ', { style: 'currency', currency: 'KZT', maximumFractionDigits: 0 }).format(value)
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [companyFilter, setCompanyFilter] = useState('')

  // Dialogs
  const [showAdd, setShowAdd] = useState(false)
  const [editCustomer, setEditCustomer] = useState<Customer | null>(null)
  const [adjustCustomer, setAdjustCustomer] = useState<Customer | null>(null)
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null)

  // Forms
  const [form, setForm] = useState<CustomerFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  // Points adjust
  const [pointsDelta, setPointsDelta] = useState('')
  const [pointsReason, setPointsReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (companyFilter) params.set('company_id', companyFilter)
      if (search) params.set('search', search)
      const res = await fetch(`/api/admin/customers?${params.toString()}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки')
      setCustomers(json.data || [])
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить клиентов')
    } finally {
      setLoading(false)
    }
  }, [companyFilter, search])

  useEffect(() => {
    void load()
  }, [load])

  // Stats
  const totalLoyaltyPoints = customers.reduce((sum, c) => sum + (c.loyalty_points || 0), 0)
  const topCustomer = customers.length > 0 ? customers[0] : null

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setFormError('Имя клиента обязательно'); return }
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'createCustomer', payload: form }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      setShowAdd(false)
      setForm(EMPTY_FORM)
      await load()
    } catch (err: any) {
      setFormError(err?.message || 'Ошибка создания')
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(e: React.FormEvent) {
    e.preventDefault()
    if (!editCustomer) return
    if (!form.name.trim()) { setFormError('Имя клиента обязательно'); return }
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateCustomer', customerId: editCustomer.id, payload: form }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      setEditCustomer(null)
      setForm(EMPTY_FORM)
      await load()
    } catch (err: any) {
      setFormError(err?.message || 'Ошибка обновления')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Деактивировать клиента?')) return
    try {
      const res = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteCustomer', customerId: id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      await load()
    } catch (err: any) {
      alert(err?.message || 'Ошибка удаления')
    }
  }

  async function handleAdjustPoints(e: React.FormEvent) {
    e.preventDefault()
    if (!adjustCustomer) return
    const delta = parseInt(pointsDelta, 10)
    if (isNaN(delta) || delta === 0) { setFormError('Укажите количество баллов (например: +50 или -20)'); return }
    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/admin/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'adjustPoints', customerId: adjustCustomer.id, delta, reason: pointsReason }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      setAdjustCustomer(null)
      setPointsDelta('')
      setPointsReason('')
      await load()
    } catch (err: any) {
      setFormError(err?.message || 'Ошибка корректировки баллов')
    } finally {
      setSaving(false)
    }
  }

  function openEdit(customer: Customer) {
    setEditCustomer(customer)
    setForm({
      name: customer.name,
      phone: customer.phone || '',
      card_number: customer.card_number || '',
      email: customer.email || '',
      notes: customer.notes || '',
      company_id: customer.company_id || '',
    })
    setFormError(null)
  }

  function exportExcel() {
    const rows = customers.map((c) => ({
      Имя: c.name,
      Телефон: c.phone || '',
      Карта: c.card_number || '',
      Email: c.email || '',
      'Баллы лояльности': c.loyalty_points,
      'Потрачено (₸)': c.total_spent,
      Визиты: c.visits_count,
      Компания: c.company?.name || '',
      'Дата добавления': formatDate(c.created_at),
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Клиенты')
    XLSX.writeFile(wb, `customers_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  return (
    <div className="app-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Users className="h-6 w-6 text-emerald-400" />
            Клиенты
          </h1>
          <p className="text-sm text-muted-foreground mt-1">База клиентов и программа лояльности</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportExcel} disabled={customers.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Экспорт Excel
          </Button>
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowAdd(true) }}>
            <Plus className="mr-2 h-4 w-4" />
            Добавить клиента
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Всего клиентов</p>
            <p className="mt-1 text-2xl font-bold">{customers.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Баллов лояльности</p>
            <p className="mt-1 text-2xl font-bold">{totalLoyaltyPoints.toLocaleString('ru-RU')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Топ клиент</p>
            {topCustomer ? (
              <>
                <p className="mt-1 text-base font-bold truncate">{topCustomer.name}</p>
                <p className="text-xs text-muted-foreground">{formatMoney(topCustomer.total_spent)}</p>
              </>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">—</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card className="mb-4">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по имени, телефону, карте..."
                className="pl-10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Error */}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
              Загрузка...
            </div>
          ) : customers.length === 0 ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
              Клиентов не найдено
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Клиент</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Телефон</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Карта</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Баллы</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Потрачено</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Визиты</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Компания</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((customer) => (
                    <tr
                      key={customer.id}
                      className="border-b border-white/5 hover:bg-white/[0.02] cursor-pointer"
                      onClick={() => setDetailCustomer(customer)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-medium">{customer.name}</p>
                        {customer.email && <p className="text-xs text-muted-foreground">{customer.email}</p>}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">{customer.phone || '—'}</td>
                      <td className="px-4 py-3">
                        {customer.card_number ? (
                          <Badge variant="outline" className="font-mono text-xs">{customer.card_number}</Badge>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {customer.loyalty_points > 0 ? (
                          <span className="text-amber-400 font-semibold">{customer.loyalty_points.toLocaleString('ru-RU')}</span>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{formatMoney(customer.total_spent)}</td>
                      <td className="px-4 py-3 text-right text-muted-foreground">{customer.visits_count}</td>
                      <td className="px-4 py-3 text-muted-foreground">{customer.company?.name || '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Баллы"
                            onClick={() => { setAdjustCustomer(customer); setPointsDelta(''); setPointsReason(''); setFormError(null) }}
                          >
                            <Star className="h-4 w-4 text-amber-400" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Редактировать"
                            onClick={() => openEdit(customer)}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-rose-400 hover:text-rose-300"
                            title="Деактивировать"
                            onClick={() => void handleDelete(customer.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Customer Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Добавить клиента</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Имя *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Иван Иванов" />
            </div>
            <div className="space-y-1.5">
              <Label>Телефон</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+7 777 123 45 67" />
            </div>
            <div className="space-y-1.5">
              <Label>Номер карты</Label>
              <Input value={form.card_number} onChange={(e) => setForm({ ...form, card_number: e.target.value })} placeholder="Штрихкод карты" />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@example.com" type="email" />
            </div>
            <div className="space-y-1.5">
              <Label>Заметки</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Доп. информация" />
            </div>
            {formError && <p className="text-sm text-rose-400">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Отмена</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Сохранение...' : 'Создать'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Customer Dialog */}
      <Dialog open={!!editCustomer} onOpenChange={(open) => { if (!open) { setEditCustomer(null); setForm(EMPTY_FORM) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать клиента</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Имя *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Телефон</Label>
              <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Номер карты</Label>
              <Input value={form.card_number} onChange={(e) => setForm({ ...form, card_number: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" />
            </div>
            <div className="space-y-1.5">
              <Label>Заметки</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            {formError && <p className="text-sm text-rose-400">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setEditCustomer(null); setForm(EMPTY_FORM) }}>Отмена</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Adjust Points Dialog */}
      <Dialog open={!!adjustCustomer} onOpenChange={(open) => { if (!open) setAdjustCustomer(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Корректировка баллов</DialogTitle>
          </DialogHeader>
          {adjustCustomer && (
            <form onSubmit={handleAdjustPoints} className="space-y-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3 text-sm">
                <p className="font-medium">{adjustCustomer.name}</p>
                <p className="text-muted-foreground">Текущий баланс: <span className="text-amber-400 font-semibold">{adjustCustomer.loyalty_points} баллов</span></p>
              </div>
              <div className="space-y-1.5">
                <Label>Количество баллов (+ добавить, − снять)</Label>
                <Input
                  value={pointsDelta}
                  onChange={(e) => setPointsDelta(e.target.value)}
                  placeholder="Например: 50 или -20"
                  type="number"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Причина (необязательно)</Label>
                <Input
                  value={pointsReason}
                  onChange={(e) => setPointsReason(e.target.value)}
                  placeholder="Ручная корректировка, компенсация и т.д."
                />
              </div>
              {formError && <p className="text-sm text-rose-400">{formError}</p>}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setAdjustCustomer(null)}>Отмена</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Сохранение...' : 'Применить'}</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailCustomer} onOpenChange={(open) => { if (!open) setDetailCustomer(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Клиент: {detailCustomer?.name}</DialogTitle>
          </DialogHeader>
          {detailCustomer && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Телефон</p>
                  <p className="mt-1 font-medium">{detailCustomer.phone || '—'}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Карта</p>
                  <p className="mt-1 font-mono">{detailCustomer.card_number || '—'}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Баллы</p>
                  <p className="mt-1 font-bold text-amber-400">{detailCustomer.loyalty_points.toLocaleString('ru-RU')}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Потрачено</p>
                  <p className="mt-1 font-bold">{formatMoney(detailCustomer.total_spent)}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Визиты</p>
                  <p className="mt-1 font-medium">{detailCustomer.visits_count}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Добавлен</p>
                  <p className="mt-1 font-medium">{formatDate(detailCustomer.created_at)}</p>
                </div>
              </div>
              {detailCustomer.email && (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Email</p>
                  <p className="mt-1">{detailCustomer.email}</p>
                </div>
              )}
              {detailCustomer.notes && (
                <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-foreground">Заметки</p>
                  <p className="mt-1">{detailCustomer.notes}</p>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
