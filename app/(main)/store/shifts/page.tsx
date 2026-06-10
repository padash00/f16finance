'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Clock, Loader2, RefreshCw, Settings, User, Wallet, CreditCard } from 'lucide-react'

type Shift = {
  id: string
  status: string
  shift_type?: string | null
  opened_at: string
  closed_at: string | null
  opening_cash: number | null
  closing_cash: number | null
  closing_kaspi: number | null
  totals_json?: any
  operator?: { full_name?: string | null; short_name?: string | null } | null
}

const fmt = (n: number | null | undefined) => Number(n || 0).toLocaleString('ru-RU')
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const STATUS: { key: string; label: string }[] = [
  { key: 'closed', label: 'Закрытые' },
  { key: 'open', label: 'Открытые' },
  { key: 'all', label: 'Все' },
]

function salesOf(s: Shift): number | null {
  const t = s.totals_json
  if (!t || typeof t !== 'object') return null
  const v = t.sales_total ?? t.total_sales ?? t.revenue ?? t.sales ?? t.total
  return typeof v === 'number' ? v : null
}

export default function StoreShiftsPage() {
  const [storeCompanyId, setStoreCompanyId] = useState<string | null | undefined>(undefined)
  const [status, setStatus] = useState('closed')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/store/config', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setStoreCompanyId(j?.data?.store_company_id || null))
      .catch(() => setStoreCompanyId(null))
  }, [])

  const load = useCallback(async () => {
    if (!storeCompanyId) return
    setLoading(true); setErr(null)
    try {
      const p = new URLSearchParams({ company_id: storeCompanyId, status, limit: '200' })
      const res = await fetch(`/api/admin/shifts/reports?${p}`, { cache: 'no-store' })
      const j = await res.json()
      if (!res.ok || !j.ok) throw new Error(j.error || 'Ошибка загрузки')
      setShifts(j.data?.shifts || [])
    } catch (e: any) { setErr(e?.message || 'Ошибка') } finally { setLoading(false) }
  }, [storeCompanyId, status])

  useEffect(() => { if (storeCompanyId) load() }, [storeCompanyId, load])

  if (storeCompanyId === undefined) {
    return <div className="app-page-wide flex items-center justify-center gap-2 py-20 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
  }

  if (!storeCompanyId) {
    return (
      <div className="app-page-wide space-y-5">
        <AdminPageHeader title="Смены" description="Смены по точке-магазину" icon={<Clock className="h-5 w-5" />} accent="emerald" backHref="/store" />
        <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 p-6 text-center">
          <p className="text-sm text-amber-100">Точка магазина не выбрана.</p>
          <Link href="/store/settings" className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700">
            <Settings className="h-4 w-4" /> Выбрать точку
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Смены"
        description="Смены по точке-магазину"
        icon={<Clock className="h-5 w-5" />}
        accent="emerald"
        backHref="/store"
        actions={
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
          </button>
        }
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-white/10 bg-slate-950/50 p-1">
            {STATUS.map(({ key, label }) => (
              <button key={key} onClick={() => setStatus(key)} className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${status === key ? 'bg-white/10 text-white shadow-sm ring-1 ring-white/10' : 'text-slate-400 hover:text-white'}`}>{label}</button>
            ))}
          </div>
        }
      />

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{err}</div>}

      <div className="rounded-2xl border border-white/10 bg-slate-900/60 shadow-lg shadow-black/20 overflow-hidden">
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <span className="text-sm font-semibold text-white">Смены</span>
          <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-slate-400">{shifts.length}</span>
        </div>
        {loading && shifts.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
        ) : shifts.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">Смен нет</div>
        ) : (
          <div className="divide-y divide-white/5">
            {shifts.map((s) => {
              const sales = salesOf(s)
              const open = s.status === 'open'
              return (
                <div key={s.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
                  <div className="flex min-w-[180px] items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-white/5 text-slate-400"><User className="h-4 w-4" /></span>
                    <div>
                      <div className="text-sm font-medium text-white">{s.operator?.full_name || s.operator?.short_name || '—'}</div>
                      <div className="text-[11px] text-slate-500">{dt(s.opened_at)} → {dt(s.closed_at)}</div>
                    </div>
                  </div>
                  <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${open ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5 text-slate-400'}`}>
                    {open ? 'Открыта' : 'Закрыта'}
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    {sales != null && (
                      <div className="text-right"><div className="text-[11px] text-slate-500">Продажи</div><div className="font-semibold tabular-nums text-emerald-300">{fmt(sales)} ₸</div></div>
                    )}
                    <div className="text-right"><div className="flex items-center justify-end gap-1 text-[11px] text-slate-500"><Wallet className="h-3 w-3" /> Касса</div><div className="font-medium tabular-nums text-white">{fmt(s.closing_cash)} ₸</div></div>
                    <div className="text-right"><div className="flex items-center justify-end gap-1 text-[11px] text-slate-500"><CreditCard className="h-3 w-3" /> Безнал</div><div className="font-medium tabular-nums text-sky-300">{fmt(s.closing_kaspi)} ₸</div></div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
