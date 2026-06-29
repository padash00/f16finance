'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2, AlertCircle, Loader2, ShieldCheck } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { useCapabilities } from '@/lib/client/use-capabilities'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

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

  const inputCls = 'h-10 rounded-xl border border-border bg-white dark:bg-slate-950/50 px-3 text-sm text-foreground placeholder-slate-500 focus:border-emerald-400/50 focus:outline-none focus:ring-2 focus:ring-emerald-500/15'

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Доверенные поставщики"
        description="Кому можно платить без фото чека"
        icon={<ShieldCheck className="h-5 w-5" />}
        accent="emerald"
        backHref="/expenses"
      />

      {/* Что это такое */}
      <div className="flex gap-3 rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4 text-sm text-emerald-50/80">
        <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
        <div>
          <span className="font-semibold text-emerald-700 dark:text-emerald-200">Что это.</span> Поставщики и получатели,
          которым можно платить <span className="font-semibold text-foreground">без чека</span>. Когда добавляешь расход
          и выбираешь такого — фото чека <span className="font-semibold text-foreground">не требуется</span>.
          Удобно для зарплат, аренды, уборки, разовых выплат и регулярных услуг.
          <div className="mt-1 text-xs text-emerald-100/50">
            «Все точки» — действует на всех; можно ограничить конкретной точкой. Категория подставится в расход автоматически.
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-700 dark:text-rose-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {can('expense-whitelist.create') && (
        <div className="rounded-2xl border border-border bg-white dark:bg-slate-900/60 p-4 shadow-lg shadow-black/20 space-y-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300"><Plus className="h-4 w-4" /></span>
            Добавить вендора
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <input
              placeholder="Имя или название (напр. Дворник Геннадий)"
              value={form.vendor_name}
              onChange={(e) => setForm((f) => ({ ...f, vendor_name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') add() }}
              className={inputCls}
            />
            <select
              value={form.company_id}
              onChange={(e) => setForm((f) => ({ ...f, company_id: e.target.value }))}
              className={inputCls}
            >
              <option value="">— Все точки —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={form.default_category_id}
              onChange={(e) => setForm((f) => ({ ...f, default_category_id: e.target.value }))}
              className={inputCls}
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
              className={inputCls}
            />
          </div>
          <Button onClick={add} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Добавить
          </Button>
        </div>
      )}

      {/* Список */}
      <div className="overflow-hidden rounded-2xl border border-border bg-white dark:bg-slate-900/60 shadow-lg shadow-black/20">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Список</span>
          <span className="rounded-full border border-border bg-slate-50 dark:bg-white/5 px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
        </div>

        {loading && items.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
            <Loader2 className="h-5 w-5 animate-spin" /> <span className="text-sm">Загрузка…</span>
          </div>
        ) : items.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-slate-400">
            Пока нет доверенных поставщиков. Добавьте первого в форме выше.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {items.map((v) => {
              const companyName = v.company_id ? companies.find((c) => c.id === v.company_id)?.name || '—' : 'Все точки'
              const categoryName = v.default_category_id ? categories.find((c) => c.id === v.default_category_id)?.name || '—' : null
              return (
                <div key={v.id} className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                      <ShieldCheck className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{v.vendor_name}</div>
                      <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                        <span className={v.company_id ? 'text-sky-600 dark:text-sky-300' : ''}>{companyName}</span>
                        {categoryName && <><span className="text-slate-600">·</span><span>{categoryName}</span></>}
                        {v.notes && <><span className="text-slate-600">·</span><span className="italic text-slate-500">{v.notes}</span></>}
                      </div>
                    </div>
                  </div>
                  {can('expense-whitelist.delete') && (
                    <Button variant="ghost" size="icon" className="shrink-0 text-slate-500 hover:text-rose-400" title="Архивировать" onClick={() => remove(v.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
