'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'

type Plan = {
  id: string
  code: string
  name: string
  description: string | null
  status: string
  priceMonthly: number | null
  priceYearly: number | null
  currency: string
  limits: Record<string, unknown>
  features: Record<string, unknown>
}

const FEATURE_LABELS: Record<string, string> = {
  ai_reports: 'AI-отчёты',
  inventory: 'Инвентарь',
  web_pos: 'Web POS',
  telegram: 'Telegram-бот',
  custom_branding: 'Брендинг',
}

const LIMIT_LABELS: Record<string, string> = {
  companies: 'Точек',
  staff: 'Сотрудников',
  operators: 'Операторов',
  point_projects: 'Устройств',
}

export default function BillingPage() {
  const [plans, setPlans] = useState<Plan[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/organizations')
      .then(r => r.json())
      .then(data => setPlans(data.plans || []))
      .finally(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    )
  }

  return (
    <div className="p-6 text-white">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Тарифы</h1>
        <p className="mt-1 text-sm text-slate-400">Планы платформы, их лимиты и подключённые функции.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map(plan => (
          <div key={plan.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <p className="font-semibold text-white">{plan.name}</p>
                {plan.description && <p className="mt-0.5 text-xs text-slate-400">{plan.description}</p>}
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${plan.status === 'active' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-400'}`}>
                {plan.status === 'active' ? 'Активен' : plan.status}
              </span>
            </div>

            {/* Price */}
            <div className="mb-4 rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
              {plan.priceMonthly
                ? <p className="text-white">{plan.priceMonthly.toLocaleString('ru')} {plan.currency}/мес</p>
                : <p className="text-slate-400">Цена не задана</p>}
              {plan.priceYearly && (
                <p className="text-xs text-slate-500">{plan.priceYearly.toLocaleString('ru')} {plan.currency}/год</p>
              )}
            </div>

            {/* Limits */}
            <div className="mb-4 space-y-1.5">
              <p className="text-xs font-medium text-slate-500">Лимиты</p>
              {Object.entries(LIMIT_LABELS).map(([key, label]) => {
                const val = (plan.limits as any)?.[key]
                return (
                  <div key={key} className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">{label}</span>
                    <span className="text-white">{val === null || val === undefined ? '∞' : String(val)}</span>
                  </div>
                )
              })}
            </div>

            {/* Features */}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-slate-500">Функции</p>
              {Object.entries(FEATURE_LABELS).map(([key, label]) => {
                const enabled = !!(plan.features as any)?.[key]
                return (
                  <div key={key} className="flex items-center gap-2 text-sm">
                    {enabled
                      ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      : <XCircle className="h-3.5 w-3.5 text-slate-600" />}
                    <span className={enabled ? 'text-slate-200' : 'text-slate-500'}>{label}</span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}

        {plans.length === 0 && (
          <div className="col-span-3 py-10 text-center text-sm text-slate-500">
            Тарифы не настроены. Добавьте планы в таблицу <code className="text-slate-400">subscription_plans</code>.
          </div>
        )}
      </div>
    </div>
  )
}
