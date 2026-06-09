'use client'

import { useEffect, useState } from 'react'
import { CreditCard, Loader2, Package, Sparkles } from 'lucide-react'
import { AdminPageHeader } from '@/components/admin/admin-page-header'

type Sub = {
  organization: { name: string; slug: string; status: string; primaryDomain: string } | null
  subscription: {
    status: string
    billingPeriod: string
    startsAt: string | null
    endsAt: string | null
    plan: { code: string; name: string; priceMonthly: number | null } | null
  } | null
  package: { code: string; name: string; priceKzt: number } | null
  addons: Array<{ code: string; name: string; priceKzt: number; billingUnit: string }>
  monthlyTotal: number
  invoices: Array<{
    id: string
    amount: number
    currency: string
    period_start: string | null
    period_end: string | null
    due_date: string | null
    status: string
    paid_at: string | null
    created_at: string
  }>
}

const SUB_STATUS_LABELS: Record<string, string> = {
  active: 'Активна', trialing: 'Пробный период', past_due: 'Просрочена', canceled: 'Отменена', expired: 'Истекла',
}
const INV_STATUS_LABELS: Record<string, string> = {
  issued: 'Выставлен', paid: 'Оплачен', void: 'Аннулирован', overdue: 'Просрочен', draft: 'Черновик',
}
const fmt = (n: number) => new Intl.NumberFormat('ru-RU').format(Math.round(n || 0))
const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleDateString('ru-RU') : '—')

export default function SubscriptionPage() {
  const [data, setData] = useState<Sub | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/my-subscription', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.error) throw new Error(j.error)
        setData(j?.data || null)
      })
      .catch((e) => setError(e?.message || 'Ошибка'))
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
    <div className="app-page-wide space-y-6 text-white">
      <AdminPageHeader
        title="Подписка"
        description="Ваш тариф, модули и счета."
        icon={<CreditCard className="h-5 w-5" />}
        accent="blue"
        backHref="/"
      />

      {error ? <p className="text-sm text-rose-400">{error}</p> : null}

      {!data ? (
        <p className="text-sm text-slate-500">Данные подписки недоступны.</p>
      ) : (
        <>
          {/* Текущий тариф */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Package className="h-4 w-4 text-violet-400" /> Тариф
            </h2>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <p className="text-xs text-slate-500">Пакет</p>
                <p className="font-medium">{data.package?.name || data.subscription?.plan?.name || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Статус</p>
                <p className="font-medium">{SUB_STATUS_LABELS[data.subscription?.status || ''] || data.subscription?.status || '—'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Действует до</p>
                <p className="font-medium">{fmtDate(data.subscription?.endsAt || null)}</p>
              </div>
            </div>
            <div className="mt-3 border-t border-white/5 pt-3 text-sm">
              <span className="text-slate-400">К оплате в месяц: </span>
              <b className="text-white">{fmt(data.monthlyTotal)} ₸</b>
            </div>
          </div>

          {/* Модули */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-violet-400" /> Подключённые модули
            </h2>
            {data.addons.length === 0 ? (
              <p className="text-sm text-slate-500">Дополнительные модули не подключены.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {data.addons.map((a) => (
                  <div key={a.code} className="flex items-center justify-between rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm">
                    <span>{a.name}</span>
                    <span className="text-slate-400">{fmt(a.priceKzt)} ₸</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Счета */}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="h-4 w-4 text-violet-400" /> Счета
            </h2>
            {data.invoices.length === 0 ? (
              <p className="text-sm text-slate-500">Счетов пока нет.</p>
            ) : (
              <div className="space-y-1.5">
                {data.invoices.map((inv) => (
                  <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm">
                    <div>
                      <p className={inv.status === 'void' ? 'text-slate-500 line-through' : ''}>
                        {fmt(inv.amount)} {inv.currency || '₸'} · {INV_STATUS_LABELS[inv.status] || inv.status}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {inv.due_date ? `до ${fmtDate(inv.due_date)}` : fmtDate(inv.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-slate-500">
              Чтобы сменить тариф, подключить модули или оплатить — свяжитесь с поддержкой.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
