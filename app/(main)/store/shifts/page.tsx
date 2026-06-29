'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { Clock, Loader2, RefreshCw, Settings, User, Wallet, CreditCard, X, ChevronRight, TrendingUp, RotateCcw } from 'lucide-react'

type LiveTotals = { sales: number; cash: number; kaspi: number; count: number }
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
  live_totals?: LiveTotals | null
  operator?: { full_name?: string | null; short_name?: string | null } | null
}

const fmt = (n: number | null | undefined) => Number(n || 0).toLocaleString('ru-RU')
const dt = (s: string | null) => (s ? new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')
const tm = (s: string | null) => (s ? new Date(s).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '—')
const STATUS: { key: string; label: string }[] = [
  { key: 'closed', label: 'Закрытые' },
  { key: 'open', label: 'Открытые' },
  { key: 'all', label: 'Все' },
]
const PAY_LABEL: Record<string, string> = { cash: 'Нал', kaspi: 'Безнал', card: 'Карта', online: 'Онлайн', mixed: 'Смеш.' }
const PAY_CHIP: Record<string, string> = {
  cash: 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300',
  kaspi: 'border-amber-400/30 bg-amber-500/10 text-amber-300',
  card: 'border-sky-400/30 bg-sky-500/10 text-sky-300',
  online: 'border-violet-400/30 bg-violet-500/10 text-violet-300',
  mixed: 'border-slate-400/30 bg-slate-500/10 text-slate-300',
}

function salesOf(s: Shift): number | null {
  if (s.status === 'open') return s.live_totals?.sales ?? null
  const t = s.totals_json
  if (t && typeof t === 'object') {
    const v = t.sales_total ?? t.total_sales ?? t.revenue ?? t.sales ?? t.total
    if (typeof v === 'number') return v
  }
  return null
}

export default function StoreShiftsPage() {
  const [storeCompanyId, setStoreCompanyId] = useState<string | null | undefined>(undefined)
  const [status, setStatus] = useState('closed')
  const [shifts, setShifts] = useState<Shift[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

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
          <p className="text-sm text-amber-700 dark:text-amber-100">Точка магазина не выбрана.</p>
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
          <button onClick={load} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-white dark:bg-white/5 px-3 py-2 text-xs font-medium text-body transition-colors hover:bg-slate-50 dark:hover:bg-white/10">
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Обновить
          </button>
        }
        toolbar={
          <div className="inline-flex flex-wrap gap-1 rounded-2xl border border-border bg-slate-50 dark:bg-slate-950/50 p-1">
            {STATUS.map(({ key, label }) => (
              <button key={key} onClick={() => setStatus(key)} className={`rounded-xl px-4 py-2 text-sm font-medium transition-all ${status === key ? 'bg-white dark:bg-white/10 text-foreground shadow-sm ring-1 ring-slate-200 dark:ring-white/10' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'}`}>{label}</button>
            ))}
          </div>
        }
      />

      {err && <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-200">{err}</div>}

      <div className="rounded-2xl border border-border bg-white dark:bg-slate-900/60 shadow-lg shadow-black/20 overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="text-sm font-semibold text-foreground">Смены</span>
          <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">{shifts.length}</span>
        </div>
        {loading && shifts.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
        ) : shifts.length === 0 ? (
          <div className="px-4 py-16 text-center text-sm text-slate-400">Смен нет</div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-white/5">
            {shifts.map((s) => {
              const sales = salesOf(s)
              const open = s.status === 'open'
              const cash = open ? (s.live_totals?.cash ?? 0) : Number(s.closing_cash || 0)
              const kaspi = open ? (s.live_totals?.kaspi ?? 0) : Number(s.closing_kaspi || 0)
              return (
                <button key={s.id} onClick={() => setDetailId(s.id)} className="flex w-full flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/[0.03]">
                  <div className="flex min-w-[180px] items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center rounded-lg bg-slate-100 dark:bg-white/5 text-muted-foreground"><User className="h-4 w-4" /></span>
                    <div>
                      <div className="text-sm font-medium text-foreground">{s.operator?.full_name || s.operator?.short_name || '—'}</div>
                      <div className="text-[11px] text-slate-500">{dt(s.opened_at)} → {dt(s.closed_at)}</div>
                    </div>
                  </div>
                  <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${open ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border bg-surface-muted text-muted-foreground'}`}>
                    {open ? 'Открыта' : 'Закрыта'}
                  </span>
                  <div className="ml-auto flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
                    {sales != null && (
                      <div className="text-right"><div className="text-[11px] text-slate-500">Продажи</div><div className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">{fmt(sales)} ₸</div></div>
                    )}
                    <div className="text-right"><div className="flex items-center justify-end gap-1 text-[11px] text-slate-500"><Wallet className="h-3 w-3" /> Касса</div><div className="font-medium tabular-nums text-foreground">{fmt(cash)} ₸</div></div>
                    <div className="text-right"><div className="flex items-center justify-end gap-1 text-[11px] text-slate-500"><CreditCard className="h-3 w-3" /> Безнал</div><div className="font-medium tabular-nums text-sky-700 dark:text-sky-300">{fmt(kaspi)} ₸</div></div>
                    <ChevronRight className="h-4 w-4 text-slate-600" />
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {detailId && <ShiftDetail id={detailId} onClose={() => setDetailId(null)} onChanged={load} />}
    </div>
  )
}

function ShiftDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  useEffect(() => {
    let active = true
    setLoading(true); setErr(null)
    fetch(`/api/admin/shifts/reports/${id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!active) return; if (!j.ok) throw new Error(j.error || 'Ошибка'); setData(j.data) })
      .catch((e) => { if (active) setErr(e?.message || 'Ошибка') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [id])

  if (!mounted) return null

  const shift = data?.shift
  const sales = (data?.sales || []) as any[]
  const returns = (data?.returns || []) as any[]
  const open = shift?.status === 'open'
  const salesTotal = sales.reduce((s, x) => s + Number(x.total_amount || 0), 0)
  const cashTotal = sales.reduce((s, x) => s + Number(x.cash_amount || 0), 0)
  const kaspiTotal = sales.reduce((s, x) => s + Number(x.kaspi_amount || 0), 0)
  const returnsTotal = returns.reduce((s, x) => s + Number(x.total_amount || 0), 0)

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-border bg-card shadow-2xl">
        {/* Шапка */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-emerald-400/30 bg-emerald-500/15"><Clock className="h-5 w-5 text-emerald-700 dark:text-emerald-300" /></span>
            <div>
              <div className="flex items-center gap-2 text-base font-semibold text-foreground">
                {shift?.operator?.full_name || shift?.operator?.short_name || 'Смена'}
                <span className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${open ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'border-border bg-surface-muted text-muted-foreground'}`}>{open ? 'Открыта' : 'Закрыта'}</span>
              </div>
              <div className="text-xs text-slate-500">{dt(shift?.opened_at)} → {dt(shift?.closed_at)}</div>
            </div>
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-slate-100 dark:hover:bg-white/5 hover:text-slate-900 dark:hover:text-white"><X className="h-4 w-4" /></button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-slate-400"><Loader2 className="h-5 w-5 animate-spin" /> Загрузка…</div>
        ) : err ? (
          <div className="m-5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-700 dark:text-rose-200">{err}</div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5">
            {/* KPI */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Kpi label="Продажи" value={`${fmt(salesTotal)} ₸`} accent="text-emerald-700 dark:text-emerald-300" icon={<TrendingUp className="h-4 w-4" />} />
              <Kpi label="Касса" value={`${fmt(open ? cashTotal : (shift?.closing_cash ?? cashTotal))} ₸`} accent="text-foreground" icon={<Wallet className="h-4 w-4" />} />
              <Kpi label="Безнал" value={`${fmt(open ? kaspiTotal : (shift?.closing_kaspi ?? kaspiTotal))} ₸`} accent="text-sky-700 dark:text-sky-300" icon={<CreditCard className="h-4 w-4" />} />
              <Kpi label="Возвраты" value={`${fmt(returnsTotal)} ₸`} accent={returnsTotal > 0 ? 'text-rose-700 dark:text-rose-300' : 'text-muted-foreground'} icon={<RotateCcw className="h-4 w-4" />} />
            </div>
            {open && (
              <div className="mt-3 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] px-3 py-2 text-xs text-emerald-700 dark:text-emerald-200">
                Смена открыта — суммы по продажам в реальном времени. Касса/Безнал зафиксируются при закрытии.
              </div>
            )}

            {/* Продажи */}
            <div className="mt-5 mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground">Продажи</span>
              <span className="rounded-full border border-border bg-surface-muted px-2 py-0.5 text-xs text-muted-foreground">{sales.length}</span>
            </div>
            {sales.length === 0 ? (
              <div className="rounded-xl border border-border bg-slate-50 dark:bg-white/[0.02] px-4 py-8 text-center text-sm text-muted-foreground">Продаж нет</div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5 overflow-hidden rounded-xl border border-border">
                {sales.map((s) => {
                  const chip = PAY_CHIP[s.payment_method] || PAY_CHIP.mixed
                  const items = (s.items || []) as any[]
                  const names = items.map((it) => (it.item?.name || it.universal_name)).filter(Boolean)
                  return (
                    <div key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                      <div className="w-10 shrink-0 text-xs tabular-nums text-muted-foreground">{tm(s.sold_at)}</div>
                      <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${chip}`}>{PAY_LABEL[s.payment_method] || s.payment_method}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm text-foreground">{names.length > 0 ? names.join(', ') : `${items.length} позиц.`}</div>
                        {s.operator?.full_name || s.operator?.short_name ? <div className="text-[11px] text-slate-500">{s.operator?.full_name || s.operator?.short_name}</div> : null}
                      </div>
                      <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmt(s.total_amount)} ₸</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Возвраты */}
            {returns.length > 0 && (
              <>
                <div className="mt-5 mb-2 text-sm font-semibold text-foreground">Возвраты</div>
                <div className="divide-y divide-slate-100 dark:divide-white/5 overflow-hidden rounded-xl border border-rose-500/20">
                  {returns.map((r) => (
                    <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <div className="text-xs text-muted-foreground">{tm(r.returned_at)} · {PAY_LABEL[r.payment_method] || r.payment_method}{r.comment ? ` · ${r.comment}` : ''}</div>
                      <div className="shrink-0 text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300">−{fmt(r.total_amount)} ₸</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function Kpi({ label, value, accent, icon }: { label: string; value: string; accent: string; icon: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-muted p-3">
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-slate-500"><span>{label}</span><span className="text-muted-foreground">{icon}</span></div>
      <div className={`mt-1 text-base font-bold tabular-nums ${accent}`}>{value}</div>
    </div>
  )
}
