'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Building2,
  Calendar,
  CreditCard,
  ExternalLink,
  History,
  LayoutDashboard,
  Loader2,
  LogIn,
  Package,
  ShieldCheck,
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
  active: 'text-emerald-600 dark:text-emerald-300', trialing: 'text-violet-600 dark:text-violet-300', past_due: 'text-red-600 dark:text-red-300', canceled: 'text-slate-400', suspended: 'text-slate-400',
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

const tenge = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} ₸`

type TabKey = 'overview' | 'billing' | 'access' | 'members' | 'history'
const TABS: Array<{ key: TabKey; label: string; icon: React.ReactNode }> = [
  { key: 'overview', label: 'Обзор', icon: <LayoutDashboard className="h-4 w-4" /> },
  { key: 'billing', label: 'Тариф и оплата', icon: <CreditCard className="h-4 w-4" /> },
  { key: 'access', label: 'Доступы', icon: <ShieldCheck className="h-4 w-4" /> },
  { key: 'members', label: 'Участники', icon: <Users className="h-4 w-4" /> },
  { key: 'history', label: 'История', icon: <History className="h-4 w-4" /> },
]

type OrgMember = {
  id: string
  email: string | null
  role: string
  status: string
  fullName: string
  accountState: 'no_email' | 'no_account' | 'invited' | 'active'
}

const cardCls = 'rounded-2xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-slate-900/40'

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
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  // Участники
  const [members, setMembers] = useState<OrgMember[]>([])
  const [membersLoaded, setMembersLoaded] = useState(false)
  const [mFullName, setMFullName] = useState('')
  const [mEmail, setMEmail] = useState('')
  const [mRole, setMRole] = useState('manager')
  const [mBusy, setMBusy] = useState(false)

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

  const loadMembers = async () => {
    try {
      const res = await fetch(`/api/admin/organization-members?organizationId=${encodeURIComponent(id)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (res.ok) setMembers(Array.isArray(data?.items) ? data.items : [])
    } finally {
      setMembersLoaded(true)
    }
  }

  useEffect(() => {
    if (activeTab === 'members' && !membersLoaded) void loadMembers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, membersLoaded])

  const memberAction = async (payload: Record<string, unknown>, successMsg?: string) => {
    setMBusy(true)
    setError(null)
    setOkMsg(null)
    try {
      const res = await fetch('/api/admin/organization-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId: id, ...payload }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) throw new Error(data?.error || 'Не удалось выполнить')
      setOkMsg(data?.message || successMsg || 'Готово')
      setMFullName('')
      setMEmail('')
      await loadMembers()
    } catch (err: any) {
      setError(err.message)
    } finally {
      setMBusy(false)
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

  const subStatusLabel = org.subscription
    ? SUB_STATUS_LABELS[org.subscription.status] || org.subscription.status
    : 'Нет подписки'
  const subStatusColor = org.subscription
    ? SUB_STATUS_COLORS[org.subscription.status] || 'text-slate-300'
    : 'text-slate-400'

  return (
    <div className="mx-auto max-w-6xl p-6 text-slate-900 dark:text-white">
      {/* Шапка */}
      <div className="mb-5 flex items-center gap-3">
        <button onClick={() => router.push('/platform/organizations')} className="text-slate-400 hover:text-slate-900 dark:hover:text-white">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-500/20 text-sm font-bold text-violet-700 dark:text-violet-300">
            {org.name.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-900 dark:text-white">{org.name}</h1>
            <a href={org.appUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-slate-400 hover:text-violet-300">
              {org.primaryDomain} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </div>

      {/* Таб-навигация */}
      <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 dark:border-white/10">
        {TABS.map((t) => {
          const active = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition ${
                active
                  ? 'border-violet-500 text-violet-600 dark:text-violet-300'
                  : 'border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          )
        })}
      </div>

      {/* ============================= ОБЗОР ============================= */}
      {activeTab === 'overview' && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Карточка клиента */}
          <div className={cardCls}>
            <h2 className="mb-4 text-sm font-semibold">Карточка клиента</h2>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Название</label>
                <Input value={name} onChange={e => setName(e.target.value)} className="border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Адрес (поддомен)</label>
                  <p className="truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-300" title={org.primaryDomain}>{org.primaryDomain}</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Идентификатор (slug)</label>
                  <p className="truncate rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 dark:border-white/10 dark:bg-slate-900/30 dark:text-slate-300" title={org.slug}>{org.slug}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-400">Статус организации</label>
                <select
                  value={orgStatus}
                  onChange={e => setOrgStatus(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
                >
                  {ORG_STATUSES.map(s => <option key={s} value={s}>{ORG_STATUS_LABELS[s] || s}</option>)}
                </select>
                <p className="text-[11px] text-slate-500">«Заморожена» — клиент не сможет пользоваться системой. Не забудьте «Сохранить».</p>
              </div>
            </div>
          </div>

          {/* Статус подписки + ключевые факты */}
          <div className="space-y-5">
            <div className={cardCls}>
              <h2 className="mb-3 text-sm font-semibold">Статус подписки</h2>
              <div className={`text-3xl font-bold ${subStatusColor}`}>{subStatusLabel}</div>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Тариф: <span className="font-medium text-slate-700 dark:text-slate-200">{org.subscription?.plan?.name || '—'}</span>
              </p>
              {org.subscription?.endsAt && (
                <p className="mt-1 text-xs text-slate-400">
                  Действует до {new Date(org.subscription.endsAt).toLocaleDateString('ru-RU')}
                </p>
              )}
              <button
                onClick={() => setActiveTab('billing')}
                className="mt-3 text-xs font-medium text-violet-500 hover:text-violet-600 dark:hover:text-violet-300"
              >
                Управлять тарифом и оплатой →
              </button>
            </div>

            <div className={cardCls}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                <Users className="h-4 w-4 text-violet-400" />
                Ключевые факты
              </h2>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Точек', value: org.companyCount, icon: <Building2 className="h-3.5 w-3.5" /> },
                  { label: 'Участников', value: org.memberCount, icon: <Users className="h-3.5 w-3.5" /> },
                  { label: 'Доступов', value: org.effectiveFeatures?.length ?? 0, icon: <ShieldCheck className="h-3.5 w-3.5" /> },
                ].map(item => (
                  <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-white/5 dark:bg-white/[0.02]">
                    <p className="flex items-center gap-1 text-xs text-slate-500">{item.icon}{item.label}</p>
                    <p className="mt-0.5 text-xl font-bold tabular-nums">{item.value}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Точки */}
          <div className={cardCls}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4 text-violet-400" />
              Точки ({org.companies.length})
            </h2>
            <div className="space-y-1.5">
              {org.companies.map(c => (
                <div key={c.id} className="flex items-center justify-between rounded-lg bg-slate-100 px-3 py-2 text-sm dark:bg-white/[0.03]">
                  <span className="text-slate-700 dark:text-slate-200">{c.name}</span>
                  {c.code && <span className="text-xs text-slate-500">{c.code}</span>}
                </div>
              ))}
              {org.companies.length === 0 && <p className="text-xs text-slate-500">Точек нет</p>}
            </div>
          </div>

          {/* Действия */}
          <div className={cardCls}>
            <h2 className="mb-3 text-sm font-semibold">Действия</h2>
            <div className="space-y-3">
              <Button
                onClick={handleEnter}
                disabled={entering}
                className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
              >
                {entering ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogIn className="mr-2 h-4 w-4" />}
                Войти в кабинет клиента
              </Button>
              <p className="text-[11px] text-slate-500">Откроет дашборд от лица этого клиента — вы увидите систему его глазами.</p>

              <div className="border-t border-slate-200 pt-3 dark:border-white/5">
                <p className="mb-2 text-xs font-medium text-slate-400">Выдать владельцу доступ</p>
                <p className="mb-3 text-[11px] text-slate-500">Создаёт логин владельца этой организации (роль owner). Под ним клиент видит только свои данные.</p>
                <div className="grid grid-cols-1 gap-2">
                  <Input type="email" value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} placeholder="Email" className="border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
                  <div className="grid grid-cols-2 gap-2">
                    <Input value={ownerFullName} onChange={(e) => setOwnerFullName(e.target.value)} placeholder="Имя (необяз.)" className="border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
                    <Input value={ownerPwd} onChange={(e) => setOwnerPwd(e.target.value)} placeholder="Пароль (или сгенерируем)" className="border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
                  </div>
                  <Button onClick={handleCreateOwner} disabled={creatingOwner || !ownerEmail.trim()} className="bg-violet-600 text-white hover:bg-violet-500">
                    {creatingOwner ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Создать аккаунт владельца
                  </Button>
                </div>
                {createdOwner ? (
                  <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.06] p-3 text-sm text-emerald-700 dark:text-emerald-100">
                    <div className="font-medium">Аккаунт создан — передайте клиенту:</div>
                    <div className="mt-1 font-mono text-xs text-slate-900 dark:text-white">Email: {createdOwner.email}</div>
                    {createdOwner.password ? (
                      <div className="font-mono text-xs text-slate-900 dark:text-white">Пароль: {createdOwner.password}</div>
                    ) : (
                      <div className="text-xs text-emerald-600/80 dark:text-emerald-200/80">Пароль задан вручную (виден только вам).</div>
                    )}
                    <div className="mt-1 text-[11px] text-emerald-600/70 dark:text-emerald-200/70">Вход: ordaops.kz/login. При первом входе попросит сменить пароль.</div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================== ТАРИФ И ОПЛАТА ======================== */}
      {activeTab === 'billing' && (
        <div className="grid gap-5 lg:grid-cols-2">
          {/* Подписка */}
          <div className={cardCls}>
            <h2 className="mb-4 text-sm font-semibold">Подписка</h2>
            {org.subscription ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-slate-500">Тариф</p>
                    <p className="font-medium text-slate-900 dark:text-white">{org.subscription.plan?.name || '—'}</p>
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
                      <p className="text-slate-700 dark:text-slate-300">{new Date(org.subscription.startsAt).toLocaleDateString('ru-RU')}</p>
                    </div>
                  )}
                  {org.subscription.endsAt && (
                    <div>
                      <p className="text-xs text-slate-500">Окончание</p>
                      <p className="text-slate-700 dark:text-slate-300">{new Date(org.subscription.endsAt).toLocaleDateString('ru-RU')}</p>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-400">Действие над подпиской</label>
                  <select
                    value={subAction}
                    onChange={e => setSubAction(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white"
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
                  <p className="text-[11px] text-slate-500">Выберите действие и нажмите «Сохранить» внизу — оно применится к подписке.</p>
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Подписки нет.</p>
            )}
          </div>

          {/* Тариф (пакет) */}
          <div className={cardCls}>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Package className="h-4 w-4 text-violet-400" />
              Тариф
            </h2>
            <p className="mb-3 text-xs text-slate-500">Основной отраслевой пакет клиента. Его функции включаются автоматически.</p>
            {packages.length === 0 ? (
              <p className="text-xs text-slate-600">Каталог тарифов пуст (примени миграцию).</p>
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
                          ? 'border-violet-500/50 bg-violet-500/10 text-slate-900 dark:text-white'
                          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-300 dark:hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="font-medium">{p.name}</div>
                      <div className="text-[11px] tabular-nums text-slate-500">{tenge(p.price_kzt)}/мес</div>
                    </button>
                  )
                })}
              </div>
            )}
            {org.packageCode && (
              <p className="mt-2 text-[11px] text-emerald-600 dark:text-emerald-400/80">
                Активный тариф: {packages.find((p) => p.code === org.packageCode)?.name || org.packageCode} — его функции включены автоматически.
              </p>
            )}
          </div>

          {/* Доп. модули */}
          <div className={cardCls}>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Package className="h-4 w-4 text-violet-400" />
              Доп. модули
            </h2>
            <p className="mb-3 text-xs text-slate-500">Платные надстройки поверх тарифа. Включаются тумблером.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {addons.map((a) => {
                const on = (org.addonCodes || []).includes(a.code)
                const busy = savingAddon === a.code
                return (
                  <div key={a.code} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/5 dark:bg-white/[0.02]">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-slate-900 dark:text-white">{a.name}</p>
                      <p className="text-[11px] tabular-nums text-slate-500">
                        {tenge(a.price_kzt)} · {a.billing_unit === 'company' ? 'за точку' : a.billing_unit === 'device' ? 'за устройство' : 'за орг'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleToggleAddon(a.code, !on)}
                      disabled={busy}
                      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-50 ${on ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                      title={on ? 'Выключить' : 'Включить'}
                    >
                      <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${on ? 'left-[18px]' : 'left-0.5'}`} />
                    </button>
                  </div>
                )
              })}
              {addons.length === 0 && <p className="text-xs text-slate-600">Доп. модулей нет.</p>}
            </div>
          </div>

          {/* Счета */}
          <div className={cardCls}>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CreditCard className="h-4 w-4 text-violet-400" />
              Счета
            </h2>

            {(() => {
              const pkg = packages.find((p) => p.code === org.packageCode)
              const addonsTotal = (org.addonCodes || []).reduce((s, c) => s + (addons.find((a) => a.code === c)?.price_kzt || 0), 0)
              const suggested = (pkg?.price_kzt || 0) + addonsTotal
              return (
                <div className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 dark:border-white/5 dark:bg-black/20">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="text-[11px] text-slate-500">К оплате по тарифу:</span>
                    <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">{tenge(suggested)}/мес</span>
                    {suggested > 0 ? (
                      <button type="button" onClick={() => setInvAmount(String(suggested))} className="text-[11px] text-violet-400 hover:text-violet-300">
                        подставить
                      </button>
                    ) : null}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Input type="number" value={invAmount} onChange={(e) => setInvAmount(e.target.value)} placeholder="Сумма ₸" className="border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
                    <Input type="date" value={invPeriodStart} onChange={(e) => setInvPeriodStart(e.target.value)} title="Период с" className="border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
                    <Input type="date" value={invPeriodEnd} onChange={(e) => setInvPeriodEnd(e.target.value)} title="Период по" className="border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
                    <Input type="date" value={invDueDate} onChange={(e) => setInvDueDate(e.target.value)} title="Срок оплаты" className="border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input value={invNote} onChange={(e) => setInvNote(e.target.value)} placeholder="Комментарий (необяз.)" className="flex-1 border-slate-200 bg-white text-slate-900 dark:border-white/10 dark:bg-slate-900/60 dark:text-white" />
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
                  const statusColor = inv.status === 'paid' ? 'text-emerald-600 dark:text-emerald-300' : inv.status === 'void' ? 'text-slate-500' : inv.status === 'overdue' ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'
                  return (
                    <div key={inv.id} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/5 dark:bg-white/[0.02]">
                      <div className="min-w-0">
                        <p className={inv.status === 'void' ? 'text-slate-500 line-through' : 'text-slate-900 dark:text-white'}>
                          <span className="tabular-nums">{Number(inv.amount).toLocaleString('ru-RU')} {inv.currency || '₸'}</span> · <span className={statusColor}>{statusLabel}</span>
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
                            className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-700 transition hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300"
                          >
                            Оплачен
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInvoiceAction(inv.id, 'void')}
                            disabled={busy}
                            title="Аннулировать"
                            className="rounded-lg p-1 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/5 dark:hover:text-slate-300"
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
        </div>
      )}

      {/* ============================ ДОСТУПЫ ============================ */}
      {activeTab === 'access' && (
        <div className="space-y-5">
          <div className={cardCls}>
            <h2 className="mb-1 flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="h-4 w-4 text-violet-400" />
              Что включено у клиента
            </h2>
            <p className="mb-3 text-xs text-slate-500">
              Список возможностей системы. Зелёный тумблер — функция доступна клиенту. Функции из тарифа и модулей включаются сами; остальные можно выдать вручную.
            </p>
            {org.legacyGrants ? (
              <div className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-300">
                🛡 Перенесённые со старой схемы доступы: {org.legacyGrants}
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
                      ? 'перенос со старой схемы'
                      : sources.includes('plan')
                        ? 'из тарифа'
                        : sources.includes('addon')
                          ? 'из доп. модуля'
                          : 'выдано вручную'
                  return (
                    <div key={f.code} className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 dark:border-white/5 dark:bg-white/[0.02]">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-slate-900 dark:text-white">{f.name}</p>
                        <p className="text-[11px] text-slate-500">{sourceLabel}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleFeatureGrant(f.code, !isManual)}
                        disabled={busy || lockedByPackage}
                        title={lockedByPackage ? 'Включено тарифом/модулем — меняется через тариф' : isManual ? 'Снять ручную выдачу' : 'Выдать вручную'}
                        className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
                      >
                        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${enabled ? 'left-[18px]' : 'left-0.5'}`} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
            <p className="mt-3 text-[11px] text-slate-600">
              Тумблер управляет ручной выдачей. Функции из тарифа/переноса меняются через тариф.
            </p>
          </div>

          {/* Итоговые права с источниками */}
          {org.effectiveFeatures && org.effectiveFeatures.length > 0 ? (
            <div className={cardCls}>
              <h2 className="mb-1 text-sm font-semibold">Итоговые доступы ({org.effectiveFeatures.length})</h2>
              <p className="mb-3 text-xs text-slate-500">Полный набор функций, которыми клиент может пользоваться, с указанием откуда они пришли.</p>
              <div className="flex flex-wrap gap-1.5">
                {org.effectiveFeatures.map((ef) => {
                  const isLegacy = ef.sources.includes('legacy')
                  const human = ef.sources
                    .map((s) => (s === 'legacy' ? 'перенос' : s === 'plan' ? 'тариф' : s === 'addon' ? 'модуль' : s === 'manual' ? 'вручную' : s))
                    .join(', ')
                  const name = features.find((f) => f.code === ef.code)?.name || ef.code
                  return (
                    <span
                      key={ef.code}
                      title={`источник: ${human}`}
                      className={`rounded-md border px-1.5 py-0.5 text-[11px] ${
                        isLegacy
                          ? 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {name}
                    </span>
                  )
                })}
              </div>
              <p className="mt-2 text-[11px] text-slate-600">
                🛡 жёлтые — перенесены со старой схемы, зелёные — из тарифа/модулей или выданы вручную.
              </p>
            </div>
          ) : null}
        </div>
      )}

      {/* ============================ УЧАСТНИКИ ============================ */}
      {activeTab === 'members' && (
        <div className="space-y-4">
          {/* Пригласить */}
          <div className={cardCls}>
            <h2 className="mb-3 text-sm font-semibold">Пригласить участника</h2>
            <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
              <input
                value={mFullName}
                onChange={(e) => setMFullName(e.target.value)}
                placeholder="Имя"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
              />
              <input
                value={mEmail}
                onChange={(e) => setMEmail(e.target.value)}
                placeholder="email@example.com"
                type="email"
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
              />
              <select
                value={mRole}
                onChange={(e) => setMRole(e.target.value)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-white/5"
              >
                <option value="owner">Владелец</option>
                <option value="manager">Управляющий</option>
                <option value="marketer">Маркетолог</option>
                <option value="other">Сотрудник</option>
              </select>
              <button
                type="button"
                disabled={mBusy || !mEmail.trim()}
                onClick={() => void memberAction({ action: 'inviteMember', fullName: mFullName.trim(), email: mEmail.trim(), role: mRole })}
                className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-700 disabled:opacity-50"
              >
                Пригласить
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">Если почта настроена — уйдёт письмо-приглашение. Иначе участник добавится со статусом «приглашён».</p>
          </div>

          {/* Список */}
          <div className={cardCls}>
            <h2 className="mb-3 text-sm font-semibold">Участники ({members.length})</h2>
            {!membersLoaded ? (
              <div className="py-6 text-center text-sm text-slate-400"><Loader2 className="mx-auto h-5 w-5 animate-spin" /></div>
            ) : members.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-400">Пока никого. Пригласи первого выше.</p>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-white/5">
                {members.map((m) => {
                  const stateLabel =
                    m.accountState === 'active' ? 'Активен' : m.accountState === 'invited' ? 'Приглашён' : m.accountState === 'no_account' ? 'Нет аккаунта' : 'Без почты'
                  const stateColor =
                    m.accountState === 'active' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : m.accountState === 'invited' ? 'bg-violet-500/15 text-violet-700 dark:text-violet-300' : 'bg-slate-500/15 text-slate-500 dark:text-slate-400'
                  const roleLabel = m.role === 'owner' ? 'Владелец' : m.role === 'manager' ? 'Управляющий' : m.role === 'marketer' ? 'Маркетолог' : 'Сотрудник'
                  return (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-slate-900 dark:text-white">{m.fullName}</p>
                        <p className="truncate text-xs text-slate-400">{m.email || '—'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${stateColor}`}>{stateLabel}</span>
                        <select
                          value={m.role}
                          disabled={mBusy}
                          onChange={(e) => void memberAction({ action: 'setRole', memberId: m.id, role: e.target.value })}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs dark:border-white/10 dark:bg-white/5"
                          title={roleLabel}
                        >
                          <option value="owner">Владелец</option>
                          <option value="manager">Управляющий</option>
                          <option value="marketer">Маркетолог</option>
                          <option value="other">Сотрудник</option>
                        </select>
                        <button
                          type="button"
                          disabled={mBusy}
                          onClick={() => { if (window.confirm(`Удалить ${m.fullName} из организации?`)) void memberAction({ action: 'removeMember', memberId: m.id }) }}
                          className="rounded-lg border border-rose-300 px-2 py-1 text-xs text-rose-600 transition hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10"
                        >
                          Удалить
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ============================ ИСТОРИЯ ============================ */}
      {activeTab === 'history' && (
        <div className={cardCls}>
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Calendar className="h-4 w-4 text-violet-400" />
            История оплат и подписки
          </h2>
          {org.billingEvents && org.billingEvents.length > 0 ? (
            <div className="space-y-1.5">
              {org.billingEvents.map((e, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-white/5 dark:bg-white/[0.02]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-slate-900 dark:text-white">{BILLING_EVENT_LABELS[e.eventType] || e.eventType}</p>
                    <p className="text-[11px] text-slate-500">
                      {e.createdAt ? new Date(e.createdAt).toLocaleString('ru-RU') : '—'}
                    </p>
                  </div>
                  {e.amount ? (
                    <span className="shrink-0 font-medium tabular-nums text-slate-700 dark:text-slate-200">
                      {Number(e.amount).toLocaleString('ru-RU')} {e.currency || '₸'}
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-3 text-sm text-slate-500">
              Событий пока нет. Появятся при действиях над подпиской (оплата, активация, триал…).
            </p>
          )}
        </div>
      )}

      {okMsg && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-emerald-500/30 bg-emerald-600/90 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-black/30">
          ✓ {okMsg}
        </div>
      )}

      {/* Save bar */}
      <div className="mt-6 flex items-center gap-3 border-t border-slate-200 pt-5 dark:border-white/10">
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
