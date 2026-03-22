'use client'

import { useCallback, useEffect, useState } from 'react'
import { Tag, Plus, RefreshCw, Edit2, Trash2, Copy, Check, X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// ─── Types ────────────────────────────────────────────────────────────────────

type DiscountType = 'percent' | 'fixed' | 'promo_code'

type Discount = {
  id: string
  company_id: string | null
  name: string
  type: DiscountType
  value: number
  promo_code: string | null
  min_order_amount: number
  is_active: boolean
  valid_from: string | null
  valid_to: string | null
  usage_limit: number | null
  usage_count: number
  created_at: string
}

type DiscountFormData = {
  name: string
  type: DiscountType
  value: string
  promo_code: string
  min_order_amount: string
  valid_from: string
  valid_to: string
  usage_limit: string
  company_id: string
}

const EMPTY_FORM: DiscountFormData = {
  name: '',
  type: 'percent',
  value: '',
  promo_code: '',
  min_order_amount: '0',
  valid_from: '',
  valid_to: '',
  usage_limit: '',
  company_id: '',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function typeLabel(type: DiscountType): string {
  if (type === 'percent') return 'Скидка %'
  if (type === 'fixed') return 'Фиксированная скидка'
  return 'Промокод'
}

function typeBadgeVariant(type: DiscountType): 'default' | 'secondary' | 'outline' {
  if (type === 'percent') return 'default'
  if (type === 'fixed') return 'secondary'
  return 'outline'
}

function valueDisplay(discount: Discount): string {
  if (discount.type === 'percent') return `${discount.value}%`
  if (discount.type === 'fixed') return `${discount.value} ₸`
  return `${discount.value}%`
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

function generatePromoCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return code
}

// ─── Main Component ────────────────────────────────────────────────────────────

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Discount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showAdd, setShowAdd] = useState(false)
  const [editDiscount, setEditDiscount] = useState<Discount | null>(null)
  const [form, setForm] = useState<DiscountFormData>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/discounts')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка загрузки')
      setDiscounts(json.data || [])
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить скидки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { setFormError('Название обязательно'); return }
    const value = parseFloat(form.value)
    if (isNaN(value) || value < 0) { setFormError('Укажите корректное значение скидки'); return }
    if (form.type === 'promo_code' && !form.promo_code.trim()) { setFormError('Введите промокод'); return }

    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/admin/discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createDiscount',
          payload: {
            name: form.name.trim(),
            type: form.type,
            value,
            promo_code: form.type === 'promo_code' ? form.promo_code.trim() : null,
            min_order_amount: parseFloat(form.min_order_amount) || 0,
            valid_from: form.valid_from || null,
            valid_to: form.valid_to || null,
            usage_limit: form.usage_limit ? parseInt(form.usage_limit, 10) : null,
            company_id: form.company_id || null,
          },
        }),
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
    if (!editDiscount) return
    if (!form.name.trim()) { setFormError('Название обязательно'); return }
    const value = parseFloat(form.value)
    if (isNaN(value) || value < 0) { setFormError('Укажите корректное значение скидки'); return }

    setSaving(true)
    setFormError(null)
    try {
      const res = await fetch('/api/admin/discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'updateDiscount',
          discountId: editDiscount.id,
          payload: {
            name: form.name.trim(),
            type: form.type,
            value,
            promo_code: form.type === 'promo_code' ? form.promo_code.trim() : null,
            min_order_amount: parseFloat(form.min_order_amount) || 0,
            valid_from: form.valid_from || null,
            valid_to: form.valid_to || null,
            usage_limit: form.usage_limit ? parseInt(form.usage_limit, 10) : null,
          },
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      setEditDiscount(null)
      setForm(EMPTY_FORM)
      await load()
    } catch (err: any) {
      setFormError(err?.message || 'Ошибка обновления')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Деактивировать скидку?')) return
    try {
      const res = await fetch('/api/admin/discounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'deleteDiscount', discountId: id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Ошибка')
      await load()
    } catch (err: any) {
      alert(err?.message || 'Ошибка удаления')
    }
  }

  function openEdit(discount: Discount) {
    setEditDiscount(discount)
    setForm({
      name: discount.name,
      type: discount.type,
      value: String(discount.value),
      promo_code: discount.promo_code || '',
      min_order_amount: String(discount.min_order_amount),
      valid_from: discount.valid_from || '',
      valid_to: discount.valid_to || '',
      usage_limit: discount.usage_limit !== null ? String(discount.usage_limit) : '',
      company_id: discount.company_id || '',
    })
    setFormError(null)
  }

  function copyPromoCode(code: string, id: string) {
    navigator.clipboard.writeText(code)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const DiscountFormFields = () => (
    <>
      <div className="space-y-1.5">
        <Label>Название *</Label>
        <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Скидка для новых клиентов" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Тип *</Label>
          <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as DiscountType })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="percent">Скидка %</SelectItem>
              <SelectItem value="fixed">Фиксированная скидка</SelectItem>
              <SelectItem value="promo_code">Промокод</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{form.type === 'fixed' ? 'Сумма (₸) *' : 'Процент (%) *'}</Label>
          <Input
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            placeholder={form.type === 'fixed' ? '500' : '10'}
            type="number"
            min="0"
            max={form.type === 'percent' ? '99' : undefined}
          />
        </div>
      </div>
      {form.type === 'promo_code' && (
        <div className="space-y-1.5">
          <Label>Промокод *</Label>
          <div className="flex gap-2">
            <Input
              value={form.promo_code}
              onChange={(e) => setForm({ ...form, promo_code: e.target.value.toUpperCase() })}
              placeholder="PROMO2026"
              className="font-mono"
            />
            <Button type="button" variant="outline" size="sm" onClick={() => setForm({ ...form, promo_code: generatePromoCode() })}>
              Генерировать
            </Button>
          </div>
        </div>
      )}
      <div className="space-y-1.5">
        <Label>Мин. сумма заказа (₸)</Label>
        <Input
          value={form.min_order_amount}
          onChange={(e) => setForm({ ...form, min_order_amount: e.target.value })}
          placeholder="0"
          type="number"
          min="0"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Действует с</Label>
          <Input value={form.valid_from} onChange={(e) => setForm({ ...form, valid_from: e.target.value })} type="date" />
        </div>
        <div className="space-y-1.5">
          <Label>Действует до</Label>
          <Input value={form.valid_to} onChange={(e) => setForm({ ...form, valid_to: e.target.value })} type="date" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label>Лимит использований (оставьте пустым для неограниченного)</Label>
        <Input
          value={form.usage_limit}
          onChange={(e) => setForm({ ...form, usage_limit: e.target.value })}
          placeholder="Без ограничений"
          type="number"
          min="1"
        />
      </div>
    </>
  )

  const today = new Date().toISOString().split('T')[0]

  function discountStatus(d: Discount): { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' } {
    if (!d.is_active) return { label: 'Неактивна', variant: 'secondary' }
    if (d.valid_to && d.valid_to < today) return { label: 'Истекла', variant: 'destructive' }
    if (d.valid_from && d.valid_from > today) return { label: 'Запланирована', variant: 'outline' }
    return { label: 'Активна', variant: 'default' }
  }

  return (
    <div className="app-page">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Tag className="h-6 w-6 text-blue-400" />
            Скидки и промо
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Скидки, промокоды и акции</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button size="sm" onClick={() => { setForm(EMPTY_FORM); setFormError(null); setShowAdd(true) }}>
            <Plus className="mr-2 h-4 w-4" />
            Создать скидку
          </Button>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          Загрузка...
        </div>
      ) : discounts.length === 0 ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16 text-muted-foreground text-sm">
            Скидок не найдено. Создайте первую!
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {discounts.map((discount) => {
            const status = discountStatus(discount)
            return (
              <Card key={discount.id} className={discount.is_active ? '' : 'opacity-60'}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <p className="font-semibold">{discount.name}</p>
                        <Badge variant={typeBadgeVariant(discount.type)}>{typeLabel(discount.type)}</Badge>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                      <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                        <span>
                          Значение: <span className="text-foreground font-medium">{valueDisplay(discount)}</span>
                        </span>
                        {discount.min_order_amount > 0 && (
                          <span>Мин. заказ: {discount.min_order_amount} ₸</span>
                        )}
                        {(discount.valid_from || discount.valid_to) && (
                          <span>
                            {discount.valid_from ? formatDate(discount.valid_from) : '∞'}
                            {' — '}
                            {discount.valid_to ? formatDate(discount.valid_to) : '∞'}
                          </span>
                        )}
                        {discount.usage_limit !== null && (
                          <span>
                            Использований: {discount.usage_count} / {discount.usage_limit}
                          </span>
                        )}
                      </div>
                      {discount.type === 'promo_code' && discount.promo_code && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className="rounded border border-white/20 bg-white/[0.05] px-2 py-0.5 font-mono text-sm">
                            {discount.promo_code}
                          </span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            title="Скопировать промокод"
                            onClick={() => copyPromoCode(discount.promo_code!, discount.id)}
                          >
                            {copiedId === discount.id ? (
                              <Check className="h-3.5 w-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEdit(discount)}>
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-rose-400 hover:text-rose-300"
                        onClick={() => void handleDelete(discount.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Создать скидку</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4">
            <DiscountFormFields />
            {formError && <p className="text-sm text-rose-400">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setShowAdd(false)}>Отмена</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Создание...' : 'Создать'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editDiscount} onOpenChange={(open) => { if (!open) { setEditDiscount(null); setForm(EMPTY_FORM) } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Редактировать скидку</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdate} className="space-y-4">
            <DiscountFormFields />
            {formError && <p className="text-sm text-rose-400">{formError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => { setEditDiscount(null); setForm(EMPTY_FORM) }}>Отмена</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Сохранение...' : 'Сохранить'}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
