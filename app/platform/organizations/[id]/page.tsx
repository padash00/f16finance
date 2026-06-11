'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Building2,
  CreditCard,
  ExternalLink,
  Loader2,
  Package,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type EntitlementState = { enabled: boolean; source: string }
type PackageItem = { code: string; name: string; vertical: string; description: string | null; feature_codes: string[]; price_kzt: number }
type AddonItem = { code: string; name: string; description: string | null; feature_codes: string[]; price_kzt: number; billing_unit: string }
type FeatureCatalogItem = { code: string; name: string; category: string }
type InvoiceItem = {
  id: string
  amount: number
  currency: string
  period_start: string | null
  period_end: string | null
  due_date: string | null
  status: string
  method: string | null
  note: string | null
  paid_at: string | null
  created_at: string
}
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
  billingEvents?: Array<{ eventType: string; status: string | null; amount: number | null; currency: string | null; createdAt: string | null }>
  invoices?: InvoiceItem[]
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

const BILLING_EVENT_LABELS: Record<string, string> = {
  trial_started: 'Старт пробного периода',
  subscription_activated: 'Активация',
  payment_recorded: 'Оплата',
  subscription_past_due: 'Просрочка',
  subscription_cancel_scheduled: 'Отмена в конце периода',
  subscription_canceled: 'Подписка отменена',
  subscription_resumed: 'Возобновление',
  subscription_renewed: 'Продление',
  plan_changed: 'Смена тарифа',
}

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
  const [features, setFeatures] = useState<FeatureCatalogItem[]>([])
  const [savingPkg, setSavingPkg] = useState(false)
  const [savingAddon, setSavingAddon] = useState<string | null>(null)
  const [invAmount, setInvAmount] = useState('')
  const [invPeriodStart, setInvPeriodStart] = useState('')
  const [invPeriodEnd, setInvPeriodEnd] = useState('')
  const [invDueDate, setInvDueDate] = useState('')
  const [invNote, setInvNote] = useState('')
  const [savingInvoice, setSavingInvoice] = useState(false)
  const [invoiceBusy, setInvoiceBusy] = useState<string | null>(null)
  const [ownerEmail, setOwnerEmail] = useState('')
  const [ownerFullName, setOwnerFullName] = useState('')
  const [ownerPwd, setOwnerPwd] = useState('')
  const [creatingOwner, setCreatingOwner] = useState(false)
  const [createdOwner, setCreatedOwner] = useState<{ email: string; password: string | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [okMsg, setOkMsg] = useState<string | null>(null)

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
        setFeatures(Array.isArray(data.features) ? data.features : [])
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
      const pkgName = (packages.find((p) => p.code === code)?.name) || code
      setOkMsg(`Пакет назначен: ${pkgName}. Функции пакета включены.`)
      setTimeout(() => setOkMsg(null), 3500)
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

  const handleCreateInvoice = async () => {
    setSavingInvoice(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: id,
          createInvoice: {
            amount: invAmount ? Number(invAmount) : 0,
            periodStart: invPeriodStart || null,
            periodEnd: invPeriodEnd || null,
            dueDate: invDueDate || null,
            note: invNote.trim() || null,
          },
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось выставить счёт')
      if (data?.organization) setOrg(data.organization)
      setInvAmount('')
      setInvPeriodStart('')
      setInvPeriodEnd('')
      setInvDueDate('')
      setInvNote('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSavingInvoice(false)
    }
  }

  const handleCreateOwner = async () => {
    setCreatingOwner(true)
    setError(null)
    setCreatedOwner(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: id,
          action: 'provisionOwner',
          ownerEmail: ownerEmail.trim(),
          ownerFullName: ownerFullName.trim() || null,
          ownerPassword: ownerPwd.trim() || null,
        }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось создать аккаунт')
      setCreatedOwner(data?.owner || null)
      setOwnerEmail('')
      setOwnerFullName('')
      setOwnerPwd('')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setCreatingOwner(false)
    }
  }

  const handleInvoiceAction = async (invoiceId: string, action: 'paid' | 'void', method?: string) => {
    setInvoiceBusy(invoiceId)
    setError(null)
    try {
      const body: any = { organizationId: id }
      if (action === 'paid') body.markInvoicePaid = { invoiceId, method: method || 'manual' }
      else body.voidInvoice = { invoiceId }
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Ошибка')
      if (data?.organization) setOrg(data.organization)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setInvoiceBusy(null)
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

  const handleFeatureGrant = async (code: string, enabled: boolean) => {
    setSavingFeature(code)
    setError(null)
    try {
      const res = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: id, setFeatureGrant: { code, enabled } }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось сохранить')
      if (data?.organization) setOrg(data.organization)
      setOkMsg(enabled ? 'Функция выдана.' : 'Функция снята.')
      setTimeout(() => setOkMsg(null), 2500)
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
              {/* Отраслевой пакет — переключение прямо в подписке */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Отраслевой пакет</label>
                {packages.length === 0 ? (
                  <p className="text-xs text-slate-600">Каталог пакетов пуст (примени миграцию).</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {packages.map((p) => {
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
                    })}
                  </div>
                )}
                {org.packageCode && (
                  <p className="text-[11px] text-emerald-400/80">
                    Активный пакет: {packages.find((p) => p.code === org.packageCode)?.name || org.packageCode} — его функции включены автоматически.
                  </p>
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

      {/* Доступ к функциям (entitlements) */}
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Sparkles className="h-4 w-4 text-violet-400" />
          Доступ к функциям
        </h2>
        <p className="mb-3 text-xs text-slate-500">
          Эффективные права организации (из пакета, add-ons и legacy). Можно выдать функцию вручную.
        </p>
        {org.legacyGrants ? (
          <div className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300">
            🛡 Legacy-гранты активны: {org.legacyGrants}
          </div>
        ) : null}
        {features.length === 0 ? (
          <p className="text-xs text-slate-600">Каталог функций пуст (примени миграцию).</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {features.map((f) => {
              const eff = (org.effectiveFeatures || []).find((e) => e.code === f.code)
              const enabled = !!eff
              const sources = eff?.sources || []
              const isManual = sources.includes('manual')
              const fromPackageOrLegacy = sources.some((s) => s !== 'manual')
              const busy = savingFeature === f.code
              const lockedByPackage = enabled && fromPackageOrLegacy && !isManual
              const sourceLabel = !enabled
                ? 'нет доступа'
                : sources.includes('legacy')
                  ? 'legacy'
                  : sources.includes('plan')
                    ? 'из пакета'
                    : sources.includes('addon')
                      ? 'из add-on'
                      : 'вручную'
              return (
                <div key={f.code} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-white">{f.name}</p>
                    <p className="text-[11px] text-slate-500">{f.code} · {sourceLabel}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleFeatureGrant(f.code, !isManual)}
                    disabled={busy || lockedByPackage}
                    title={lockedByPackage ? 'Выдано пакетом/legacy — меняется через пакет' : isManual ? 'Снять ручную выдачу' : 'Выдать вручную'}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${enabled ? 'bg-emerald-500' : 'bg-slate-700'}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <p className="mt-3 text-[11px] text-slate-600">
          Тумблер управляет ручной выдачей (manual). Права из пакета/legacy меняются через пакет. Enforcement пока выключен.
        </p>
      </div>

      {/* Пакет и модули */}
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold text-white">
          <Package className="h-4 w-4 text-violet-400" />
          Дополнительные модули
        </h2>
        <p className="mb-4 text-xs text-slate-500">Платные add-ons поверх пакета (отраслевой пакет — в блоке «Подписка»).</p>

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

      {/* Создать аккаунт владельца */}
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-1 text-sm font-semibold text-white">Аккаунт владельца</h2>
        <p className="mb-3 text-xs text-slate-500">Создаёт логин владельца этой организации (роль owner). Под ним клиент видит только свои данные.</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="Email" className="border-white/10 bg-slate-900/60 text-white" />
          <Input value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} placeholder="Имя (необяз.)" className="border-white/10 bg-slate-900/60 text-white" />
          <Input value={ownerPwd} onChange={(e) => setOwnerPwd(e.target.value)} placeholder="Пароль (или сгенерируем)" className="border-white/10 bg-slate-900/60 text-white" />
        </div>
        <div className="mt-2">
          <Button onClick={handleCreateOwner} disabled={creatingOwner || !ownerEmail.trim()} className="bg-emerald-600 text-white hover:bg-emerald-500">
            {creatingOwner ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Создать аккаунт
          </Button>
        </div>
        {createdOwner ? (
          <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-sm text-emerald-100">
            <div className="font-medium">Аккаунт создан — передайте клиенту:</div>
            <div className="mt-1 font-mono text-xs text-white">Email: {createdOwner.email}</div>
            {createdOwner.password ? (
              <div className="font-mono text-xs text-white">Пароль: {createdOwner.password}</div>
            ) : (
              <div className="text-xs text-emerald-200/80">Пароль задан вручную (виден только вам).</div>
            )}
            <div className="mt-1 text-[11px] text-emerald-200/70">Вход: ordaops.kz/login. При первом входе попросит сменить пароль.</div>
          </div>
        ) : null}
      </div>

      {/* Счета (ручной биллинг) */}
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <CreditCard className="h-4 w-4 text-violet-400" />
          Счета
        </h2>

        {(() => {
          const pkg = packages.find((p) => p.code === org.packageCode)
          const addonsTotal = (org.addonCodes || []).reduce((s, c) => s + (addons.find((a) => a.code === c)?.price_kzt || 0), 0)
          const suggested = (pkg?.price_kzt || 0) + addonsTotal
          return (
            <div className="mb-4 rounded-2xl border border-white/5 bg-black/20 p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-[11px] text-slate-500">К оплате по тарифу:</span>
                <span className="text-xs text-slate-300">{suggested.toLocaleString('ru')} ₸/мес</span>
                {suggested > 0 ? (
                  <button type="button" onClick={() => setInvAmount(String(suggested))} className="text-[11px] text-violet-400 hover:text-violet-300">
                    подставить
                  </button>
                ) : null}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input type="number" value={invAmount} onChange={(e) => setInvAmount(e.target.value)} placeholder="Сумма ₸" className="border-white/10 bg-slate-900/60 text-white" />
                <Input type="date" value={invPeriodStart} onChange={(e) => setInvPeriodStart(e.target.value)} title="Период с" className="border-white/10 bg-slate-900/60 text-white" />
                <Input type="date" value={invPeriodEnd} onChange={(e) => setInvPeriodEnd(e.target.value)} title="Период по" className="border-white/10 bg-slate-900/60 text-white" />
                <Input type="date" value={invDueDate} onChange={(e) => setInvDueDate(e.target.value)} title="Срок оплаты" className="border-white/10 bg-slate-900/60 text-white" />
              </div>
              <div className="mt-2 flex gap-2">
                <Input value={invNote} onChange={(e) => setInvNote(e.target.value)} placeholder="Комментарий (необяз.)" className="flex-1 border-white/10 bg-slate-900/60 text-white" />
                <Button onClick={handleCreateInvoice} disabled={savingInvoice} className="bg-violet-600 text-white hover:bg-violet-500">
                  {savingInvoice ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Выставить счёт
                </Button>
              </div>
            </div>
          )
        })()}

        {org.invoices && org.invoices.length > 0 ? (
          <div className="space-y-1.5">
            {org.invoices.map((inv) => {
              const busy = invoiceBusy === inv.id
              const statusLabel = inv.status === 'paid' ? 'Оплачен' : inv.status === 'void' ? 'Аннулирован' : inv.status === 'overdue' ? 'Просрочен' : 'Выставлен'
              const statusColor = inv.status === 'paid' ? 'text-emerald-300' : inv.status === 'void' ? 'text-slate-500' : inv.status === 'overdue' ? 'text-red-300' : 'text-amber-300'
              return (
                <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <p className={inv.status === 'void' ? 'text-slate-500 line-through' : 'text-white'}>
                      {Number(inv.amount).toLocaleString('ru')} {inv.currency || '₸'} · <span className={statusColor}>{statusLabel}</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {inv.period_start || inv.period_end ? `${inv.period_start || '—'} … ${inv.period_end || '—'}` : 'без периода'}
                      {inv.due_date ? ` · до ${inv.due_date}` : ''}
                      {inv.note ? ` · ${inv.note}` : ''}
                    </p>
                  </div>
                  {inv.status === 'issued' || inv.status === 'overdue' ? (
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleInvoiceAction(inv.id, 'paid')}
                        disabled={busy}
                        className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300 transition hover:bg-emerald-500/20 disabled:opacity-50"
                      >
                        Оплачен
                      </button>
                      <button
                        type="button"
                        onClick={() => handleInvoiceAction(inv.id, 'void')}
                        disabled={busy}
                        title="Аннулировать"
                        className="rounded-lg p-1 text-slate-500 transition hover:bg-white/5 hover:text-slate-300"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="py-2 text-sm text-slate-500">Счетов пока нет. Выставьте первый выше.</p>
        )}
      </div>

      {/* История биллинга */}
      <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.02] p-5">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
          <CreditCard className="h-4 w-4 text-violet-400" />
          История биллинга
        </h2>
        {org.billingEvents && org.billingEvents.length > 0 ? (
          <div className="space-y-1.5">
            {org.billingEvents.map((e, i) => (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="truncate text-white">{BILLING_EVENT_LABELS[e.eventType] || e.eventType}</p>
                  <p className="text-[11px] text-slate-500">
                    {e.createdAt ? new Date(e.createdAt).toLocaleString('ru-RU') : '—'}
                  </p>
                </div>
                {e.amount ? (
                  <span className="shrink-0 font-medium text-slate-200">
                    {Number(e.amount).toLocaleString('ru')} {e.currency || '₸'}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <p className="py-3 text-sm text-slate-500">
            Событий биллинга пока нет. Появятся при действиях над подпиской (оплата, активация, триал…).
          </p>
        )}
      </div>

      {okMsg && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-500/30 bg-emerald-600/90 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-black/30">
          ✓ {okMsg}
        </div>
      )}

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
