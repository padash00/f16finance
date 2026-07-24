'use client'

import { useEffect, useState } from 'react'
import { Loader2, Package, PlusCircle } from 'lucide-react'

export default function BillingPage() {
  const [packages, setPackages] = useState<any[]>([])
  const [addons, setAddons] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const load = () => {
    fetch('/api/admin/organizations')
      .then(r => r.json())
      .then(data => {
        setPackages(data.packages || [])
        setAddons(data.addons || [])
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Пакеты и модули</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Что и почём продаём клиентам. Доступ клиента определяет <b>пакет</b> (набор страниц);
          модули докупаются сверху. Собираются в «Конструкторе тарифов», назначаются в карточке организации.
        </p>
      </div>

      {/* ── Отраслевые пакеты ──────────────────────────────────────── */}
      <section className="mb-10">
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-300">
            <Package className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Отраслевые пакеты</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Готовые наборы под клиента. Назначаются в карточке организации («Пакет и модули»).
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p: any) => (
            <div key={p.code} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{p.name}</h3>
                {p.vertical && (
                  <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">{p.vertical}</span>
                )}
              </div>
              {p.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{p.description}</p>}
              <div className="mt-3 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {Number(p.price_kzt || 0).toLocaleString('ru-RU')} ₸
                <span className="text-xs font-normal text-slate-500">/мес</span>
              </div>
              {Array.isArray(p.feature_codes) && p.feature_codes.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Страниц в пакете: {p.feature_codes.length}</p>
                </div>
              )}
            </div>
          ))}
          {packages.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/[0.02]">
              Пакеты не настроены (таблица <code className="text-slate-500 dark:text-slate-400">packages</code>). Собери их в «Конструкторе тарифов».
            </div>
          )}
        </div>
      </section>

      {/* ── Дополнительные модули ──────────────────────────────────── */}
      <section>
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300">
            <PlusCircle className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold">Дополнительные модули (add-ons)</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">Докупаются к любому пакету сверху.</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {addons.map((a: any) => (
            <div key={a.code} className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-base font-semibold text-slate-900 dark:text-white">{a.name}</h3>
                {a.billing_unit && (
                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-500 dark:bg-white/5 dark:text-slate-400">{a.billing_unit}</span>
                )}
              </div>
              {a.description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{a.description}</p>}
              <div className="mt-3 text-lg font-bold tabular-nums text-slate-900 dark:text-white">
                {Number(a.price_kzt || 0).toLocaleString('ru-RU')} ₸
              </div>
              {Array.isArray(a.feature_codes) && a.feature_codes.length > 0 && (
                <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/[0.06]">
                  <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">Страниц: {a.feature_codes.length}</p>
                </div>
              )}
            </div>
          ))}
          {addons.length === 0 && (
            <div className="col-span-full rounded-2xl border border-dashed border-slate-300 bg-slate-50 py-8 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/[0.02]">
              Модули не настроены (таблица <code className="text-slate-500 dark:text-slate-400">addons</code>).
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
