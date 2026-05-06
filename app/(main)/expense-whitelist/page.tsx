'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, Plus, Trash2, AlertCircle, Loader2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useCapabilities } from '@/lib/client/use-capabilities'

type Vendor = {
  id: string
  vendor_name: string
  company_id: string | null
  default_category_id: string | null
  notes: string | null
  archived_at: string | null
}

type Company = { id: string; name: string }
type Category = { id: string; name: string }

export default function ExpenseWhitelistPage() {
  const [items, setItems] = useState<Vendor[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const { can } = useCapabilities()

  const [form, setForm] = useState({
    vendor_name: '',
    company_id: '',
    default_category_id: '',
    notes: '',
  })

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [wlRes, compRes, catRes] = await Promise.all([
        fetch('/api/admin/expenses/whitelist', { cache: 'no-store' }),
        fetch('/api/admin/companies', { cache: 'no-store' }),
        fetch('/api/admin/expense-categories', { cache: 'no-store' }),
      ])
      if (!wlRes.ok) throw new Error('Не удалось загрузить список')
      setItems((await wlRes.json()).data || [])
      setCompanies(compRes.ok ? (await compRes.json()).data || [] : [])
      setCategories(catRes.ok ? (await catRes.json()).data || [] : [])
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function add() {
    if (form.vendor_name.trim().length < 2) {
      setError('Введите имя вендора')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/admin/expenses/whitelist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vendor_name: form.vendor_name.trim(),
          company_id: form.company_id || null,
          default_category_id: form.default_category_id || null,
          notes: form.notes.trim() || null,
        }),
      })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось добавить')
      setForm({ vendor_name: '', company_id: '', default_category_id: '', notes: '' })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    if (!window.confirm('Архивировать этого вендора? Существующие расходы не пострадают.')) return
    try {
      const response = await fetch(`/api/admin/expenses/whitelist?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      const json = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(json.error || 'Не удалось удалить')
      setItems((prev) => prev.filter((v) => v.id !== id))
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    }
  }

  return (
    <div className="app-page-tight max-w-3xl mx-auto py-6">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/expenses">
          <Button variant="outline" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Доверенные поставщики</h1>
          <p className="text-sm text-muted-foreground">Вендоры, которым можно платить без чека (уборщик, дворник, регулярные услуги)</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-destructive text-sm flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {can('expense-whitelist.create') && (
        <Card className="p-4 mb-6 space-y-3">
          <h3 className="font-semibold">Добавить вендора</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <input
              placeholder="Имя или название"
              value={form.vendor_name}
              onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))}
              className="h-10 px-3 rounded-md border bg-background"
            />
            <select
              value={form.company_id}
              onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
              className="h-10 px-3 rounded-md border bg-background"
            >
              <option value="">— Все точки —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={form.default_category_id}
              onChange={(e) => setForm((f) => ({ ...f, default_category_id: e.target.value }))}
              className="h-10 px-3 rounded-md border bg-background"
            >
              <option value="">— Категория по умолчанию —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              placeholder="Заметка (опционально)"
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              className="h-10 px-3 rounded-md border bg-background"
            />
          </div>
          <Button onClick={add} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
            Добавить
          </Button>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-12 text-muted-foreground">Загрузка...</div>
      ) : items.length === 0 ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          Пока нет доверенных поставщиков
        </Card>
      ) : (
        <div className="space-y-2">
          {items.map((v) => (
            <Card key={v.id} className="p-3 flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{v.vendor_name}</div>
                <div className="text-xs text-muted-foreground">
                  {v.company_id ? companies.find((c) => c.id === v.company_id)?.name || '—' : 'Все точки'}
                  {v.default_category_id && (
                    <> · {categories.find((c) => c.id === v.default_category_id)?.name || '—'}</>
                  )}
                </div>
                {v.notes && <div className="text-xs text-muted-foreground italic mt-1">{v.notes}</div>}
              </div>
              {can('expense-whitelist.delete') && (
                <Button variant="ghost" size="icon" onClick={() => remove(v.id)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
