'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import {
  Activity, RefreshCw, Loader2, TrendingUp, Receipt, Wallet, CreditCard,
  Clock, Trophy, Store, Pause, Play,
} from 'lucide-react'

const REFRESH_MS = 12_000

type Totals = { amount: number; count: number; avg_check: number; cash: number; cashless: number }
type ByCompany = { company_id: string; name: string; amount: number; count: number; avg_check: number }
type ByHour = { hour: number; amount: number; count: number }
type TopItem = { name: string; qty: number; revenue: number }
type Recent = {
  id: string; sold_at: string; company_name: string; operator_name: string
  total_amount: number; payment_method: string; items: string[]; items_count: number
}
type Data = {
  date: string
  totals: Totals
  last_hour: { amount: number; count: number }
  payment: { cash: number; kaspi: number; card: number; online: number }
  by_company: ByCompany[]
  by_hour: ByHour[]
  top_items: TopItem[]
  recent: Recent[]
}

const card = 'rounded-2xl border border-white/10 bg-slate-900/60 shadow-lg shadow-black/20'
const PAY_LABEL: Record<string, string> = { cash: 'Нал', kaspi: 'Безнал', card: 'Карта', online: 'Онлайн', mixed: 'Смеш.' }
const PAY_CHIP: Record<string, string> = {
  cash: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30',
  kaspi: 'bg-amber-500/15 text-amber-300 border-amber-400/30',
  card: 'bg-sky-500/15 text-sky-300 border-sky-400/30',
  online: 'bg-violet-500/15 text-violet-300 border-violet-400/30',
  mixed: 'bg-slate-500/15 text-slate-300 border-slate-400/30',
}

const fmt = (n: number) => Number(n || 0).toLocaleString('ru-RU')
const pad2 = (n: number) => String(n).padStart(2, '0')

