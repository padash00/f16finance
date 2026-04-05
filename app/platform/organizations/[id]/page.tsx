'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Loader2,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type OrgDetail = {
  id: string
  name: string
  slug: string
  status: string
  primaryDomain: string
  appUrl: string
  legalName: string | null
  companyCount: number
  memberCount: number
  branding: { productName: string; primaryColor: string; logoUrl: string }
  settings: { timezone: string; currency: string; supportEmail: string; supportPhone: string }
  companies: Array<{ id: string; name: string; code: string | null }>
  subscription: {
    id: string
    status: string
    billingPeriod: string
    startsAt: string | null
    endsAt: string | null
    plan: { id: string; name: string; code: string } | null
  } | null
}

const SUB_STATUS_LABELS: Record<string, string> = {
  active: 'Активна', trialing: 'Пробный', past_due: 'Просрочена', canceled: 'Отменена', suspended: 'Заморожена',
}
const SUB_STATUS_COLORS: Record<string, string> = {
  active: 'text-emerald-300', trialing: 'text-violet-300', past_due: 'text-red-300', canceled: 'text-slate-400', suspended: 'text-slate-400',
}

const ORG_STATUSES = ['active', 'suspended']
const ORG_STATUS_LABELS: Record<string, string> = { active: 'Активна', suspended: 'Заморожена' }

export default function OrgDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [org, setOrg] = useState<OrgDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // editable fields
  const [name, setName] = useState('')
  const [orgStatus, setOrgStatus] = useState('active')
  const [subStatus, setSubStatus] = useState('')
  const [subAction, setSubAction] = useState('')

  useEffect(() => {
    fetch('/api/admin/organizations')
      .then(r => r.json())
      .then(data => {
        const found = (data.organizations || []).find((o: any) => o.id === id) as OrgDetail | undefined
        if (found) {
          setOrg(found)
          setName(found.name)
          setOrgStatus(found.status)
          setSubStatus(found.subscription?.status || '')
        }
      })
      .finally(() => setLoading(false))
  }, [id])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: id,
          name: name.trim(),
          organizationStatus: orgStatus,
          subscriptionStatus: subStatus || undefined,
          subscriptionAction: subAction || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
      setOrg(prev => prev ? { ...prev, name: name.trim(), status: orgStatus } : prev)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-violet-400" />
      </div>
    )
  }

  if (!org) {
    return (
      <div className="p-6 text-slate-400">Организация не найдена.</div>
    )
  }

  return (
    <div className="p-6 text-white">
      <div className="mb-6 flex items-center gap-3">
        <button onClick={() => router.push('/platform/organizations')} className="text-slate-400 hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 text-sm font-bold text-violet-300">
            {org.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">{org.name}</h1>
            <a href={org.appUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-300">
              {org.primaryDomain} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Basic info */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Основная информация</h2>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Название</label>
              <Input value={name} onChange={e => setName(e.target.value)} className="border-white/10 bg-slate-900/60 text-white" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Поддомен</label>
              <p className="rounded-lg border border-white/10 bg-slate-900/30 px-3 py-2 text-sm text-slate-300">{org.primaryDomain}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-400">Статус организации</label>
              <select
                value={orgStatus}
                onChange={e => setOrgStatus(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
              >
                {ORG_STATUSES.map(s => <option key={s} value={s}>{ORG_STATUS_LABELS[s] || s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* Subscription */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-4 text-sm font-semibold text-white">Подписка</h2>
          {org.subscription ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-slate-500">Тариф</p>
                  <p className="font-medium text-white">{org.subscription.plan?.name || '—'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500">Статус</p>
                  <p className={`font-medium ${SUB_STATUS_COLORS[org.subscription.status] || 'text-slate-300'}`}>
                    {SUB_STATUS_LABELS[org.subscription.status] || org.subscription.status}
                  </p>
                </div>
                {org.subscription.startsAt && (
                  <div>
                    <p className="text-xs text-slate-500">Начало</p>
                    <p className="text-slate-300">{new Date(org.subscription.startsAt).toLocaleDateString('ru-RU')}</p>
                  </div>
                )}
                {org.subscription.endsAt && (
                  <div>
                    <p className="text-xs text-slate-500">Окончание</p>
                    <p className="text-slate-300">{new Date(org.subscription.endsAt).toLocaleDateString('ru-RU')}</p>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Действие над подпиской</label>
                <select
                  value={subAction}
                  onChange={e => setSubAction(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-sm text-white"
                >
                  <option value="">— без изменений —</option>
                  <option value="activate">Активировать</option>
                  <option value="startTrial">Запустить триал</option>
                  <option value="recordPayment">Записать оплату</option>
                  <option value="markPastDue">Отметить просрочку</option>
                  <option value="cancelNow">Отменить</option>
                  <option value="resume">Возобновить</option>
                  <option value="renewCycle">Обновить цикл</option>
                </select>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Подписки нет.</p>
          )}
        </div>

        {/* Companies */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Building2 className="h-4 w-4 text-violet-400" />
            Точки ({org.companies.length})
          </h2>
          <div className="space-y-1.5">
            {org.companies.map(c => (
              <div key={c.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-sm">
                <span className="text-slate-200">{c.name}</span>
                {c.code && <span className="text-xs text-slate-500">{c.code}</span>}
              </div>
            ))}
            {org.companies.length === 0 && <p className="text-xs text-slate-500">Точек нет</p>}
          </div>
        </div>

        {/* Stats */}
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
            <Users className="h-4 w-4 text-violet-400" />
            Статистика
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Точек', value: org.companyCount },
              { label: 'Участников', value: org.memberCount },
            ].map(item => (
              <div key={item.label} className="rounded-lg bg-white/[0.03] p-3">
                <p className="text-xs text-slate-500">{item.label}</p>
                <p className="mt-0.5 text-xl font-bold text-white">{item.value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="mt-5 flex items-center gap-3">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {saved && <p className="text-sm text-emerald-400">Сохранено</p>}
        <Button
          onClick={handleSave}
          disabled={saving}
          className="bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white hover:opacity-90"
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Сохранить
        </Button>
        <a
          href={org.appUrl}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-4 py-2 text-sm text-slate-300 transition hover:bg-white/[0.04] hover:text-white"
        >
          Открыть кабинет <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </div>
    </div>
  )
}
