'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Building2, Loader2, Search } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

export default function SuppliersListPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch('/api/admin/store/suppliers', { cache: 'no-store' })
        const json = await response.json().catch(() => null)
        if (cancelled) return
        if (!response.ok || !json?.ok) throw new Error(json?.error || 'Не удалось загрузить поставщиков')
        setSuppliers(json.data?.suppliers || [])
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Ошибка загрузки')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

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
    <div className="app-page max-w-[1400px] space-y-5">
      <div className="flex items-center gap-3">
        <div className="p-3 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
          <Building2 className="w-6 h-6 text-emerald-300" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold">Поставщики</h1>
          <p className="text-sm text-muted-foreground">Все поставщики, обороты, долги и алиасы</p>
        </div>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию или БИН/ИИН..."
          className="pl-9"
        />
      </div>

      {error ? <Card className="p-3 border-red-500/30 bg-red-500/10 text-sm text-red-200">{error}</Card> : null}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Загрузка...
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-6 text-sm text-muted-foreground text-center">Поставщиков нет.</Card>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="bg-white/[0.04] text-left text-xs text-muted-foreground">
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
            <tbody className="divide-y divide-white/[0.04]">
              {filtered.map((s) => (
                <tr key={s.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-2.5">
                    <Link href={`/store/suppliers/${s.id}`} className="font-medium hover:text-emerald-300">
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
                      <span className="text-amber-200">
                        {s.open_debts_count} · {formatMoney(s.open_debts_sum)} ₸
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">{s.aliases_count}</td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{fmtDate(s.last_receipt_date)}</td>
                  <td className="px-2 py-2.5 text-right">
                    <Link href={`/store/suppliers/${s.id}`} className="inline-flex items-center text-xs text-emerald-300 hover:text-emerald-200">
                      Открыть <ArrowRight className="w-3 h-3 ml-1" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
