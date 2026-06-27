'use client'

import { useEffect, useState } from 'react'
import { Loader2, TrendingUp, Users, Wallet } from 'lucide-react'

type Data = {
  totals: { organizations: number; activeSubscriptions: number; mrr: number; arpu: number; paidInvoicesTotal: number; churned: number }
  statusBreakdown: Record<string, number>
  months: string[]
  newOrgsByMonth: Record<string, number>
  cumulativeOrgsByMonth: Record<string, number>
  revenueByMonth: Record<string, number>
  topClients: Array<{ name: string; total: number }>
}

const money = (n: number) => `${Math.round(n || 0).toLocaleString('ru-RU')} ₸`
const monthLabel = (m: string) => {
  const names = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
  const [, mm] = m.split('-')
  return names[Number(mm) - 1] || m
}

const STATUS = {
  active: { label: 'Активные', color: 'bg-emerald-500' },
  trialing: { label: 'Пробные', color: 'bg-violet-500' },
  past_due: { label: 'Просрочены', color: 'bg-rose-500' },
  suspended: { label: 'Заморожены', color: 'bg-slate-400' },
  canceled: { label: 'Отменены', color: 'bg-slate-400' },
} as Record<string, { label: string; color: string }>

const card = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40'

/** Столбчатый график по месяцам. */
function BarChart({ months, values, format, color }: { months: string[]; values: Record<string, number>; format: (n: number) => string; color: string }) {
  const max = Math.max(1, ...months.map((m) => values[m] || 0))
  return (
    <div className="flex items-end justify-between gap-2" style={{ height: 140 }}>
      {months.map((m) => {
        const v = values[m] || 0
        const h = Math.round((v / max) * 100)
        return (
          <div key={m} className="flex flex-1 flex-col items-center justify-end gap-1.5">
            <span className="text-[10px] font-medium tabular-nums text-slate-500 dark:text-slate-400">{v ? format(v) : ''}</span>
            <div className={`w-full rounded-t-md ${color}`} style={{ height: `${Math.max(h, 2)}%`, minHeight: v ? 4 : 2 }} title={`${m}: ${format(v)}`} />
            <span className="text-[10px] text-slate-400">{monthLabel(m)}</span>
          </div>
        )
      })}
    </div>
  )
}

function Kpi({ label, value, hint, icon, tone = 'slate' }: { label: string; value: string | number; hint?: string; icon?: React.ReactNode; tone?: string }) {
  const tones: Record<string, string> = {
    slate: 'text-slate-900 dark:text-white',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    violet: 'text-violet-600 dark:text-violet-400',
  }
  return (
    <div className={card}>
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">{icon}{label}</div>
      <div className={`mt-2 text-2xl font-bold tabular-nums ${tones[tone] || tones.slate}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  )
}

export default function PlatformAnalyticsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/platform/analytics', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setData(j?.data || null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-6xl p-6">
        <div className={`${card} text-center text-sm text-slate-500`}>Нет данных для аналитики.</div>
      </div>
    )
  }

  const totalRevenueWindow = data.months.reduce((s, m) => s + (data.revenueByMonth[m] || 0), 0)

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Аналитика платформы</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Рост клиентов, доход и кто сколько приносит.</p>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Клиентов" value={data.totals.organizations} hint={`${data.totals.churned} ушли/заморожены`} icon={<Users className="h-3.5 w-3.5" />} tone="violet" />
        <Kpi label="Платящих подписок" value={data.totals.activeSubscriptions} icon={<TrendingUp className="h-3.5 w-3.5" />} tone="emerald" />
        <Kpi label="Доход в месяц (MRR)" value={money(data.totals.mrr)} icon={<Wallet className="h-3.5 w-3.5" />} tone="emerald" />
        <Kpi label="Средний чек" value={money(data.totals.arpu)} hint="MRR ÷ платящих" icon={<Wallet className="h-3.5 w-3.5" />} />
      </div>

      {/* Графики */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Доход по месяцам</h2>
            <span className="text-xs text-slate-400">за 6 мес: {money(totalRevenueWindow)}</span>
          </div>
          <BarChart months={data.months} values={data.revenueByMonth} format={(n) => `${Math.round(n / 1000)}k`} color="bg-emerald-500" />
        </div>
        <div className={card}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Рост клиентов</h2>
            <span className="text-xs text-slate-400">всего {data.totals.organizations}</span>
          </div>
          <BarChart months={data.months} values={data.cumulativeOrgsByMonth} format={(n) => String(n)} color="bg-violet-500" />
        </div>
      </div>

      {/* Статусы + топ-клиенты */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className={card}>
          <h2 className="mb-4 text-sm font-semibold">Клиенты по статусу</h2>
          <div className="space-y-2.5">
            {Object.entries(data.statusBreakdown).map(([k, v]) => {
              const meta = STATUS[k] || { label: k, color: 'bg-slate-400' }
              const pct = Math.round((v / Math.max(1, data.totals.organizations)) * 100)
              return (
                <div key={k}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                      <span className={`h-2 w-2 rounded-full ${meta.color}`} /> {meta.label}
                    </span>
                    <span className="font-medium tabular-nums">{v}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                    <div className={`h-full ${meta.color}`} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className={card}>
          <h2 className="mb-4 text-sm font-semibold">Кто больше платит (топ-8)</h2>
          {data.topClients.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Оплат пока нет.</p>
          ) : (
            <div className="space-y-2">
              {data.topClients.map((c, i) => {
                const max = Math.max(1, ...data.topClients.map((x) => x.total))
                return (
                  <div key={`${c.name}-${i}`} className="flex items-center gap-3">
                    <span className="w-4 text-xs text-slate-400">{i + 1}</span>
                    <span className="w-28 shrink-0 truncate text-sm">{c.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${(c.total / max) * 100}%` }} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums">{money(c.total)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
