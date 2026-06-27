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
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      {/* Шапка */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Настройки платформы</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Тарифы, пакеты, модули и системные поддомены.
          </p>
        </div>
        <Link
          href="/platform/billing"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700"
        >
          <CreditCard className="h-4 w-4" /> Редактировать тарифы
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Тарифы */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CreditCard className="h-4 w-4 text-violet-500" /> Тарифы ({plans.length})
          </h2>
          <div className="mt-4 space-y-2 text-sm">
            {plans.map((p) => (
              <div key={p.code || p.id} className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">{p.name || p.code}</span>
                <span className="font-medium tabular-nums text-slate-500 dark:text-slate-400">{fmt(p.priceMonthly || p.price_monthly || 0)} ₸</span>
              </div>
            ))}
            {plans.length === 0 && <p className="text-slate-500">Тарифов пока нет.</p>}
          </div>
        </div>

        {/* Пакеты */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Package className="h-4 w-4 text-violet-500" /> Пакеты ({packages.length})
          </h2>
          <div className="mt-4 space-y-2 text-sm">
            {packages.map((p) => (
              <div key={p.code} className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">{p.name || p.code}</span>
                <span className="font-medium tabular-nums text-slate-500 dark:text-slate-400">{fmt(p.priceKzt || p.price_kzt || 0)} ₸</span>
              </div>
            ))}
            {packages.length === 0 && <p className="text-slate-500">Пакетов пока нет.</p>}
          </div>
        </div>

        {/* Модули */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-violet-500" /> Модули ({addons.length})
          </h2>
          <div className="mt-4 space-y-2 text-sm">
            {addons.map((a) => (
              <div key={a.code} className="flex items-center justify-between">
                <span className="text-slate-600 dark:text-slate-300">{a.name || a.code}</span>
                <span className="font-medium tabular-nums text-slate-500 dark:text-slate-400">{fmt(a.priceKzt || a.price_kzt || 0)} ₸</span>
              </div>
            ))}
            {addons.length === 0 && <p className="text-slate-500">Модулей пока нет.</p>}
          </div>
        </div>
      </div>

      {/* Зарезервированные поддомены */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4 text-slate-500 dark:text-slate-400" /> Зарезервированные поддомены
        </h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Эти адреса нельзя выдать клиенту — они системные.</p>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {RESERVED_SLUGS.map((s) => (
            <span key={s} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-700 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-300">{s}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
