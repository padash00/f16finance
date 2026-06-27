'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Building2, Loader2, LogIn, PlusCircle, Search } from 'lucide-react'
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

const STATUS_META: Record<string, { label: string; chip: string }> = {
  active: { label: 'Активна', chip: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  trialing: { label: 'Пробный', chip: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
  past_due: { label: 'Просрочена', chip: 'bg-rose-500/15 text-rose-700 dark:text-rose-300' },
  suspended: { label: 'Заморожена', chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' },
  canceled: { label: 'Отменена', chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' },
}

function statusChip(status: string) {
  const m = STATUS_META[status] || { label: status, chip: 'bg-slate-500/15 text-slate-500 dark:text-slate-400' }
  return <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.chip}`}>{m.label}</span>
}

export default function OrganizationsPage() {
  const router = useRouter()
  const [orgs, setOrgs] = useState<OrgRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [enteringId, setEnteringId] = useState<string | null>(null)

  const handleEnter = async (organizationId: string) => {
    setEnteringId(organizationId)
    try {
      const res = await fetch('/api/auth/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })
      if (!res.ok) throw new Error()
      router.push('/dashboard')
      router.refresh()
    } catch {
      setEnteringId(null)
    }
  }

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
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      {/* Шапка */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Клиенты</h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Все клубы на Orda — статус, тариф, точки и люди.
          </p>
        </div>
        <Link
          href="/platform/new"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-700"
        >
          <PlusCircle className="h-4 w-4" /> Новый клиент
        </Link>
      </div>

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
        </div>
      ) : orgs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-10 text-center dark:border-white/15 dark:bg-white/[0.02]">
          <Building2 className="mx-auto h-10 w-10 text-slate-300 dark:text-slate-600" />
          <p className="mt-3 text-lg font-medium">Клиентов пока нет</p>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Заведи первого клиента — клуб, которому ты продал Orda.
          </p>
          <Link
            href="/platform/new"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-700"
          >
            <PlusCircle className="h-4 w-4" /> Завести клиента
          </Link>
        </div>
      ) : (
        <>
          {/* Поиск */}
          <div className="mb-4 relative max-w-xs">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Поиск по названию..."
              className="border-slate-200 bg-white pl-9 text-slate-900 placeholder:text-slate-400 dark:border-white/10 dark:bg-slate-900/60 dark:text-white dark:placeholder:text-slate-600"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-slate-200 dark:border-white/10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 dark:border-white/[0.06] dark:bg-white/[0.02] dark:text-slate-400">
                  <th className="px-4 py-2.5 text-left font-medium">Клиент</th>
                  <th className="px-4 py-2.5 text-left font-medium">Домен</th>
                  <th className="px-4 py-2.5 text-left font-medium">Статус</th>
                  <th className="px-4 py-2.5 text-left font-medium">Тариф</th>
                  <th className="px-3 py-2.5 text-center font-medium">Точки</th>
                  <th className="px-3 py-2.5 text-center font-medium">Люди</th>
                  <th className="px-4 py-2.5 text-left font-medium">Заведён</th>
                  <th className="px-4 py-2.5 text-right font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                {filtered.map(org => (
                  <tr key={org.id} className="bg-white hover:bg-slate-50 dark:bg-transparent dark:hover:bg-white/[0.02]">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-xs font-bold text-violet-700 dark:text-violet-300">
                          {org.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium">{org.name}</p>
                          <p className="text-xs text-slate-400">{org.slug}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-400">{org.primaryDomain || `${org.slug}.ordaops.kz`}</td>
                    <td className="px-4 py-3">{statusChip(org.subscription?.status || org.status)}</td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{org.subscription?.plan?.name || '—'}</td>
                    <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-300">{org.companyCount}</td>
                    <td className="px-3 py-3 text-center tabular-nums text-slate-600 dark:text-slate-300">{org.memberCount}</td>
                    <td className="px-4 py-3 text-xs text-slate-500 tabular-nums">
                      {org.createdAt ? new Date(org.createdAt).toLocaleDateString('ru-RU') : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-3">
                        <button
                          onClick={() => handleEnter(org.id)}
                          disabled={enteringId === org.id}
                          className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 transition hover:text-emerald-700 disabled:opacity-50 dark:text-emerald-400 dark:hover:text-emerald-300"
                        >
                          {enteringId === org.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <LogIn className="h-3 w-3" />}
                          Войти
                        </button>
                        <Link href={`/platform/organizations/${org.id}`} className="text-xs font-medium text-violet-500 hover:text-violet-600 dark:hover:text-violet-300">
                          Открыть →
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="bg-white px-4 py-10 text-center text-sm text-slate-500 dark:bg-transparent">
                      Ничего не найдено
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
