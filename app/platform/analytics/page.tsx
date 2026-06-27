'use client'

import { useEffect, useState } from 'react'
import { Building2, CreditCard, Loader2, TrendingUp, Wallet } from 'lucide-react'

type Data = {
  totals: { organizations: number; activeSubscriptions: number; mrr: number; paidInvoicesTotal: number }
  statusBreakdown: Record<string, number>
  months: string[]
  newOrgsByMonth: Record<string, number>
  revenueByMonth: Record<string, number>
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Активные', trial: 'Триал', trialing: 'Триал', suspended: 'Заморожены', archived: 'Архив',
}
const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0))
const monthLabel = (m: string) => {
  const [, mm] = m.split('-')
  return ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'][Number(mm) - 1] || m
}

function Bars({ months, values, color }: { months: string[]; values: Record<string, number>; color: string }) {
  const max = Math.max(1, ...months.map((m) => values[m] || 0))
  return (
    <div className="flex items-end gap-2" style={{ height: 120 }}>
      {months.map((m) => {
        const v = values[m] || 0
        return (
          <div key={m} className="flex flex-1 flex-col items-center justify-end gap-1">
            <span className="text-[10px] tabular-nums text-slate-400">{v ? fmt(v) : ''}</span>
            <div className={`w-full rounded-t ${color}`} style={{ height: `${(v / max) * 90 + 2}px` }} />
            <span className="text-[10px] text-slate-500">{monthLabel(m)}</span>
          </div>
        )
      })}
    </div>
  )
}

function Kpi({
  label,
  value,
  tone = 'slate',
  icon,
}: {
  label: string
  value: string | number
  tone?: 'slate' | 'emerald' | 'violet'
  icon?: React.ReactNode
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-900 dark:text-white',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    violet: 'text-violet-600 dark:text-violet-400',
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
  )
}

export default function PlatformAnalyticsPage() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/platform/analytics', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setData(j.data || null))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
  }
  if (!data) return <div className="mx-auto max-w-6xl p-6 text-sm text-slate-500">Нет данных.</div>

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Аналитика платформы</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Рост клиентов и деньги в динамике по месяцам.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Доход в месяц (MRR)" value={`${fmt(data.totals.mrr)} ₸`} tone="emerald" icon={<Wallet className="h-3.5 w-3.5" />} />
        <Kpi label="Активных подписок" value={data.totals.activeSubscriptions} tone="violet" icon={<CreditCard className="h-3.5 w-3.5" />} />
        <Kpi label="Организаций" value={data.totals.organizations} icon={<Building2 className="h-3.5 w-3.5" />} />
        <Kpi label="Оплачено всего" value={`${fmt(data.totals.paidInvoicesTotal)} ₸`} tone="emerald" icon={<TrendingUp className="h-3.5 w-3.5" />} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
          <h2 className="mb-4 text-sm font-semibold">Новые организации по месяцам</h2>
          <Bars months={data.months} values={data.newOrgsByMonth} color="bg-violet-500/60" />
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
          <h2 className="mb-4 text-sm font-semibold">Выручка (оплачено) по месяцам, ₸</h2>
          <Bars months={data.months} values={data.revenueByMonth} color="bg-emerald-500/60" />
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
        <h2 className="mb-3 text-sm font-semibold">Организации по статусу</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.statusBreakdown).map(([k, v]) => (
            <span key={k} className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-sm dark:bg-white/5">
              <span className="text-slate-500 dark:text-slate-400">{STATUS_LABELS[k] || k}</span>
              <b className="tabular-nums">{v}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
