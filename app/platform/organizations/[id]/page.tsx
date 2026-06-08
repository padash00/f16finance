'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Loader2,
  Package,
  RotateCcw,
  Sparkles,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PLATFORM_FEATURES } from '@/lib/core/entitlements'

type EntitlementState = { enabled: boolean; source: string }
type PackageItem = { code: string; name: string; vertical: string; description: string | null; feature_codes: string[]; price_kzt: number }
type AddonItem = { code: string; name: string; description: string | null; feature_codes: string[]; price_kzt: number; billing_unit: string }
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
  entitlements?: Record<string, EntitlementState>
  legacyGrants?: number
  packageCode?: string | null
  addonCodes?: string[]
  effectiveFeatures?: Array<{ code: string; sources: string[] }>
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
  const [entering, setEntering] = useState(false)
  const [savingFeature, setSavingFeature] = useState<string | null>(null)
  const [packages, setPackages] = useState<PackageItem[]>([])
  const [addons, setAddons] = useState<AddonItem[]>([])
  const [savingPkg, setSavingPkg] = useState(false)
  const [savingAddon, setSavingAddon] = useState<string | null>(null)
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
        setPackages(Array.isArray(data.packages) ? data.packages : [])
        setAddons(Array.isArray(data.addons) ? data.addons : [])
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

  const handleAssignPackage = async (code: string) => {
    setSavingPkg(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: id, assignPackage: code }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось назначить пакет')
      if (data?.organization) setOrg(data.organization)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSavingPkg(false)
    }
  }

  const handleToggleAddon = async (addon: string, enabled: boolean) => {
    setSavingAddon(addon)
    setError(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: id, setAddon: { addon, enabled } }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось изменить модуль')
      if (data?.organization) setOrg(data.organization)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSavingAddon(null)
    }
  }

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

  const handleEnter = async () => {
    setEntering(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: id }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось войти')
      router.push('/dashboard')
      router.refresh()
    } catch (err: any) {
      setError(err.message)
      setEntering(false)
    }
  }

  const handleFeature = async (feature: string, enabled: boolean | null) => {
    setSavingFeature(feature)
    setError(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: id, featureOverride: { feature, enabled } }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось сохранить')
      if (data?.organization) setOrg(data.organization)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSavingFeature(null)
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

      {/* Функции (доступы / entitlements) */}
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4 text-violet-400" />
          Функции (доступы)
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Что доступно этой организации. По умолчанию — из тарифа; можно переопределить вручную.
        </p>
        {org.legacyGrants ? (
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-300">
            🛡 Legacy-гранты активны: {org.legacyGrants} (ничего не пропадёт при включении ограничений)
          </div>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-2">
          {PLATFORM_FEATURES.map((f) => {
            const st = org.entitlements?.[f.key]
            const enabled = !!st?.enabled
            const source = st?.source || 'none'
            const busy = savingFeature === f.key
            return (
              <div key={f.key} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{f.label}</p>
                  <p className="text-[11px] text-slate-500">
                    {source === 'override' ? 'переопределено вручную' : source === 'plan' ? 'из тарифа' : 'нет в тарифе'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {source === 'override' ? (
                    <button
                      type="button"
                      onClick={() => handleFeature(f.key, null)}
                      disabled={busy}
                      title="Вернуть к тарифу"
                      className="rounded-md p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => handleFeature(f.key, !enabled)}
                    disabled={busy}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                    title={enabled ? 'Выключить' : 'Включить'}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] text-slate-600">
          Управление доступом. Принудительное ограничение интерфейса включится с фазой изоляции тенантов.
        </p>
      </div>

      {/* Пакет и модули */}
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Package className="h-4 w-4 text-violet-400" />
          Пакет и модули
        </h2>
        <p className="mb-4 text-xs text-slate-500">Отраслевой пакет и платные add-ons организации.</p>

        <label className="mb-1.5 block text-[11px] text-slate-500">Отраслевой пакет</label>
        <div className="mb-5 flex flex-wrap gap-2">
          {packages.length === 0 ? (
            <span className="text-xs text-slate-600">Каталог пакетов пуст (примени миграцию).</span>
          ) : (
            packages.map((p) => {
              const active = org.packageCode === p.code
              return (
                <button
                  key={p.code}
                  onClick={() => handleAssignPackage(p.code)}
                  disabled={savingPkg}
                  className={`rounded-xl border px-3 py-2 text-left text-sm transition disabled:opacity-50 ${
                    active
                      ? 'border-violet-500/50 bg-violet-500/10 text-white'
                      : 'border-white/10 bg-white/[0.02] text-slate-300 hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="font-medium">{p.name}</div>
                  <div className="text-[11px] text-slate-500">{p.price_kzt.toLocaleString('ru')} ₸/мес</div>
                </button>
              )
            })
          )}
        </div>

        <label className="mb-1.5 block text-[11px] text-slate-500">Дополнительные модули</label>
        <div className="grid gap-2 sm:grid-cols-2">
          {addons.map((a) => {
            const on = (org.addonCodes || []).includes(a.code)
            const busy = savingAddon === a.code
            return (
              <div key={a.code} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm text-white">{a.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {a.price_kzt.toLocaleString('ru')} ₸ · {a.billing_unit === 'company' ? 'за точку' : a.billing_unit === 'device' ? 'за устройство' : 'за орг'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleToggleAddon(a.code, !on)}
                  disabled={busy}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-slate-700'}`}
                  title={on ? 'Выключить' : 'Включить'}
                >
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                </button>
              </div>
            )
          })}
        </div>

        {org.effectiveFeatures && org.effectiveFeatures.length > 0 ? (
          <div className="mt-4 border-t border-white/5 pt-3">
            <p className="mb-2 text-[11px] text-slate-500">Итоговые права (company_features): {org.effectiveFeatures.length}</p>
            <div className="flex flex-wrap gap-1.5">
              {org.effectiveFeatures.map((ef) => {
                const isLegacy = ef.sources.includes('legacy')
                return (
                  <span
                    key={ef.code}
                    title={`источник: ${ef.sources.join(', ')}`}
                    className={`rounded-md border px-1.5 py-0.5 text-[11px] ${
                      isLegacy
                        ? 'border-amber-500/20 bg-amber-500/10 text-amber-300'
                        : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
                    }`}
                  >
                    {ef.code}
                  </span>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-slate-600">
              🛡 жёлтые — legacy-гранты, зелёные — пакет/add-ons. Это эффективные права (пока без enforcement).
            </p>
          </div>
        ) : null}
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
        <Button
          onClick={handleEnter}
          disabled={entering}
          className="bg-emerald-600 text-white hover:bg-emerald-500"
        >
          {entering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Войти в кабинет
        </Button>
      </div>
    </div>
  )
}
