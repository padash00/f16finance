'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Building2, Loader2, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

type OrgRow = {
  id: string
  name: string
  slug: string
  status: string
  primaryDomain: string
  appUrl: string
  companyCount: number
  memberCount: number
  createdAt: string | null
  subscription: {
    status: string
    startsAt: string | null
    endsAt: string | null
    plan: { name: string; code: string } | null
  } | null
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
    suspended: 'Заморожена',
    canceled: 'Отменена',
  }
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${map[status] || 'bg-slate-500/15 text-slate-400'}`}>
      {labels[status] || status}
    </span>
  )
}

export default function OrganizationsPage() {
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetch('/api/admin/organizations')
      .then(r => r.json())
      .then(data => setOrgs(data.organizations || []))
      .finally(() => setLoading(false))
  }, [])

  const filtered = orgs.filter(o =>
    !search || o.name.toLowerCase().includes(search.toLowerCase()) || o.slug.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-6 text-white">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Организации</h1>
          <p className="mt-1 text-sm text-slate-400">{orgs.length} организаций на платформе</p>
        </div>
        <Link
          href="/platform/new"
          className="rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
        >
          + Создать
        </Link>
      </div>

      <div className="mb-4 relative max-w-xs">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Поиск по названию..."
          className="border-white/10 bg-slate-900/60 pl-9 text-white placeholder:text-slate-600"
        />
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/[0.06] bg-white/[0.02]">
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Организация</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Домен</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Подписка</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Тариф</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-slate-400">Точки</th>
                <th className="px-3 py-3 text-center text-xs font-medium text-slate-400">Люди</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-slate-400">Создана</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.04]">
              {filtered.map(org => (
                <tr key={org.id} className="hover:bg-white/[0.02]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/20 text-xs font-bold text-violet-300">
                        {org.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium text-white">{org.name}</p>
                        <p className="text-xs text-slate-500">{org.slug}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-400">{org.primaryDomain || `${org.slug}.ordaops.kz`}</td>
                  <td className="px-4 py-3">{statusBadge(org.subscription?.status || org.status)}</td>
                  <td className="px-4 py-3 text-slate-300">{org.subscription?.plan?.name || '—'}</td>
                  <td className="px-3 py-3 text-center text-slate-300">{org.companyCount}</td>
                  <td className="px-3 py-3 text-center text-slate-300">{org.memberCount}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    {org.createdAt ? new Date(org.createdAt).toLocaleDateString('ru-RU') : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`/platform/organizations/${org.id}`} className="text-xs text-violet-400 hover:text-violet-300">
                      Управлять →
                    </Link>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-sm text-slate-500">
                    {search ? 'Ничего не найдено' : 'Нет организаций'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
