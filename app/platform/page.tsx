'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  PlusCircle,
  TrendingUp,
  Users,
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
}

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

function StatCard({ label, value, sub, color = 'violet' }: { label: string; value: string | number; sub?: string; color?: string }) {
  const colors: Record<string, string> = {
    violet: 'from-violet-500/10 border-violet-500/20 text-violet-300',
    emerald: 'from-emerald-500/10 border-emerald-500/20 text-emerald-300',
    amber: 'from-amber-500/10 border-amber-500/20 text-amber-300',
    red: 'from-red-500/10 border-red-500/20 text-red-300',
    blue: 'from-blue-500/10 border-blue-500/20 text-blue-300',
  }
  return (
    <div className={`rounded-xl border bg-gradient-to-br ${colors[color]} p-4`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      {sub && <p className="mt-0.5 text-xs opacity-60">{sub}</p>}
    </div>
  )
}

function statusBadge(status: string) {
  const map: Record<string, string> = {
    active: 'bg-emerald-500/15 text-emerald-300',
    trialing: 'bg-violet-500/15 text-violet-300',
    past_due: 'bg-red-500/15 text-red-300',
    suspended: 'bg-slate-500/15 text-slate-400',
    canceled: 'bg-slate-500/15 text-slate-400',
  }
  const labels: Record<string, string> = {
    active: 'Активна',
    trialing: 'Пробный',
    past_due: 'Просрочена',
    suspended: 'Приостановлена',
    canceled: 'Отменена',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] || 'bg-slate-500/15 text-slate-400'}`}>
      {labels[status] || status}
    </span>
  )
}

export default function PlatformOverviewPage() {
  const [overview, setOverview] = useState<Overview | null>(null)
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/organizations')
      .then(r => r.json())
      .then(data => {
        setOverview(data.overview || null)
        setOrgs((data.organizations || []).slice(0, 8))
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
    <div className="p-6 text-white">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">Обзор платформы</h1>
        <p className="mt-1 text-sm text-slate-400">Все организации, подписки и активность в одном месте.</p>
      </div>

      {/* Stats */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard label="Организаций" value={overview?.organizationCount ?? 0} color="violet" />
        <StatCard label="Активных" value={overview?.activeOrganizationCount ?? 0} color="emerald" />
        <StatCard label="Триал" value={overview?.trialingSubscriptions ?? 0} color="blue" />
        <StatCard label="Просрочено" value={overview?.pastDueSubscriptions ?? 0} color="red" />
        <StatCard label="Live MRR" value={overview?.liveMrr ? `${Math.round(overview.liveMrr).toLocaleString('ru')} ₸` : '—'} color="amber" />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Точек всего" value={overview?.totalCompanies ?? 0} color="violet" />
        <StatCard label="Участников" value={overview?.totalMembers ?? 0} color="violet" />
        <StatCard label="Активных подписок" value={overview?.activeSubscriptions ?? 0} color="emerald" />
        <StatCard label="Trial MRR" value={overview?.trialMrr ? `${Math.round(overview.trialMrr).toLocaleString('ru')} ₸` : '—'} color="blue" />
      </div>

      {/* Quick actions */}
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Link href="/platform/new" className="flex items-center gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 transition hover:bg-emerald-500/10">
          <PlusCircle className="h-5 w-5 text-emerald-400" />
          <div>
            <p className="text-sm font-medium text-white">Создать организацию</p>
            <p className="text-xs text-slate-400">Новый клиент на платформе</p>
          </div>
          <ArrowRight className="ml-auto h-4 w-4 text-slate-500" />
        </Link>
        <Link href="/platform/organizations" className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:bg-white/[0.04]">
          <Building2 className="h-5 w-5 text-violet-400" />
          <div>
            <p className="text-sm font-medium text-white">Все организации</p>
            <p className="text-xs text-slate-400">Управление и настройка</p>
          </div>
          <ArrowRight className="ml-auto h-4 w-4 text-slate-500" />
        </Link>
        <Link href="/platform/billing" className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-4 transition hover:bg-white/[0.04]">
          <CreditCard className="h-5 w-5 text-amber-400" />
          <div>
            <p className="text-sm font-medium text-white">Тарифы</p>
            <p className="text-xs text-slate-400">Планы, лимиты, фичи</p>
          </div>
          <ArrowRight className="ml-auto h-4 w-4 text-slate-500" />
        </Link>
      </div>

      {/* Recent orgs */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-white">Последние организации</h2>
          <Link href="/platform/organizations" className="text-xs text-violet-400 hover:text-violet-300">
            Все →
          </Link>
        </div>
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Организация</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Статус</th>
                <th className="px-4 py-2.5 text-left text-xs font-medium text-slate-400">Тариф</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-400">Точки</th>
                <th className="px-3 py-2.5 text-center text-xs font-medium text-slate-400">Люди</th>
                <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-400"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {orgs.map(org => (
                <tr key={org.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-xs font-bold text-violet-300">
                        {org.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-white">{org.name}</p>
                        <p className="text-xs text-slate-500">{org.slug}.ordaops.kz</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">{statusBadge(org.subscription?.status || org.status)}</td>
                  <td className="px-4 py-3 text-slate-300">{org.subscription?.plan?.name || '—'}</td>
                  <td className="px-3 py-3 text-center text-slate-300">{org.companyCount}</td>
                  <td className="px-3 py-3 text-center text-slate-300">{org.memberCount}</td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/platform/organizations/${org.id}`} className="text-xs text-violet-400 hover:text-violet-300">
                      Открыть →
                    </Link>
                  </td>
                </tr>
              ))}
              {orgs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    Организаций пока нет.{' '}
                    <Link href="/platform/new" className="text-violet-400 hover:text-violet-300">Создать первую →</Link>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
