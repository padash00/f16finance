'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'

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
            <span className="text-[10px] text-slate-400">{v ? fmt(v) : ''}</span>
            <div className={`w-full rounded-t ${color}`} style={{ height: `${(v / max) * 90 + 2}px` }} />
            <span className="text-[10px] text-slate-500">{monthLabel(m)}</span>
          </div>
        )
      })}
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
  if (!data) return <div className="p-6 text-sm text-slate-500">Нет данных.</div>

  return (
    <div className="p-6 text-slate-900 dark:text-white">
      <h1 className="mb-5 text-2xl font-semibold">Аналитика платформы</h1>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">MRR</p>
          <p className="mt-1 text-2xl font-bold">{fmt(data.totals.mrr)} ₸</p>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Активных подписок</p>
          <p className="mt-1 text-2xl font-bold">{data.totals.activeSubscriptions}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Организаций</p>
          <p className="mt-1 text-2xl font-bold">{data.totals.organizations}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] p-4">
          <p className="text-xs text-slate-500 dark:text-slate-400">Оплачено всего</p>
          <p className="mt-1 text-2xl font-bold">{fmt(data.totals.paidInvoicesTotal)} ₸</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] p-5">
          <h2 className="mb-4 text-sm font-semibold">Новые организации по месяцам</h2>
          <Bars months={data.months} values={data.newOrgsByMonth} color="bg-violet-500/60" />
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] p-5">
          <h2 className="mb-4 text-sm font-semibold">Выручка (оплачено) по месяцам, ₸</h2>
          <Bars months={data.months} values={data.revenueByMonth} color="bg-emerald-500/60" />
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] p-5">
        <h2 className="mb-3 text-sm font-semibold">Организации по статусу</h2>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.statusBreakdown).map(([k, v]) => (
            <span key={k} className="rounded-lg border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.02] px-3 py-1.5 text-sm">
              {STATUS_LABELS[k] || k}: <b>{v}</b>
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
