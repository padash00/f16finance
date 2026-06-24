'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Package, Sparkles, CreditCard, Lock } from 'lucide-react'

const RESERVED_SLUGS = ['www', 'admin', 'api', 'app', 'status', 'mail', 'blog', 'docs', 'support']
const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0))

export default function PlatformSettingsPage() {
  const [plans, setPlans] = useState<any[]>([])
  const [packages, setPackages] = useState<any[]>([])
  const [addons, setAddons] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/organizations', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        setPlans(j.plans || [])
        setPackages(j.packages || [])
        setAddons(j.addons || [])
      })
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return <div className="flex h-full items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-violet-400" /></div>
  }

  return (
    <div className="p-6 text-slate-900 dark:text-white">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Настройки платформы</h1>
        <Link href="/platform/billing" className="inline-flex items-center gap-1.5 rounded-lg border border-violet-500/30 px-3 py-1.5 text-sm text-violet-600 dark:text-violet-300 hover:bg-violet-500/10">
          <CreditCard className="h-4 w-4" /> Редактировать тарифы
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><CreditCard className="h-4 w-4 text-violet-400" /> Тарифы ({plans.length})</h2>
          <div className="space-y-1.5">
            {plans.map((p) => (
              <div key={p.code || p.id} className="flex justify-between text-sm">
                <span>{p.name || p.code}</span>
                <span className="text-slate-400">{fmt(p.priceMonthly || p.price_monthly || 0)} ₸</span>
              </div>
            ))}
            {plans.length === 0 && <p className="text-sm text-slate-500">Нет тарифов.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Package className="h-4 w-4 text-violet-400" /> Пакеты ({packages.length})</h2>
          <div className="space-y-1.5">
            {packages.map((p) => (
              <div key={p.code} className="flex justify-between text-sm">
                <span>{p.name || p.code}</span>
                <span className="text-slate-400">{fmt(p.priceKzt || p.price_kzt || 0)} ₸</span>
              </div>
            ))}
            {packages.length === 0 && <p className="text-sm text-slate-500">Нет пакетов.</p>}
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-violet-400" /> Модули ({addons.length})</h2>
          <div className="space-y-1.5">
            {addons.map((a) => (
              <div key={a.code} className="flex justify-between text-sm">
                <span>{a.name || a.code}</span>
                <span className="text-slate-400">{fmt(a.priceKzt || a.price_kzt || 0)} ₸</span>
              </div>
            ))}
            {addons.length === 0 && <p className="text-sm text-slate-500">Нет модулей.</p>}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Lock className="h-4 w-4 text-slate-500 dark:text-slate-400" /> Зарезервированные поддомены</h2>
        <p className="mb-2 text-xs text-slate-500">Эти слаги нельзя выдать клиенту (системные поддомены).</p>
        <div className="flex flex-wrap gap-1.5">
          {RESERVED_SLUGS.map((s) => (
            <span key={s} className="rounded-md border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/[0.02] px-2 py-0.5 text-xs text-slate-700 dark:text-slate-300">{s}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
