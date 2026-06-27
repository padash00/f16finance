'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CreditCard,
  FileText,
  Loader2,
  PlusCircle,
  Wallet,
} from 'lucide-react'

type Overview = {
  organizationCount: number
  activeOrganizationCount: number
  activeSubscriptions: number
  trialingSubscriptions: number
  pastDueSubscriptions: number
  totalCompanies: number
  totalMembers: number
  liveMrr: number
  trialMrr: number
  overdueInvoices: number
  overdueInvoicesSum: number
  paidThisMonth: number
  trialsEndingSoon: number
}

type AttentionItem = { id: string; name: string; slug: string; reasons: string[] }

type OrgRow = {
  id: string
  name: string
  slug: string
  status: string
  companyCount: number
  memberCount: number
  subscription: { status: string; plan: { name: string } | null } | null
  createdAt: string | null
}

const money = (n: number | undefined | null) =>
  n ? `${Math.round(n).toLocaleString('ru-RU')} ₸` : '0 ₸'

const STATUS_META: Record<string, { label: string; dot: string; chip: string }> = {
  active: { label: 'Активна', dot: 'bg-emerald-500', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  trialing: { label: 'Пробный', dot: 'bg-violet-500', chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  past_due: { label: 'Просрочена', dot: 'bg-rose-500', chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  suspended: { label: 'Приостановлена', dot: 'bg-slate-400', chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' },
  canceled: { label: 'Отменена', dot: 'bg-slate-400', chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' },
}

function statusChip(status: string) {
  const m = STATUS_META[status] || { label: status, chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.chip}`}>{m.label}</span>
}

/** Большая KPI-плашка с пояснением — что это значит человеческим языком. */
function Kpi({
  label,
  value,
  hint,
  tone = 'slate',
  icon,
}: {
  label: string
  value: string | number
  hint?: string
  tone?: 'slate' | 'emerald' | 'violet' | 'rose' | 'amber'
  icon?: React.ReactNode
}) {
  const tones: Record<string, string> = {
    slate: 'text-slate-900 dark:text-white',
    emerald: 'text-emerald-600 dark:text-emerald-400',
    violet: 'text-violet-600 dark:text-violet-400',
    rose: 'text-rose-600 dark:text-rose-400',
    amber: 'text-amber-600 dark:text-amber-400',
  }
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-3xl font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  )
}

export default function PlatformOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [attention, setAttention] = useState<AttentionItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/organizations')
      .then((r) => r.json())
      .then((data) => {
        setOverview(data.overview || null)
        setOrgs(Array.isArray(data.organizations) ? data.organizations : [])
        setAttention(Array.isArray(data.attention) ? data.attention : [])
      })
      .finally(() => setLoading(false))
  }, [])

  // Разбивка клиентов по статусу подписки (для наглядной полосы).
  const statusBreakdown = useMemo(() => {
    const counts = { active: 0, trialing: 0, past_due: 0, other: 0 }
    for (const o of orgs) {
      const s = o.subscription?.status || o.status
      if (s === 'active') counts.active++
      else if (s === 'trialing') counts.trialing++
      else if (s === 'past_due') counts.past_due++
      else counts.other++
    }
    return counts
  }, [orgs])

  const total = orgs.length || 1

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    )
  }

  const empty = (overview?.organizationCount ?? 0) === 0

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      {/* Шапка */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Диспетчерская Orda</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Все клиенты, деньги и что требует внимания — на одном экране.
          </p>
        </div>
        <Link
          href="/platform/new"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700"
        >
          <PlusCircle className="h-4 w-4" /> Новый клиент
        </Link>
      </div>

      {empty ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center dark:border-white/15 dark:bg-white/[0.02]">
          <Building2 className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-lg font-medium">Клиентов пока нет</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Здесь появятся клубы, которым ты продал Orda: их оплаты, тарифы и состояние.
          </p>
          <Link
            href="/platform/new"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            <PlusCircle className="h-4 w-4" /> Завести первого клиента
          </Link>
        </div>
      ) : (
        <>
          {/* 4 главные цифры */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi
              label="Клиентов"
              value={overview?.organizationCount ?? 0}
              hint={`${overview?.activeOrganizationCount ?? 0} активных`}
              tone="violet"
              icon={<Building2 className="h-3.5 w-3.5" />}
            />
            <Kpi
              label="Платят (подписки)"
              value={overview?.activeSubscriptions ?? 0}
              hint={`${overview?.trialingSubscriptions ?? 0} на пробном`}
              tone="emerald"
              icon={<CreditCard className="h-3.5 w-3.5" />}
            />
            <Kpi
              label="Доход в месяц"
              value={money(overview?.liveMrr)}
              hint="С платящих клиентов (MRR)"
              tone="emerald"
              icon={<Wallet className="h-3.5 w-3.5" />}
            />
            <Kpi
              label="Долг по счетам"
              value={money(overview?.overdueInvoicesSum)}
              hint={`${overview?.overdueInvoices ?? 0} просроченных счетов`}
              tone={overview?.overdueInvoices ? 'rose' : 'slate'}
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
            />
          </div>

          {/* Деньги этого месяца + клиенты по статусу */}
          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.2fr]">
            {/* Деньги */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <h2 className="text-sm font-semibold">Деньги в этом месяце</h2>
              <div className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Оплачено</span>
                  <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{money(overview?.paidThisMonth)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Потенциал с пробных</span>
                  <span className="font-medium tabular-nums">{money(overview?.trialMrr)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500 dark:text-slate-400">Просрочено</span>
                  <span className="font-medium tabular-nums text-rose-600 dark:text-rose-400">{money(overview?.overdueInvoicesSum)}</span>
                </div>
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 dark:border-white/5">
                  <span className="text-slate-500 dark:text-slate-400">Пробные истекают (≤7 дней)</span>
                  <span className={`font-medium tabular-nums ${overview?.trialsEndingSoon ? 'text-amber-600 dark:text-amber-400' : ''}`}>{overview?.trialsEndingSoon ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Клиенты по статусу */}
            <div className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Клиенты по статусу</h2>
                <span className="text-xs text-slate-400">{overview?.totalCompanies ?? 0} точек · {overview?.totalMembers ?? 0} человек</span>
              </div>
              {/* Полоса-разбивка */}
              <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/5">
                <div className="bg-emerald-500" style={{ width: `${(statusBreakdown.active / total) * 100}%` }} />
                <div className="bg-violet-500" style={{ width: `${(statusBreakdown.trialing / total) * 100}%` }} />
                <div className="bg-rose-500" style={{ width: `${(statusBreakdown.past_due / total) * 100}%` }} />
                <div className="bg-slate-300 dark:bg-slate-600" style={{ width: `${(statusBreakdown.other / total) * 100}%` }} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {[
                  ['active', statusBreakdown.active],
                  ['trialing', statusBreakdown.trialing],
                  ['past_due', statusBreakdown.past_due],
                  ['other', statusBreakdown.other],
                ].map(([key, count]) => {
                  const m = STATUS_META[key as string]
                  return (
                    <div key={key as string} className="flex items-center justify-between">
                      <span className="flex items-center gap-2 text-slate-500 dark:text-slate-400">
                        <span className={`h-2 w-2 rounded-full ${m?.dot || 'bg-slate-400'}`} />
                        {m?.label || 'Другое'}
                      </span>
                      <span className="font-medium tabular-nums">{count as number}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Требуют внимания */}
          {attention.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/[0.05] p-5">
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4" /> Требуют внимания ({attention.length})
              </h2>
              <div className="space-y-1.5">
                {attention.map((a) => (
                  <Link
                    key={a.id}
                    href={`/platform/organizations/${a.id}`}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm transition hover:border-amber-400/40 dark:border-white/5 dark:bg-white/[0.02]"
                  >
                    <span className="font-medium">{a.name}</span>
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      {a.reasons.map((r) => (
                        <span key={r} className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[11px] text-amber-700 dark:text-amber-300">{r}</span>
                      ))}
                      <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Список клиентов */}
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Клиенты</h2>
              <Link href="/platform/organizations" className="text-xs text-violet-500 hover:text-violet-600 dark:hover:text-violet-300">
                Открыть полный список →
              </Link>
            </div>
            <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                    <th className="px-4 py-2.5 text-left font-medium">Клиент</th>
                    <th className="px-4 py-2.5 text-left font-medium">Статус</th>
                    <th className="px-4 py-2.5 text-left font-medium">Тариф</th>
                    <th className="px-3 py-2.5 text-center font-medium">Точки</th>
                    <th className="px-3 py-2.5 text-center font-medium">Люди</th>
                    <th className="px-4 py-2.5 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  {orgs.slice(0, 10).map((org) => (
                    <tr key={org.id} className="bg-white hover:bg-slate-50 dark:bg-transparent dark:hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-xs font-bold text-violet-700 dark:text-violet-300">
                            {org.name.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium">{org.name}</p>
                            <p className="text-xs text-slate-400">{org.slug}.ordaops.kz</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">{statusChip(org.subscription?.status || org.status)}</td>
                      <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{org.subscription?.plan?.name || '—'}</td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-300">{org.companyCount}</td>
                      <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-300">{org.memberCount}</td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/platform/organizations/${org.id}`} className="text-xs font-medium text-violet-500 hover:text-violet-600 dark:hover:text-violet-300">
                          Открыть →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Быстрые действия */}
          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link href="/platform/invoices" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-violet-400/40 dark:border-white/10 dark:bg-slate-900/40">
              <FileText className="h-5 w-5 text-violet-500" />
              <div>
                <p className="text-sm font-medium">Счета</p>
                <p className="text-xs text-slate-400">Выставить и отметить оплату</p>
              </div>
            </Link>
            <Link href="/platform/billing" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-violet-400/40 dark:border-white/10 dark:bg-slate-900/40">
              <CreditCard className="h-5 w-5 text-amber-500" />
              <div>
                <p className="text-sm font-medium">Тарифы и модули</p>
                <p className="text-xs text-slate-400">Что входит и сколько стоит</p>
              </div>
            </Link>
            <Link href="/platform/organizations" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-violet-400/40 dark:border-white/10 dark:bg-slate-900/40">
              <Building2 className="h-5 w-5 text-emerald-500" />
              <div>
                <p className="text-sm font-medium">Все клиенты</p>
                <p className="text-xs text-slate-400">Список и настройка</p>
              </div>
            </Link>
          </div>
        </>
      )}
    </div>
  )
}
