'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, Loader2, Plus, Search } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { useModalEscape } from '@/lib/client/use-modal-escape'
import { formatMoney } from '@/lib/core/format'

type Supplier = {
  id: string
  name: string
  organization_name: string | null
  bin_iin: string | null
  contact_name: string | null
  phone: string | null
  preferred_expense_category_id: string | null
  receipts_count: number
  receipts_total: number
  last_receipt_date: string | null
  open_debts_count: number
  open_debts_sum: number
  aliases_count: number
}

const fmtDate = (value: string | null | undefined) => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleDateString('ru-RU')
  } catch {
    return String(value)
  }
}

export default function SuppliersListPage({ embedded = false }: { embedded?: boolean } = {}) {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const [addOpen, setAddOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', organization_name: '', bin_iin: '', contact_name: '', phone: '', lead_time_days: '3' })
  useModalEscape(addOpen, () => { if (!saving) setAddOpen(false) })

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/store/suppliers', { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить поставщиков')
      setSuppliers(json.data?.suppliers || [])
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const submitSupplier = async () => {
    if (!form.name.trim()) { setError('Введите название поставщика'); return }
    const digits = form.bin_iin.replace(/\D/g, '')
    if (digits && !/^\d{12}$/.test(digits)) { setError('ИИН/БИН — 12 цифр'); return }
    setSaving(true); setError(null)
    try {
      const res = await fetch('/api/admin/store/suppliers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          organization_name: form.organization_name.trim() || form.name.trim(),
          bin_iin: digits || null,
          contact_name: form.contact_name.trim() || null,
          phone: form.phone.trim() || null,
          lead_time_days: form.lead_time_days,
        }),
      })
      const j = await res.json().catch(() => null)
      if (!res.ok || !j?.ok) throw new Error(j?.error || 'Не удалось создать поставщика')
      setAddOpen(false)
      setForm({ name: '', organization_name: '', bin_iin: '', contact_name: '', phone: '', lead_time_days: '3' })
      await load()
    } catch (e: any) {
      setError(e?.message || 'Ошибка создания')
    } finally {
      setSaving(false)
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return suppliers
    return suppliers.filter((s) => {
      return (
        s.name.toLowerCase().includes(q)
        || (s.organization_name || '').toLowerCase().includes(q)
        || (s.bin_iin || '').includes(q)
      )
    })
  }, [suppliers, query])

  return (
    <div className={embedded ? 'space-y-6' : 'app-page-wide space-y-6'}>
      {(() => {
        const hdrToolbar = (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative max-w-md flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по названию или БИН/ИИН..."
                className="pl-9"
              />
            </div>
            <Button type="button" size="sm" className="gap-1.5 bg-emerald-600 hover:bg-emerald-700" onClick={() => { setError(null); setAddOpen(true) }}>
              <Plus className="h-3.5 w-3.5" /> Добавить поставщика
            </Button>
          </div>
        )
        return embedded ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            {hdrToolbar}
          </div>
        ) : (
          <AdminPageHeader
            title="Поставщики"
            description="Все поставщики, обороты, долги и алиасы"
            icon={<Building2 className="h-5 w-5" />}
            accent="emerald"
            backHref="/"
            toolbar={hdrToolbar}
          />
        )
      })()}

      {error ? <Card className="p-3 border-red-500/30 bg-red-500/10 text-sm text-red-700 dark:text-red-200">{error}</Card> : null}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка...
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">Поставщиков нет.</Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-slate-50 dark:bg-white/[0.04] text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-normal">Поставщик</th>
                <th className="px-3 py-2.5 font-normal">БИН/ИИН</th>
                <th className="px-3 py-2.5 text-right font-normal">Накладных</th>
                <th className="px-3 py-2.5 text-right font-normal">Оборот</th>
                <th className="px-3 py-2.5 text-right font-normal">Открытые долги</th>
                <th className="px-3 py-2.5 text-right font-normal">Алиасов</th>
                <th className="px-3 py-2.5 font-normal">Последняя</th>
                <th className="px-2 py-2.5"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/store/suppliers/${s.id}`} className="font-medium hover:text-emerald-700 dark:hover:text-emerald-300">
                      {s.organization_name || s.name}
                    </Link>
                    {s.organization_name && s.organization_name !== s.name ? (
                      <p className="text-xs text-muted-foreground">{s.name}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{s.bin_iin || '—'}</td>
                  <td className="px-3 py-2.5 text-right">{s.receipts_count}</td>
                  <td className="px-3 py-2.5 text-right">{formatMoney(s.receipts_total)} ₸</td>
                  <td className="px-3 py-2.5 text-right">
                    {s.open_debts_count > 0 ? (
                      <span className="text-amber-700 dark:text-amber-200">
                        {s.open_debts_count} · {formatMoney(s.open_debts_sum)} ₸
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">{s.aliases_count}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDate(s.last_receipt_date)}</td>
                  <td className="px-2 py-2.5 text-right">
                    <Link href={`/store/suppliers/${s.id}`} className="inline-flex items-center text-xs text-emerald-700 dark:text-emerald-300 hover:text-emerald-700 dark:hover:text-emerald-200">
                      Открыть <ArrowRight className="w-3 h-3 ml-1" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {addOpen ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onClick={(e) => { if (e.target === e.currentTarget && !saving) setAddOpen(false) }}>
          <Card className="w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto border-border bg-white dark:bg-gray-900 p-5">
            <div className="mb-4 text-base font-semibold text-foreground">Новый поставщик</div>
            <div className="space-y-3">
              <div>
                <Label className="mb-1 block text-xs">Название *</Label>
                <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Напр. Артур ИП" autoFocus />
              </div>
              <div>
                <Label className="mb-1 block text-xs">Организация (для накладных)</Label>
                <Input value={form.organization_name} onChange={(e) => setForm((f) => ({ ...f, organization_name: e.target.value }))} placeholder="Если пусто — возьмём название" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 block text-xs">БИН/ИИН</Label>
                  <Input value={form.bin_iin} onChange={(e) => setForm((f) => ({ ...f, bin_iin: e.target.value }))} placeholder="12 цифр" inputMode="numeric" />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Срок поставки, дн</Label>
                  <Input type="number" min={0} value={form.lead_time_days} onChange={(e) => setForm((f) => ({ ...f, lead_time_days: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="mb-1 block text-xs">Контакт</Label>
                  <Input value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} placeholder="Имя" />
                </div>
                <div>
                  <Label className="mb-1 block text-xs">Телефон</Label>
                  <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+7…" />
                </div>
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Отмена</Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700" onClick={() => void submitSupplier()} disabled={saving || !form.name.trim()}>
                {saving ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" />Создаю…</> : 'Создать'}
              </Button>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