export default function SalesMonitorPage() {
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(today)
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<number | null>(null)
  const [tick, setTick] = useState(0) // для счётчика «N сек назад»
  const seenIds = useRef<Set<string>>(new Set())
  const [flashIds, setFlashIds] = useState<Set<string>>(new Set())

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/sales-monitor?date=${date}`, { cache: 'no-store' })
      const json = await res.json()
      if (!res.ok || !json.ok) throw new Error(json.error || 'Ошибка загрузки')
      const next = json.data as Data
      // Подсветка новых продаж
      const prevSeen = seenIds.current
      const fresh = new Set<string>()
      for (const r of next.recent) if (!prevSeen.has(r.id)) fresh.add(r.id)
      if (prevSeen.size > 0 && fresh.size > 0) {
        setFlashIds(fresh)
        setTimeout(() => setFlashIds(new Set()), 2500)
      }
      seenIds.current = new Set(next.recent.map((r) => r.id))
      setData(next)
      setLastUpdated(Date.now())
    } catch (e: any) {
      setError(e?.message || 'Ошибка')
    } finally {
      setLoading(false)
    }
  }, [date])

  useEffect(() => { seenIds.current = new Set(); load() }, [load])

  // Авто-обновление
  useEffect(() => {
    if (!live) return
    const id = setInterval(() => load(true), REFRESH_MS)
    return () => clearInterval(id)
  }, [live, load])

  // Тик для «N сек назад»
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const agoSec = lastUpdated ? Math.floor((Date.now() - lastUpdated) / 1000) : null
  void tick

  const t = data?.totals
  const maxHour = useMemo(() => Math.max(1, ...(data?.by_hour.map((h) => h.amount) || [1])), [data])
  const activeHours = data?.by_hour.filter((h) => h.amount > 0) || []
  const maxCompany = useMemo(() => Math.max(1, ...(data?.by_company.map((c) => c.amount) || [1])), [data])

  return (
    <div className="app-page-wide space-y-5">
      <AdminPageHeader
        title="Монитор продаж"
        description="Продажи и аналитика в реальном времени"
        icon={<Activity className="h-5 w-5" />}
        accent="blue"
        backHref="/"
        actions={
          <>
            <input
              type="date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-xl border border-white/10 bg-slate-950/50 px-3 py-2 text-sm text-white [color-scheme:dark] focus:border-sky-400/50 focus:outline-none"
            />
            <button
              onClick={() => setLive((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                live ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200' : 'border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {live ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {live ? 'Авто-обновление' : 'Пауза'}
            </button>
            <button
              onClick={() => load()}
              className="inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-300 transition-colors hover:bg-white/10"
            >
              {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              Обновить
            </button>
          </>
        }
      />

      {/* Статус-строка */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 ${live ? 'border-emerald-400/30 bg-emerald-500/10 text-emerald-300' : 'border-white/10 bg-white/5'}`}>
          <span className={`h-2 w-2 rounded-full ${live ? 'animate-pulse bg-emerald-400' : 'bg-slate-500'}`} />
          {live ? 'В реальном времени' : 'Обновление на паузе'}
        </span>
        {agoSec !== null && <span>обновлено {agoSec < 5 ? 'только что' : `${agoSec} с назад`}</span>}
        {data && <span className="text-slate-500">· {data.date === today ? 'сегодня' : data.date}</span>}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">{error}</div>
      )}

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
          <Loader2 className="h-6 w-6 animate-spin" /> Загрузка…
        </div>
      ) : data ? (
        <>
          {/* KPI */}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Kpi label="Выручка" value={`${fmt(t!.amount)} ₸`} icon={<TrendingUp className="h-4 w-4" />} accent="text-emerald-300" big />
            <Kpi label="Продаж" value={fmt(t!.count)} icon={<Receipt className="h-4 w-4" />} accent="text-white" big />
            <Kpi label="Средний чек" value={`${fmt(t!.avg_check)} ₸`} icon={<Activity className="h-4 w-4" />} accent="text-white" />
            <Kpi label="Наличные" value={`${fmt(t!.cash)} ₸`} icon={<Wallet className="h-4 w-4" />} accent="text-emerald-300" />
            <Kpi label="Безнал" value={`${fmt(t!.cashless)} ₸`} icon={<CreditCard className="h-4 w-4" />} accent="text-sky-300" />
            <Kpi label="За последний час" value={`${fmt(data.last_hour.amount)} ₸`} sub={`${data.last_hour.count} продаж`} icon={<Clock className="h-4 w-4" />} accent="text-amber-300" />
          </div>

          {/* По точкам */}
          {data.by_company.length > 0 && (
            <div className={`${card} p-4`}>
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                <Store className="h-4 w-4 text-sky-300" /> По точкам
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.by_company.map((c) => (
                  <div key={c.company_id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-sm font-medium text-white">{c.name}</span>
                      <span className="shrink-0 text-xs text-slate-400">{c.count} продаж</span>
                    </div>
                    <div className="mt-1 text-xl font-bold tabular-nums text-emerald-300">{fmt(c.amount)} ₸</div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
                      <div className="h-full rounded-full bg-sky-400/70" style={{ width: `${Math.round((c.amount / maxCompany) * 100)}%` }} />
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">ср. чек {fmt(c.avg_check)} ₸</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            {/* Живая лента */}
            <div className={`${card} overflow-hidden`}>
              <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Activity className="h-4 w-4 text-emerald-300" /> Лента продаж
                </span>
                <span className="text-xs text-slate-500">последние {data.recent.length}</span>
              </div>
              <div className="max-h-[520px] overflow-y-auto divide-y divide-white/5">
                {data.recent.length === 0 ? (
                  <div className="px-4 py-12 text-center text-sm text-slate-400">Продаж пока нет</div>
                ) : (
                  data.recent.map((s) => {
                    const time = new Date(s.sold_at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                    const chip = PAY_CHIP[s.payment_method] || PAY_CHIP.mixed
                    const isNew = flashIds.has(s.id)
                    return (
                      <div key={s.id} className={`flex items-center gap-3 px-4 py-2.5 transition-colors ${isNew ? 'bg-emerald-500/10' : 'hover:bg-white/[0.02]'}`}>
                        <div className="w-11 shrink-0 text-xs tabular-nums text-slate-400">{time}</div>
                        <span className={`shrink-0 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${chip}`}>{PAY_LABEL[s.payment_method] || s.payment_method}</span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm text-white">
                            {s.items.length > 0 ? s.items.join(', ') : `${s.items_count} позиц.`}
                          </div>
                          <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                            <span className="text-sky-300/80">{s.company_name}</span>
                            {s.operator_name !== '—' && <><span>·</span><span>{s.operator_name}</span></>}
                          </div>
                        </div>
                        <div className="shrink-0 text-sm font-semibold tabular-nums text-white">{fmt(s.total_amount)} ₸</div>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            {/* Правая колонка */}
            <div className="space-y-5">
              {/* Топ товары */}
              <div className={`${card} p-4`}>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                  <Trophy className="h-4 w-4 text-amber-300" /> Топ товары
                </div>
                {data.top_items.length === 0 ? (
                  <div className="py-6 text-center text-sm text-slate-400">Нет данных</div>
                ) : (
                  <div className="space-y-1.5">
                    {data.top_items.map((it, i) => (
                      <div key={it.name} className="flex items-center gap-3 text-sm">
                        <span className="w-5 shrink-0 text-center text-xs text-slate-500">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate text-slate-200">{it.name}</span>
                        <span className="shrink-0 text-xs text-slate-400">{it.qty} шт</span>
                        <span className="w-24 shrink-0 text-right font-medium tabular-nums text-emerald-300">{fmt(it.revenue)} ₸</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* По часам */}
              <div className={`${card} p-4`}>
                <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                  <Clock className="h-4 w-4 text-sky-300" /> Продажи по часам
                </div>
                {activeHours.length === 0 ? (
                  <div className="py-6 text-center text-sm text-slate-400">Нет данных</div>
                ) : (
                  <div className="flex h-32 items-end gap-1">
                    {activeHours.map((h) => {
                      const pct = Math.max(4, (h.amount / maxHour) * 100)
                      const peak = h.amount === maxHour
                      return (
                        <div key={h.hour} className="flex min-w-0 flex-1 flex-col items-center gap-1" title={`${pad2(h.hour)}:00 — ${fmt(h.amount)} ₸ · ${h.count} продаж`}>
                          <div className="flex w-full justify-center" style={{ height: 100 }}>
                            <div className="flex w-full flex-col justify-end">
                              <div className={`w-full rounded-t transition-all ${peak ? 'bg-sky-400' : 'bg-sky-400/40'}`} style={{ height: `${pct}%` }} />
                            </div>
                          </div>
                          <div className="text-[10px] text-slate-500">{pad2(h.hour)}</div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Оплаты */}
              <div className={`${card} p-4`}>
                <div className="mb-3 text-sm font-semibold text-white">Способы оплаты</div>
                <div className="space-y-2">
                  <PayBar label="Наличные" amount={data.payment.cash} total={t!.amount} color="bg-emerald-500" />
                  <PayBar label="Безнал" amount={data.payment.kaspi} total={t!.amount} color="bg-amber-500" />
                  <PayBar label="Карта" amount={data.payment.card} total={t!.amount} color="bg-sky-500" />
                  <PayBar label="Онлайн" amount={data.payment.online} total={t!.amount} color="bg-violet-500" />
                </div>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}

function Kpi({ label, value, sub, icon, accent, big }: { label: string; value: string; sub?: string; icon: React.ReactNode; accent: string; big?: boolean }) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-center justify-between text-xs uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        <span className="text-slate-400">{icon}</span>
      </div>
      <div className={`mt-1.5 font-bold tabular-nums ${accent} ${big ? 'text-2xl' : 'text-xl'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-slate-500">{sub}</div>}
    </div>
  )
}

function PayBar({ label, amount, total, color }: { label: string; amount: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((amount / total) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <div className="w-16 shrink-0 text-xs text-slate-400">{label}</div>
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="w-24 shrink-0 text-right text-sm font-medium tabular-nums text-white">{fmt(amount)} ₸</div>
      <div className="w-8 shrink-0 text-right text-xs text-slate-500">{pct}%</div>
    </div>
  )
}
