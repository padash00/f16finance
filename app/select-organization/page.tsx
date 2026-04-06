'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  ArrowRight,
  Brain,
  Building2,
  CheckCircle2,
  CreditCard,
  Loader2,
  LogOut,
  PencilLine,
  PlusCircle,
  Settings2,
  ShieldAlert,
  Sparkles,
  Store,
  Users,
} from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { SUBSCRIPTION_FEATURE_BUNDLES } from '@/lib/core/access'
import { buildTenantHost, buildTenantUrl, getTenantBaseHost } from '@/lib/core/tenant-domain'
import { supabase } from '@/lib/supabaseClient'
import type { SessionRoleInfo } from '@/lib/core/types'

type OrganizationItem = NonNullable<SessionRoleInfo['organizations']>[number]
type PlanOption = {
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
type BillingEventItem = {
  id: string
  subscriptionId: string | null
  eventType: string
  status: string | null
  amount: number | null
  currency: string | null
  billingPeriod: string | null
  note: string | null
  createdAt: string
}
type HubOverview = {
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
type OrganizationHubOverview = {
  id: string
  name: string
  slug: string
  primaryDomain: string
  appUrl: string
  legalName: string | null
  status: string
  createdAt: string | null
  companyCount: number
  memberCount: number
  branding: {
    productName: string
    primaryColor: string
    logoUrl: string
  }
  settings: {
    timezone: string
    currency: string
    supportEmail: string
    supportPhone: string
  }
  usage: {
    companies: number
    staff: number
    operators: number
    point_projects: number
  }
  companies: Array<{ id: string; name: string; code: string | null }>
  billingEvents: BillingEventItem[]
  subscription: null | {
    id: string
    status: string
    billingPeriod: string
    startsAt: string | null
    endsAt: string | null
    cancelAt: string | null
    plan: PlanOption | null
  }
}
type OrganizationMember = {
  id: string
  organizationId: string
  staffId: string | null
  userId: string | null
  email: string | null
  role: 'owner' | 'manager' | 'marketer' | 'other'
  status: string
  isDefault: boolean
  fullName: string
  shortName: string | null
  accountState: 'no_email' | 'no_account' | 'invited' | 'active'
  emailConfirmedAt: string | null
  lastSignInAt: string | null
}
type QuickAction = {
  id: string
  label: string
  href: string
  description: string
  icon: any
}
type PlanEditorState = {
  id: string | null
  code: string
  name: string
  description: string
  status: string
  priceMonthly: string
  priceYearly: string
  currency: string
  limits: Record<string, string>
  features: Record<string, boolean>
}

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'dashboard',
    label: 'Открыть панель',
    href: '/dashboard',
    description: 'Зайти в рабочую панель и открыть метрики этой организации.',
    icon: ArrowRight,
  },
  {
    id: 'settings',
    label: 'Настройки',
    href: '/settings',
    description: 'Перейти в системные настройки, справочники и параметры клиента.',
    icon: Settings2,
  },
  {
    id: 'points',
    label: 'Точки и устройства',
    href: '/point-devices',
    description: 'Управлять точками, устройствами и рабочими подключениями.',
    icon: Store,
  },
  {
    id: 'team',
    label: 'Команда',
    href: '/staff',
    description: 'Открыть сотрудников, роли и внутреннюю административную команду.',
    icon: Users,
  },
]

const PLAN_OPTIONS = [
  { value: 'starter', label: 'Старт' },
  { value: 'growth', label: 'Рост' },
  { value: 'enterprise', label: 'Максимум' },
]
const FEATURE_LABELS: Record<string, string> = {
  ai_reports: 'AI-аналитика',
  inventory: 'Склад и остатки',
  web_pos: 'POS и терминал',
  telegram: 'Telegram-боты и отчёты',
  custom_branding: 'White-label и брендинг',
}
const LIMIT_LABELS: Record<string, string> = {
  companies: 'Точки',
  staff: 'Команда',
  operators: 'Операторы',
  point_projects: 'POS проекты',
}
const LIMIT_FIELD_ORDER = ['companies', 'staff', 'operators', 'point_projects'] as const
const BUSINESS_MODEL_OPTIONS = [
  { value: 'club', label: 'Клуб / арена', hint: 'Операторы, смены, касса и KPI по точкам.' },
  { value: 'restaurant', label: 'Общепит', hint: 'Продажи, расходы, кухня, Telegram и учёт.' },
  { value: 'retail', label: 'Ритейл / магазин', hint: 'Склад, остатки, каталог, POS и движение товара.' },
  { value: 'mixed', label: 'Смешанный формат', hint: 'Нужно сразу несколько модулей и гибкие лимиты.' },
] as const
const POINT_SCALE_OPTIONS = [
  { value: '1', label: '1 точка', hint: 'Один объект или одна площадка.' },
  { value: '2-5', label: '2-5 точек', hint: 'Сеть малого масштаба.' },
  { value: '6+', label: '6+ точек', hint: 'Несколько филиалов и рост по сети.' },
] as const
const MEMBER_ROLE_OPTIONS: Array<{ value: OrganizationMember['role']; label: string }> = [
  { value: 'owner', label: 'Владелец' },
  { value: 'manager', label: 'Менеджер' },
  { value: 'marketer', label: 'Маркетолог' },
  { value: 'other', label: 'Другое' },
]

const CYRILLIC_TO_LATIN_MAP: Record<string, string> = {
  а: 'a',
  ә: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  ғ: 'g',
  д: 'd',
  е: 'e',
  ё: 'e',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'i',
  к: 'k',
  қ: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  ң: 'n',
  о: 'o',
  ө: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ұ: 'u',
  ү: 'u',
  ф: 'f',
  х: 'h',
  һ: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ы: 'y',
  і: 'i',
  э: 'e',
  ю: 'yu',
  я: 'ya',
  ь: '',
  ъ: '',
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .split('')
    .map((char) => CYRILLIC_TO_LATIN_MAP[char] ?? char)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

function isSafeInternalPath(value: string | null) {
  return !!value && value.startsWith('/') && !value.startsWith('//') && value !== '/select-organization'
}

function getRecommendedPlanCode(params: {
  pointScale: string
  needAi: boolean
  needInventory: boolean
  needPos: boolean
  needTelegram: boolean
  businessModel: string
}) {
  const { pointScale, needAi, needInventory, needPos, needTelegram, businessModel } = params

  if (needPos || pointScale === '6+' || businessModel === 'mixed') {
    return 'enterprise'
  }

  if (needAi || needInventory || needTelegram || pointScale === '2-5' || businessModel === 'retail') {
    return 'growth'
  }

  return 'starter'
}

function getPlanPrice(plan: PlanOption | null, period: 'monthly' | 'yearly' = 'monthly') {
  if (!plan) return null
  const value = period === 'yearly' ? plan.priceYearly : plan.priceMonthly
  if (typeof value !== 'number') return null
  return new Intl.NumberFormat('ru-RU').format(value)
}

function formatPlanName(plan: Pick<PlanOption, 'code' | 'name'> | null | undefined) {
  if (!plan) return 'Не задан'

  const labels: Record<string, string> = {
    starter: 'Старт',
    growth: 'Рост',
    enterprise: 'Максимум',
  }

  return labels[String(plan.code || '')] || plan.name || 'Не задан'
}

function getEnabledFeatureLabels(features: Record<string, unknown> | null | undefined) {
  return Object.entries(features || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([feature]) => FEATURE_LABELS[feature] || feature)
}

function formatMoney(value: number | null | undefined, currency = 'KZT') {
  if (typeof value !== 'number' || Number.isNaN(value)) return '0'
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(value: string | null | undefined) {
  if (!value) return 'Не задано'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Не задано'
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

function getDaysUntil(dateValue: string | null | undefined) {
  if (!dateValue) return null
  const parsed = new Date(dateValue)
  if (Number.isNaN(parsed.getTime())) return null
  const diff = parsed.getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function getBillingEventLabel(eventType: string) {
  const labels: Record<string, string> = {
    trial_started: 'Старт пробного периода',
    subscription_activated: 'Активация',
    payment_recorded: 'Оплата',
    subscription_past_due: 'Просрочка',
    subscription_cancel_scheduled: 'Отмена в конце периода',
    subscription_canceled: 'Подписка отменена',
    subscription_resumed: 'Подписка возобновлена',
    subscription_renewed: 'Продление',
    plan_changed: 'Смена тарифа',
    subscription_updated: 'Ручное обновление',
  }

  return labels[eventType] || eventType
}

function formatSubscriptionStatus(value: string | null | undefined) {
  const labels: Record<string, string> = {
    active: 'Активна',
    trialing: 'Пробный период',
    past_due: 'Просрочена',
    canceled: 'Отменена',
    expired: 'Истекла',
    invited: 'Приглашён',
    inactive: 'Неактивен',
    not_set: 'Не настроена',
  }

  return labels[String(value || '')] || String(value || 'Не задан')
}

function formatOrganizationStatus(value: string | null | undefined) {
  const labels: Record<string, string> = {
    active: 'Активна',
    trial: 'Тестовый режим',
    suspended: 'Приостановлена',
    archived: 'В архиве',
  }

  return labels[String(value || '')] || String(value || 'Не задан')
}

function formatBillingPeriod(value: string | null | undefined) {
  const labels: Record<string, string> = {
    monthly: 'Ежемесячно',
    yearly: 'Ежегодно',
    custom: 'Особый период',
  }

  return labels[String(value || '')] || String(value || 'Не задан')
}

function formatAccessRole(value: string | null | undefined) {
  const labels: Record<string, string> = {
    super_admin: 'Супер-админ',
    owner: 'Владелец',
    manager: 'Менеджер',
    marketer: 'Маркетолог',
    operator: 'Оператор',
    customer: 'Гость',
    other: 'Участник',
  }

  return labels[String(value || '')] || String(value || 'Участник')
}

function formatAccountState(value: string | null | undefined) {
  const labels: Record<string, string> = {
    no_email: 'Нет email',
    no_account: 'Нет аккаунта',
    invited: 'Приглашён',
    active: 'Активен',
  }

  return labels[String(value || '')] || String(value || 'Неизвестно')
}

function formatPlanEditorStatus(value: string | null | undefined) {
  const labels: Record<string, string> = {
    active: 'Активный',
    archived: 'Архивный',
  }

  return labels[String(value || '')] || String(value || 'Не задан')
}

function createEmptyPlanEditor(): PlanEditorState {
  return {
    id: null,
    code: '',
    name: '',
    description: '',
    status: 'active',
    priceMonthly: '',
    priceYearly: '',
    currency: 'KZT',
    limits: Object.fromEntries(LIMIT_FIELD_ORDER.map((key) => [key, ''])) as Record<string, string>,
    features: Object.fromEntries(SUBSCRIPTION_FEATURE_BUNDLES.map((bundle) => [bundle.feature, false])) as Record<string, boolean>,
  }
}

function SelectOrganizationContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(true)
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [organizations, setOrganizations] = useState<OrganizationItem[]>([])
  const [activeOrganization, setActiveOrganization] = useState<SessionRoleInfo['activeOrganization']>(null)
  const [organizationHubRequired, setOrganizationHubRequired] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [staffRole, setStaffRole] = useState<SessionRoleInfo['staffRole'] | null>(null)
  const [hubOrganizations, setHubOrganizations] = useState<OrganizationHubOverview[]>([])
  const [plans, setPlans] = useState<PlanOption[]>([])
  const [hubOverview, setHubOverview] = useState<HubOverview | null>(null)
  const [loadingHub, setLoadingHub] = useState(false)
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [savingPlan, setSavingPlan] = useState(false)
  const [runningBillingAction, setRunningBillingAction] = useState(false)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [defaultPath, setDefaultPath] = useState('/')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [creatingOrganization, setCreatingOrganization] = useState(false)
  const [creatingCompany, setCreatingCompany] = useState(false)
  const [savingOrganization, setSavingOrganization] = useState(false)
  const [invitingMember, setInvitingMember] = useState(false)
  const [createOrganizationTab, setCreateOrganizationTab] = useState<'smart' | 'quick'>('smart')
  const [organizationName, setOrganizationName] = useState('')
  const [organizationSlug, setOrganizationSlug] = useState('')
  const [organizationLegalName, setOrganizationLegalName] = useState('')
  const [organizationPlanCode, setOrganizationPlanCode] = useState('starter')
  const [organizationTrialDays, setOrganizationTrialDays] = useState('14')
  const [firstCompanyName, setFirstCompanyName] = useState('')
  const [organizationBusinessModel, setOrganizationBusinessModel] = useState<(typeof BUSINESS_MODEL_OPTIONS)[number]['value']>('club')
  const [organizationPointScale, setOrganizationPointScale] = useState<(typeof POINT_SCALE_OPTIONS)[number]['value']>('1')
  const [organizationNeedAi, setOrganizationNeedAi] = useState(false)
  const [organizationNeedInventory, setOrganizationNeedInventory] = useState(false)
  const [organizationNeedPos, setOrganizationNeedPos] = useState(false)
  const [organizationNeedTelegram, setOrganizationNeedTelegram] = useState(false)
  const [organizationPlanManual, setOrganizationPlanManual] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [companyCode, setCompanyCode] = useState('')
  const [editOrganizationName, setEditOrganizationName] = useState('')
  const [editOrganizationSlug, setEditOrganizationSlug] = useState('')
  const [editOrganizationLegalName, setEditOrganizationLegalName] = useState('')
  const [editProductName, setEditProductName] = useState('')
  const [editPrimaryColor, setEditPrimaryColor] = useState('')
  const [editLogoUrl, setEditLogoUrl] = useState('')
  const [editTimezone, setEditTimezone] = useState('Asia/Qyzylorda')
  const [editCurrency, setEditCurrency] = useState('KZT')
  const [editSupportEmail, setEditSupportEmail] = useState('')
  const [editSupportPhone, setEditSupportPhone] = useState('')
  const [editOrganizationStatus, setEditOrganizationStatus] = useState('active')
  const [editPlanCode, setEditPlanCode] = useState('starter')
  const [editSubscriptionStatus, setEditSubscriptionStatus] = useState('active')
  const [editBillingPeriod, setEditBillingPeriod] = useState('monthly')
  const [editSubscriptionEndsAt, setEditSubscriptionEndsAt] = useState('')
  const [editCancelAt, setEditCancelAt] = useState('')
  const [billingNote, setBillingNote] = useState('')
  const [billingAmount, setBillingAmount] = useState('')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrganizationMember['role']>('manager')
  const [planEditor, setPlanEditor] = useState<PlanEditorState>(() => createEmptyPlanEditor())

  const nextPath = useMemo(() => {
    const next = searchParams.get('next')
    return isSafeInternalPath(next) ? next : null
  }, [searchParams])

  const refreshHubData = async () => {
    setLoadingHub(true)
    try {
      const response = await fetch('/api/admin/organizations', { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || 'Не удалось загрузить SaaS-кабинет.')
      }
      setHubOrganizations(Array.isArray(json?.organizations) ? json.organizations : [])
      setPlans(Array.isArray(json?.plans) ? json.plans : [])
      setHubOverview(json?.overview || null)
    } finally {
      setLoadingHub(false)
    }
  }

  const refreshOrganizationMembers = async (organizationId?: string | null) => {
    const resolvedOrganizationId = String(organizationId || activeOrganizationId || '').trim()
    if (!resolvedOrganizationId) {
      setOrganizationMembers([])
      return
    }

    setLoadingMembers(true)
    try {
      const response = await fetch(`/api/admin/organization-members?organizationId=${encodeURIComponent(resolvedOrganizationId)}`, {
        cache: 'no-store',
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || 'Не удалось загрузить участников организации.')
      }
      setOrganizationMembers(Array.isArray(json?.items) ? json.items : [])
    } finally {
      setLoadingMembers(false)
    }
  }

  useEffect(() => {
    let active = true

    const loadSession = async () => {
      try {
        const response = await fetch('/api/auth/session-role', { cache: 'no-store' })
        const json = await response.json().catch(() => null)

        if (!response.ok) {
          throw new Error(json?.error || 'Не удалось загрузить доступные организации.')
        }

        if (!active) return

        const sessionOrganizations = Array.isArray(json?.organizations) ? json.organizations : []
        setOrganizations(sessionOrganizations)
        setActiveOrganization(json?.activeOrganization || null)
        setOrganizationHubRequired(Boolean(json?.organizationHubRequired))
        setIsSuperAdmin(Boolean(json?.isSuperAdmin))
        setStaffRole((json?.staffRole as SessionRoleInfo['staffRole'] | null) || null)
        const resolvedDefaultPath =
          json?.defaultPath && String(json.defaultPath).startsWith('/') && !String(json.defaultPath).startsWith('//')
            ? String(json.defaultPath)
            : '/'
        setDefaultPath(resolvedDefaultPath)

        if (!json?.isSuperAdmin) {
          const fallbackPath =
            resolvedDefaultPath && resolvedDefaultPath !== '/select-organization' ? resolvedDefaultPath : '/dashboard'
          router.replace(fallbackPath)
          router.refresh()
          return
        }

        try {
          const hubResponse = await fetch('/api/admin/organizations', { cache: 'no-store' })
          const hubJson = await hubResponse.json().catch(() => null)
          if (active && hubResponse.ok) {
            setHubOrganizations(Array.isArray(hubJson?.organizations) ? hubJson.organizations : [])
            setPlans(Array.isArray(hubJson?.plans) ? hubJson.plans : [])
            setHubOverview(hubJson?.overview || null)
          }
        } catch {}
        if (json?.activeOrganization?.id) {
          try {
            const membersResponse = await fetch(
              `/api/admin/organization-members?organizationId=${encodeURIComponent(String(json.activeOrganization.id))}`,
              { cache: 'no-store' },
            )
            const membersJson = await membersResponse.json().catch(() => null)
            if (active && membersResponse.ok) {
              setOrganizationMembers(Array.isArray(membersJson?.items) ? membersJson.items : [])
            }
          } catch {}
        }
      } catch (err: any) {
        if (!active) return
        setError(err?.message || 'Не удалось загрузить организации.')
      } finally {
        if (active) {
          setLoading(false)
          setSwitchingId(null)
        }
      }
    }

    loadSession()
    return () => {
      active = false
    }
  }, [nextPath, router])

  const handleSelectOrganization = async (organizationId: string, navigateTo?: string | null) => {
    if (!organizationId) return

    try {
      setError(null)
      setSuccess(null)
      setSwitchingId(organizationId)

      const response = await fetch('/api/auth/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error || 'Не удалось переключить организацию.')
      }

      setActiveOrganization(body?.activeOrganization || null)
      await refreshOrganizationMembers(organizationId)
      if (navigateTo && isSafeInternalPath(navigateTo)) {
        router.replace(navigateTo)
        router.refresh()
        return
      }

      if (nextPath) {
        router.replace(nextPath)
        router.refresh()
      }
    } catch (err: any) {
      setError(err?.message || 'Не удалось выбрать организацию.')
    } finally {
      setSwitchingId(null)
    }
  }

  const handleSignOut = async () => {
    await supabase.auth.signOut().catch(() => null)
    router.replace('/login')
    router.refresh()
  }

  const activeOrganizationId = activeOrganization?.id || null
  const activeOrganizationLabel = activeOrganization?.name || 'Организация пока не выбрана'
  const canCreateOrganizations = isSuperAdmin
  const canCreateCompanies = isSuperAdmin || staffRole === 'owner'
  const canInviteMembers = isSuperAdmin || staffRole === 'owner'
  const workspaceBaseHost = getTenantBaseHost()
  const suggestedWorkspaceHost = buildTenantHost(organizationSlug || 'company-slug')
  const suggestedWorkspaceUrl = buildTenantUrl(organizationSlug || 'company-slug')
  const activeOrganizationDetails = useMemo(
    () => hubOrganizations.find((organization) => organization.id === activeOrganizationId) || null,
    [activeOrganizationId, hubOrganizations],
  )
  const availablePlanOptions = plans.length ? plans : PLAN_OPTIONS.map((plan) => ({
    id: plan.value,
    code: plan.value,
    name: plan.label,
    description: null,
    status: 'active',
    priceMonthly: null,
    priceYearly: null,
    currency: 'KZT',
    limits: {},
    features: {},
  }))
  const selectedManagedPlan = useMemo(
    () => availablePlanOptions.find((plan) => plan.id === selectedPlanId || plan.code === selectedPlanId) || null,
    [availablePlanOptions, selectedPlanId],
  )
  const recommendedPlanCode = useMemo(
    () =>
      getRecommendedPlanCode({
        pointScale: organizationPointScale,
        needAi: organizationNeedAi,
        needInventory: organizationNeedInventory,
        needPos: organizationNeedPos,
        needTelegram: organizationNeedTelegram,
        businessModel: organizationBusinessModel,
      }),
    [
      organizationBusinessModel,
      organizationNeedAi,
      organizationNeedInventory,
      organizationNeedPos,
      organizationNeedTelegram,
      organizationPointScale,
    ],
  )
  const selectedCreatePlan = useMemo(
    () => availablePlanOptions.find((plan) => plan.code === organizationPlanCode) || availablePlanOptions[0] || null,
    [availablePlanOptions, organizationPlanCode],
  )
  const recommendedCreatePlan = useMemo(
    () => availablePlanOptions.find((plan) => plan.code === recommendedPlanCode) || null,
    [availablePlanOptions, recommendedPlanCode],
  )
  const suggestedFirstCompanyName = useMemo(() => {
    const baseName = organizationName.trim()
    if (!baseName) return ''
    if (organizationBusinessModel === 'retail') return `${baseName} Магазин`
    if (organizationBusinessModel === 'restaurant') return `${baseName} Кухня`
    if (organizationPointScale === '1') return baseName
    return `${baseName} Central`
  }, [organizationBusinessModel, organizationName, organizationPointScale])
  const selectedPlanFeatureLabels = useMemo(
    () => getEnabledFeatureLabels(selectedCreatePlan?.features || {}),
    [selectedCreatePlan],
  )
  const selectedCreatePlanBundles = useMemo(
    () => {
      const features = (selectedCreatePlan?.features || {}) as Record<string, unknown>
      return SUBSCRIPTION_FEATURE_BUNDLES.filter((bundle) => Boolean(features[bundle.feature]))
    },
    [selectedCreatePlan],
  )
  const selectedBusinessModel = useMemo(
    () => BUSINESS_MODEL_OPTIONS.find((option) => option.value === organizationBusinessModel) || null,
    [organizationBusinessModel],
  )
  const selectedPointScale = useMemo(
    () => POINT_SCALE_OPTIONS.find((option) => option.value === organizationPointScale) || null,
    [organizationPointScale],
  )
  const activeLimitEntries = useMemo(() => {
    const usage = activeOrganizationDetails?.usage
    const limits = ((activeOrganizationDetails?.subscription?.plan?.limits || {}) as Record<string, unknown>)
    if (!usage) return []

    return Object.entries(usage).map(([key, used]) => {
      const rawLimit = limits[key]
      const numericLimit = typeof rawLimit === 'number' ? rawLimit : typeof rawLimit === 'string' ? Number(rawLimit) : null
      const limit = Number.isFinite(numericLimit as number) ? Number(numericLimit) : null
      const isNearLimit = limit !== null && used >= Math.max(1, limit - 1)
      const isOverLimit = limit !== null && used > limit
      return {
        key,
        label: LIMIT_LABELS[key] || key,
        used,
        limit,
        isNearLimit,
        isOverLimit,
      }
    })
  }, [activeOrganizationDetails])
  const subscriptionDeadlineDays = useMemo(
    () => getDaysUntil(activeOrganizationDetails?.subscription?.endsAt),
    [activeOrganizationDetails],
  )
  const cancelDeadlineDays = useMemo(
    () => getDaysUntil(activeOrganizationDetails?.subscription?.cancelAt),
    [activeOrganizationDetails],
  )
  const onboardingChecklist = useMemo(() => {
    if (!activeOrganizationDetails) return []

    const items = [
      {
        id: 'company',
        label: 'Добавить хотя бы одну точку',
        done: activeOrganizationDetails.companies.length > 0,
      },
      {
        id: 'branding',
        label: 'Заполнить бренд кабинета',
        done:
          Boolean(activeOrganizationDetails.branding?.productName?.trim()) &&
          Boolean(activeOrganizationDetails.branding?.primaryColor?.trim()),
      },
      {
        id: 'support',
        label: 'Указать email поддержки',
        done: Boolean(activeOrganizationDetails.settings?.supportEmail?.trim()),
      },
      {
        id: 'team',
        label: 'Пригласить команду',
        done: organizationMembers.length > 1,
      },
      {
        id: 'subscription',
        label: 'Довести подписку до активного статуса',
        done: activeOrganizationDetails.subscription?.status === 'active',
      },
    ]

    return items
  }, [activeOrganizationDetails, organizationMembers])
  const onboardingReadyCount = onboardingChecklist.filter((item) => item.done).length

  useEffect(() => {
    if (!activeOrganizationDetails) return
    setEditOrganizationName(activeOrganizationDetails.name || '')
    setEditOrganizationSlug(activeOrganizationDetails.slug || '')
    setEditOrganizationLegalName(activeOrganizationDetails.legalName || '')
    setEditProductName(activeOrganizationDetails.branding?.productName || activeOrganizationDetails.name || '')
    setEditPrimaryColor(activeOrganizationDetails.branding?.primaryColor || '')
    setEditLogoUrl(activeOrganizationDetails.branding?.logoUrl || '')
    setEditTimezone(activeOrganizationDetails.settings?.timezone || 'Asia/Qyzylorda')
    setEditCurrency(activeOrganizationDetails.settings?.currency || 'KZT')
    setEditSupportEmail(activeOrganizationDetails.settings?.supportEmail || '')
    setEditSupportPhone(activeOrganizationDetails.settings?.supportPhone || '')
    setEditOrganizationStatus(activeOrganizationDetails.status || 'active')
    setEditPlanCode(activeOrganizationDetails.subscription?.plan?.code || 'starter')
    setEditSubscriptionStatus(activeOrganizationDetails.subscription?.status || 'active')
    setEditBillingPeriod(activeOrganizationDetails.subscription?.billingPeriod || 'monthly')
    setEditSubscriptionEndsAt(
      activeOrganizationDetails.subscription?.endsAt
        ? new Date(activeOrganizationDetails.subscription.endsAt).toISOString().slice(0, 10)
        : '',
    )
    setEditCancelAt(
      activeOrganizationDetails.subscription?.cancelAt
        ? new Date(activeOrganizationDetails.subscription.cancelAt).toISOString().slice(0, 10)
        : '',
    )
  }, [activeOrganizationDetails])

  useEffect(() => {
    if (!organizationPlanManual) {
      setOrganizationPlanCode(recommendedPlanCode)
    }
  }, [organizationPlanManual, recommendedPlanCode])

  useEffect(() => {
    if (!isSuperAdmin) return
    if (selectedPlanId) return
    if (!availablePlanOptions.length) return
    setSelectedPlanId(availablePlanOptions[0].id)
  }, [availablePlanOptions, isSuperAdmin, selectedPlanId])

  useEffect(() => {
    if (!isSuperAdmin) return
    if (!selectedManagedPlan) {
      setPlanEditor(createEmptyPlanEditor())
      return
    }

    setPlanEditor({
      id: selectedManagedPlan.id,
      code: selectedManagedPlan.code,
      name: selectedManagedPlan.name,
      description: selectedManagedPlan.description || '',
      status: selectedManagedPlan.status || 'active',
      priceMonthly: selectedManagedPlan.priceMonthly === null ? '' : String(selectedManagedPlan.priceMonthly),
      priceYearly: selectedManagedPlan.priceYearly === null ? '' : String(selectedManagedPlan.priceYearly),
      currency: selectedManagedPlan.currency || 'KZT',
      limits: Object.fromEntries(
        LIMIT_FIELD_ORDER.map((key) => {
          const limits = (selectedManagedPlan.limits || {}) as Record<string, unknown>
          return [key, limits[key] === undefined ? '' : String(limits[key])]
        }),
      ) as Record<string, string>,
      features: Object.fromEntries(
        SUBSCRIPTION_FEATURE_BUNDLES.map((bundle) => {
          const features = (selectedManagedPlan.features || {}) as Record<string, unknown>
          return [bundle.feature, Boolean(features[bundle.feature])]
        }),
      ) as Record<string, boolean>,
    })
  }, [isSuperAdmin, selectedManagedPlan])

  const handleCreateOrganization = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedName = organizationName.trim()
    const trimmedSlug = slugify(organizationSlug || organizationName)
    const trimmedFirstCompanyName = firstCompanyName.trim()

    if (!trimmedName) {
      setError('Укажи название новой организации.')
      return
    }

    if (!trimmedSlug) {
      setError('Укажи slug латиницей или название, из которого можно собрать slug.')
      return
    }

    try {
      setCreatingOrganization(true)
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/admin/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          slug: trimmedSlug,
          legalName: organizationLegalName.trim() || null,
          planCode: organizationPlanCode,
          trialDays: Number(organizationTrialDays) || 14,
        }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok || !body?.organization?.id) {
        throw new Error(body?.error || 'Не удалось создать организацию.')
      }

      const organizationId = String(body.organization.id)

      const activateResponse = await fetch('/api/auth/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })

      if (!activateResponse.ok) {
        const activateBody = await activateResponse.json().catch(() => null)
        throw new Error(activateBody?.error || 'Организация создана, но не удалось сделать её активной.')
      }

      if (trimmedFirstCompanyName) {
        const companyResponse = await fetch('/api/admin/companies', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: trimmedFirstCompanyName,
            organizationId,
          }),
        })

        const companyBody = await companyResponse.json().catch(() => null)
        if (!companyResponse.ok) {
          throw new Error(companyBody?.error || 'Организация создана, но не удалось добавить первую точку.')
        }
      }

      setOrganizationName('')
      setOrganizationSlug('')
      setOrganizationLegalName('')
      setOrganizationPlanCode('starter')
      setOrganizationTrialDays('14')
      setFirstCompanyName('')
      setOrganizationBusinessModel('club')
      setOrganizationPointScale('1')
      setOrganizationNeedAi(false)
      setOrganizationNeedInventory(false)
      setOrganizationNeedPos(false)
      setOrganizationNeedTelegram(false)
      setOrganizationPlanManual(false)
      setCreateOrganizationTab('smart')
      setSuccess(
        `Организация "${body.organization.name}" создана. Рабочий адрес: ${body?.organization?.primaryDomain || buildTenantHost(body.organization.slug)}.`,
      )
      await refreshHubData()
      await refreshOrganizationMembers(organizationId)
      await handleSelectOrganization(organizationId)
      router.refresh()
    } catch (err: any) {
      setError(err?.message || 'Не удалось создать организацию.')
    } finally {
      setCreatingOrganization(false)
    }
  }

  const handleCreateCompany = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!activeOrganizationId) {
      setError('Сначала выбери активную организацию.')
      return
    }

    if (!companyName.trim()) {
      setError('Укажи название точки.')
      return
    }

    try {
      setCreatingCompany(true)
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/admin/companies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: companyName.trim(),
          code: companyCode.trim() || null,
          organizationId: activeOrganizationId,
        }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error || 'Не удалось создать точку.')
      }

      setCompanyName('')
      setCompanyCode('')
      setSuccess(`Точка "${body?.company?.name || 'Новая точка'}" добавлена в организацию "${activeOrganizationLabel}".`)
      await refreshHubData()
    } catch (err: any) {
      setError(err?.message || 'Не удалось создать точку.')
    } finally {
      setCreatingCompany(false)
    }
  }

  const handleSaveOrganization = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!activeOrganizationId) {
      setError('Сначала выбери активную организацию.')
      return
    }

    if (!editOrganizationName.trim()) {
      setError('Название организации не может быть пустым.')
      return
    }

    try {
      setSavingOrganization(true)
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: activeOrganizationId,
          name: editOrganizationName.trim(),
          legalName: editOrganizationLegalName.trim() || null,
          productName: editProductName.trim() || null,
          primaryColor: editPrimaryColor.trim() || null,
          logoUrl: editLogoUrl.trim() || null,
          timezone: editTimezone.trim() || null,
          currency: editCurrency.trim() || null,
          supportEmail: editSupportEmail.trim() || null,
          supportPhone: editSupportPhone.trim() || null,
          slug: editOrganizationSlug.trim() || null,
          organizationStatus: editOrganizationStatus,
          planCode: editPlanCode,
          subscriptionStatus: editSubscriptionStatus,
          billingPeriod: editBillingPeriod,
          subscriptionEndsAt: editSubscriptionEndsAt || null,
          cancelAt: editCancelAt || null,
        }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error || 'Не удалось обновить организацию.')
      }

      if (body?.organization) {
        setHubOrganizations((current) =>
          current.map((organization) => (organization.id === activeOrganizationId ? body.organization : organization)),
        )
      } else {
        await refreshHubData()
      }

      setSuccess(`Организация "${editOrganizationName.trim()}" обновлена.`)
      setActiveOrganization((current) =>
        current?.id === activeOrganizationId
          ? {
              ...current,
              name: editOrganizationName.trim(),
              slug: editOrganizationSlug.trim() || current.slug,
              status: editOrganizationStatus,
            }
          : current,
      )
      await refreshHubData()
    } catch (err: any) {
      setError(err?.message || 'Не удалось обновить организацию.')
    } finally {
      setSavingOrganization(false)
    }
  }

  const handleSubscriptionAction = async (
    action: 'startTrial' | 'activate' | 'recordPayment' | 'markPastDue' | 'cancelAtPeriodEnd' | 'cancelNow' | 'resume' | 'renewCycle',
  ) => {
    if (!activeOrganizationId) {
      setError('Сначала выбери активную организацию.')
      return
    }

    try {
      setRunningBillingAction(true)
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/admin/organizations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationId: activeOrganizationId,
          subscriptionAction: action,
          planCode: editPlanCode,
          billingPeriod: editBillingPeriod,
          billingNote: billingNote.trim() || null,
          invoiceAmount: billingAmount.trim() ? Number(billingAmount) : null,
          trialDays: Number(organizationTrialDays) || 14,
        }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error || 'Не удалось выполнить действие по подписке.')
      }

      setBillingNote('')
      if (action === 'recordPayment' || action === 'renewCycle') {
        setBillingAmount('')
      }
      await refreshHubData()
      setSuccess('Действие по подписке выполнено.')
    } catch (err: any) {
      setError(err?.message || 'Не удалось выполнить действие по подписке.')
    } finally {
      setRunningBillingAction(false)
    }
  }

  const handleInviteMember = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!activeOrganizationId) {
      setError('Сначала выбери активную организацию.')
      return
    }

    if (!inviteFullName.trim()) {
      setError('Укажи имя сотрудника.')
      return
    }

    if (!inviteEmail.trim()) {
      setError('Укажи email сотрудника.')
      return
    }

    try {
      setInvitingMember(true)
      setError(null)
      setSuccess(null)

      const response = await fetch('/api/admin/organization-members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inviteMember',
          organizationId: activeOrganizationId,
          fullName: inviteFullName.trim(),
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error || 'Не удалось отправить приглашение.')
      }

      setInviteFullName('')
      setInviteEmail('')
      setInviteRole('manager')
      setSuccess(body?.message || `Приглашение отправлено на ${inviteEmail.trim()}.`)
      await refreshOrganizationMembers(activeOrganizationId)
    } catch (err: any) {
      setError(err?.message || 'Не удалось отправить приглашение.')
    } finally {
      setInvitingMember(false)
    }
  }

  const handleCreatePlanDraft = () => {
    setSelectedPlanId('__new__')
    setPlanEditor(createEmptyPlanEditor())
    setSuccess(null)
    setError(null)
  }

  const handleSavePlan = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!isSuperAdmin) {
      setError('Тарифами сейчас может управлять только супер-админ.')
      return
    }

    if (!planEditor.name.trim()) {
      setError('Укажи название тарифа.')
      return
    }

    if (!planEditor.code.trim()) {
      setError('Укажи код тарифа.')
      return
    }

    try {
      setSavingPlan(true)
      setError(null)
      setSuccess(null)

      const payload = {
        action: planEditor.id ? 'updatePlan' : 'createPlan',
        planId: planEditor.id,
        code: planEditor.code.trim(),
        name: planEditor.name.trim(),
        description: planEditor.description.trim() || null,
        status: planEditor.status,
        priceMonthly: planEditor.priceMonthly.trim() ? Number(planEditor.priceMonthly) : null,
        priceYearly: planEditor.priceYearly.trim() ? Number(planEditor.priceYearly) : null,
        currency: planEditor.currency.trim() || 'KZT',
        limits: Object.fromEntries(
          Object.entries(planEditor.limits).map(([key, value]) => [key, value.trim() ? Number(value) : null]),
        ),
        features: planEditor.features,
      }

      const response = await fetch('/api/admin/subscription-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      const body = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(body?.error || 'Не удалось сохранить тариф.')
      }

      await refreshHubData()
      const nextPlanId = String(body?.planId || '')
      setSelectedPlanId(nextPlanId || null)
      setSuccess(planEditor.id ? `Тариф "${planEditor.name}" обновлён.` : `Тариф "${planEditor.name}" создан.`)
    } catch (err: any) {
      setError(err?.message || 'Не удалось сохранить тариф.')
    } finally {
      setSavingPlan(false)
    }
  }

  if (!loading && !isSuperAdmin) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6">
        <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
          <Card className="w-full border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl">
            <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
              <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
              Перенаправляем в вашу организацию...
            </div>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-6">
      <div className="mx-auto w-full max-w-[1760px]">
        <div className="grid w-full gap-6 xl:grid-cols-[380px_minmax(0,1fr)]">
          <Card className="hidden self-start border-white/10 bg-slate-950/60 p-8 text-white backdrop-blur-xl xl:sticky xl:top-6 xl:block">
            <div className="flex h-full min-h-[calc(100vh-3rem)] flex-col justify-between">
              <div>
                <div className="mb-6 inline-flex rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-500 p-4 shadow-lg shadow-sky-500/20">
                  <Brain className="h-8 w-8 text-white" />
                </div>
                <h1 className="max-w-none text-4xl font-semibold leading-tight text-white">
                  Выберите проект, клиента или организацию, в которой хотите работать сейчас.
                </h1>
                <p className="mt-4 max-w-none text-sm leading-6 text-slate-300">
                  После выбора система зафиксирует контекст организации и откроет только данные, точки, отчёты и людей этой организации.
                </p>
              </div>

              <div className="space-y-3">
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                  Теперь вход идёт сначала сюда, даже если у вас пока только один клиент.
                </div>
                <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 text-sm text-slate-300">
                  Здесь можно выбрать, какой проект открыть: панель, настройки, точки или команду.
                </div>
              </div>
            </div>
          </Card>

          <Card className="min-h-[calc(100vh-1.5rem)] border-white/10 bg-slate-950/70 p-5 text-white backdrop-blur-xl sm:p-6 xl:min-h-[calc(100vh-3rem)] xl:p-8">
            <div className="mb-5 flex items-center gap-3">
              <div className="rounded-2xl bg-sky-500/10 p-3">
                <Building2 className="h-6 w-6 text-sky-400" />
              </div>
              <div>
                <h1 className="text-lg font-semibold">Выбор проекта</h1>
                <p className="text-sm text-slate-400">Сначала выберите организацию, затем откройте нужный раздел.</p>
              </div>
            </div>

            {loading ? (
              <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-300">
                <Loader2 className="h-4 w-4 animate-spin text-sky-400" />
                Загружаем организации...
              </div>
            ) : organizations.length === 0 && !canCreateOrganizations ? (
              <div className="space-y-4">
                <div className="rounded-3xl border border-sky-500/20 bg-sky-500/10 p-5">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="rounded-2xl bg-sky-500/10 p-3">
                      <Sparkles className="h-5 w-5 text-sky-300" />
                    </div>
                    <div>
                      <h2 className="text-base font-semibold text-white">Создайте первую организацию</h2>
                      <p className="text-sm text-slate-300">
                        Это ваш стартовый SaaS-контур. После создания появится отдельное рабочее пространство, тариф и адрес клиента.
                      </p>
                    </div>
                  </div>
                  <div className="grid gap-2 text-sm text-slate-300 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Шаг 1</div>
                      <div className="mt-1 font-medium text-white">Название и slug</div>
                      <div className="mt-1 text-xs text-slate-400">Из этого сразу собирается адрес клиента.</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Шаг 2</div>
                      <div className="mt-1 font-medium text-white">Тариф и модули</div>
                      <div className="mt-1 text-xs text-slate-400">AI, склад, POS и Telegram на старте.</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Шаг 3</div>
                      <div className="mt-1 font-medium text-white">Поддомен клиента</div>
                      <div className="mt-1 text-xs text-slate-400">Например: `f16.{workspaceBaseHost}`.</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {organizations.length === 0 && canCreateOrganizations ? (
                  <div className="rounded-3xl border border-sky-500/20 bg-sky-500/10 p-5">
                    <div className="mb-3 flex items-center gap-3">
                      <div className="rounded-2xl bg-sky-500/10 p-3">
                        <Sparkles className="h-5 w-5 text-sky-300" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-white">Создайте первую организацию</h2>
                        <p className="text-sm text-slate-300">
                          Начните с названия, slug и стартового тарифа. Система сама подготовит клиентский контур и адрес вида `{suggestedWorkspaceHost}`.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                    {error}
                  </div>
                ) : null}

                {success ? (
                  <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
                    {success}
                  </div>
                ) : null}

                <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                  <span className="font-medium text-white">Текущий контекст:</span>{' '}
                  {activeOrganizationLabel}
                  {organizationHubRequired ? (
                    <span className="ml-2 text-slate-500">Вы сами решаете, куда зайти дальше.</span>
                  ) : null}
                </div>

                {hubOverview ? (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="rounded-2xl bg-emerald-500/10 p-3">
                        <Sparkles className="h-5 w-5 text-emerald-300" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-white">Пульт владельца SaaS</h2>
                        <p className="text-sm text-slate-400">
                          Живой срез по организациям, подпискам и повторяющейся выручке.
                        </p>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
                        <div className="text-slate-500">Организации</div>
                        <div className="mt-1 font-medium text-white">{hubOverview.organizationCount}</div>
                        <div className="mt-1 text-xs text-slate-400">Активных: {hubOverview.activeOrganizationCount}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
                        <div className="text-slate-500">Подписки</div>
                        <div className="mt-1 font-medium text-white">
                          активных {hubOverview.activeSubscriptions} · пробных {hubOverview.trialingSubscriptions}
                        </div>
                        <div className="mt-1 text-xs text-slate-400">просроченных: {hubOverview.pastDueSubscriptions}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
                        <div className="text-slate-500">MRR</div>
                        <div className="mt-1 font-medium text-white">{formatMoney(hubOverview.liveMrr)}</div>
                        <div className="mt-1 text-xs text-slate-400">Потенциал пробного периода: {formatMoney(hubOverview.trialMrr)}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
                        <div className="text-slate-500">Сеть</div>
                        <div className="mt-1 font-medium text-white">
                          {hubOverview.totalCompanies} точек · {hubOverview.totalMembers} участников
                        </div>
                        <div className="mt-1 text-xs text-slate-400">Это общий контур по всем клиентам.</div>
                      </div>
                    </div>
                  </div>
                ) : null}

                {organizations.map((organization) => {
                  const isActive = activeOrganization?.id === organization.id
                  const isBusy = switchingId === organization.id
                  const overview = hubOrganizations.find((item) => item.id === organization.id)
                  const planName = overview?.subscription?.plan ? formatPlanName(overview.subscription.plan) : 'Без тарифа'
                  const subscriptionStatus = overview?.subscription?.status || 'not_set'

                  return (
                    <div
                      key={organization.id}
                      className={`rounded-3xl border px-4 py-4 transition ${
                        isActive
                          ? 'border-sky-500/30 bg-sky-500/10'
                          : 'border-white/10 bg-white/[0.03]'
                      } ${switchingId ? 'opacity-80' : ''}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="truncate text-base font-semibold text-white">{organization.name}</p>
                            {isActive ? (
                              <span className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] uppercase tracking-[0.18em] text-sky-300">
                                Активна
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 truncate text-xs uppercase tracking-[0.18em] text-slate-500">
                            {organization.slug} • {formatAccessRole(organization.accessRole)}
                          </p>
                          <p className="mt-2 truncate text-xs text-slate-400">
                            Рабочий адрес: {overview?.primaryDomain || buildTenantHost(organization.slug)}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                              Тариф: {planName}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                              Статус: {formatSubscriptionStatus(subscriptionStatus)}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                              Точек: {overview?.companyCount ?? 0}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                              Команда: {overview?.memberCount ?? 0}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleSelectOrganization(organization.id)}
                          disabled={!!switchingId}
                          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-white transition hover:border-sky-500/30 hover:bg-slate-950"
                        >
                          {isBusy ? <Loader2 className="h-4 w-4 animate-spin text-sky-400" /> : <ArrowRight className="h-4 w-4" />}
                          {isActive ? 'Оставить активной' : 'Выбрать'}
                        </button>
                      </div>

                      <div className="mt-4 grid gap-2 sm:grid-cols-2">
                        {QUICK_ACTIONS.map((action) => {
                          const ActionIcon = action.icon
                          const disabled = !!switchingId && switchingId !== organization.id
                          const highlighted = isActive && activeOrganizationId === organization.id

                          return (
                            <button
                              key={`${organization.id}-${action.id}`}
                              type="button"
                              disabled={disabled}
                              onClick={() => handleSelectOrganization(organization.id, action.href)}
                              className={`rounded-2xl border px-3 py-3 text-left transition ${
                                highlighted
                                  ? 'border-sky-500/20 bg-slate-950/70'
                                  : 'border-white/10 bg-black/20 hover:border-white/20 hover:bg-black/30'
                              } disabled:cursor-not-allowed disabled:opacity-60`}
                            >
                              <div className="flex items-center gap-2 text-sm font-medium text-white">
                                <ActionIcon className="h-4 w-4 text-sky-300" />
                                {action.label}
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-400">{action.description}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}

                {!nextPath ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-4 text-sm text-slate-400">
                    Если просто хочешь войти в нужный проект, сначала нажми <span className="font-medium text-white">Выбрать</span>, а потом открой панель или настройки.
                  </div>
                ) : null}

                {activeOrganizationDetails ? (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="rounded-2xl bg-sky-500/10 p-3">
                        <PencilLine className="h-5 w-5 text-sky-300" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-white">Управление активной организацией</h2>
                        <p className="text-sm text-slate-400">
                          Редактирование проекта, подписки и текущих лимитов.
                        </p>
                      </div>
                    </div>

                    <div className="mb-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                        <div className="text-slate-500">Текущий тариф</div>
                          <div className="mt-1 font-medium text-white">{formatPlanName(activeOrganizationDetails.subscription?.plan || null)}</div>
                      </div>
                        <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                          <div className="text-slate-500">Статус подписки</div>
                          <div className="mt-1 font-medium text-white">{formatSubscriptionStatus(activeOrganizationDetails.subscription?.status)}</div>
                        </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                        <div className="text-slate-500">Продукт бренда</div>
                        <div className="mt-1 font-medium text-white">{activeOrganizationDetails.branding?.productName || activeOrganizationDetails.name}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                        <div className="text-slate-500">Часовой пояс / валюта</div>
                        <div className="mt-1 font-medium text-white">
                          {(activeOrganizationDetails.settings?.timezone || 'Asia/Qyzylorda')} · {(activeOrganizationDetails.settings?.currency || 'KZT')}
                        </div>
                      </div>
                    </div>

                    <div className="mb-4 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">Подписка и биллинг</div>
                            <div className="text-xs text-slate-500">
                          Управление жизненным циклом подписки, пробным периодом и ручными сценариями оплаты.
                            </div>
                          </div>
                          <Badge variant="outline" className="border-white/10 text-slate-300">
                            {formatSubscriptionStatus(activeOrganizationDetails.subscription?.status || 'not_set')}
                          </Badge>
                        </div>

                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
                            <div className="text-slate-500">Период</div>
                            <div className="mt-1 font-medium text-white">
                              {formatBillingPeriod(activeOrganizationDetails.subscription?.billingPeriod)}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
                            <div className="text-slate-500">Следующая контрольная дата</div>
                            <div className="mt-1 font-medium text-white">
                              {formatDate(activeOrganizationDetails.subscription?.endsAt)}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {subscriptionDeadlineDays === null
                                ? 'Дата не задана'
                                : subscriptionDeadlineDays >= 0
                                  ? `До дедлайна ${subscriptionDeadlineDays} дн.`
                                  : `Просрочка ${Math.abs(subscriptionDeadlineDays)} дн.`}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
                            <div className="text-slate-500">Дата отмены</div>
                            <div className="mt-1 font-medium text-white">
                              {formatDate(activeOrganizationDetails.subscription?.cancelAt)}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {cancelDeadlineDays === null
                                ? 'Отмена не запланирована'
                                : cancelDeadlineDays >= 0
                                  ? `До отмены ${cancelDeadlineDays} дн.`
                                  : 'Дата отмены уже прошла'}
                            </div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm">
                            <div className="text-slate-500">Рекомендация</div>
                            <div className="mt-1 font-medium text-white">
                              {activeOrganizationDetails.subscription?.status === 'past_due'
                                ? 'Срочно провести оплату'
                                : activeOrganizationDetails.subscription?.status === 'trialing'
                                  ? 'Подготовить активацию после пробного периода'
                                  : 'Подписка под контролем'}
                            </div>
                          </div>
                        </div>

                        {isSuperAdmin ? (
                          <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                            <div className="grid gap-3 sm:grid-cols-2">
                              <Input
                                value={billingAmount}
                                onChange={(event) => setBillingAmount(event.target.value)}
                                className="border-white/10 bg-slate-900/60 text-white"
                                placeholder="Сумма оплаты / счета"
                              />
                              <Input
                                value={organizationTrialDays}
                                onChange={(event) => setOrganizationTrialDays(event.target.value)}
                                className="border-white/10 bg-slate-900/60 text-white"
                                placeholder="Дней пробного периода"
                              />
                            </div>
                            <Input
                              value={billingNote}
                              onChange={(event) => setBillingNote(event.target.value)}
                              className="border-white/10 bg-slate-900/60 text-white"
                              placeholder="Комментарий к действию по подписке"
                            />
                            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                              <Button type="button" variant="outline" disabled={runningBillingAction} onClick={() => handleSubscriptionAction('startTrial')}>
                                Запустить пробный период
                              </Button>
                              <Button type="button" variant="outline" disabled={runningBillingAction} onClick={() => handleSubscriptionAction('activate')}>
                                Активировать
                              </Button>
                              <Button type="button" variant="outline" disabled={runningBillingAction} onClick={() => handleSubscriptionAction('recordPayment')}>
                                Зафиксировать оплату
                              </Button>
                              <Button type="button" variant="outline" disabled={runningBillingAction} onClick={() => handleSubscriptionAction('renewCycle')}>
                                Продлить период
                              </Button>
                              <Button type="button" variant="outline" disabled={runningBillingAction} onClick={() => handleSubscriptionAction('markPastDue')}>
                                Отметить просрочку
                              </Button>
                              <Button type="button" variant="outline" disabled={runningBillingAction} onClick={() => handleSubscriptionAction('resume')}>
                                Возобновить
                              </Button>
                              <Button type="button" variant="outline" disabled={runningBillingAction} onClick={() => handleSubscriptionAction('cancelAtPeriodEnd')}>
                                Отменить в конце периода
                              </Button>
                              <Button type="button" variant="outline" disabled={runningBillingAction} onClick={() => handleSubscriptionAction('cancelNow')}>
                                Отменить сейчас
                              </Button>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium text-white">Готовность запуска клиента</div>
                            <div className="text-xs text-slate-500">
                              Что ещё нужно доделать, чтобы организация выглядела как готовый клиентский кабинет.
                            </div>
                          </div>
                          <Badge variant="outline" className="border-white/10 text-slate-300">
                            {onboardingReadyCount}/{onboardingChecklist.length}
                          </Badge>
                        </div>
                        <div className="space-y-2">
                          {onboardingChecklist.map((item) => (
                            <div
                              key={item.id}
                              className={`rounded-2xl border px-3 py-3 text-sm ${
                                item.done
                                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100'
                                  : 'border-white/10 bg-slate-950/60 text-slate-300'
                              }`}
                            >
                              <div className="flex items-center gap-2">
                                <CheckCircle2 className={`h-4 w-4 ${item.done ? 'text-emerald-300' : 'text-slate-500'}`} />
                                {item.label}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="mt-4 rounded-2xl border border-white/10 bg-slate-950/60 p-3">
                          <div className="text-sm font-medium text-white">Последние события биллинга</div>
                          <div className="mt-3 space-y-2">
                            {activeOrganizationDetails.billingEvents.length ? (
                              activeOrganizationDetails.billingEvents.slice(0, 5).map((event) => (
                                <div key={event.id} className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                                  <div className="flex items-center justify-between gap-3">
                                    <div className="font-medium text-white">{getBillingEventLabel(event.eventType)}</div>
                                    <div className="text-xs text-slate-500">{formatDate(event.createdAt)}</div>
                                  </div>
                                  <div className="mt-1 text-xs text-slate-400">
                                    {event.amount !== null ? `${formatMoney(event.amount, event.currency || editCurrency || 'KZT')} · ` : ''}
                                    {event.note || event.status || 'Без комментария'}
                                  </div>
                                </div>
                              ))
                            ) : (
                              <div className="text-sm text-slate-400">История биллинга пока пустая.</div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mb-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div className="text-sm font-medium text-white">Использование и лимиты</div>
                        <div className="text-xs text-slate-500">
                          Всё считается в рамках активной организации
                        </div>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                        {activeLimitEntries.map((entry) => (
                          <div
                            key={entry.key}
                            className={`rounded-2xl border px-3 py-3 text-sm ${
                              entry.isOverLimit
                                ? 'border-red-500/30 bg-red-500/10'
                                : entry.isNearLimit
                                  ? 'border-amber-500/30 bg-amber-500/10'
                                  : 'border-white/10 bg-slate-950/60'
                            }`}
                          >
                            <div className="text-slate-500">{entry.label}</div>
                            <div className="mt-1 font-medium text-white">
                              {entry.used}
                              {entry.limit !== null ? ` / ${entry.limit}` : ' / без лимита'}
                            </div>
                            <div className="mt-1 text-xs text-slate-400">
                              {entry.limit === null
                                ? 'План не ограничивает этот модуль.'
                                : entry.isOverLimit
                                  ? 'Лимит превышен, нужен апгрейд.'
                                  : entry.isNearLimit
                                    ? 'Подходите к лимиту тарифа.'
                                    : 'В пределах тарифа.'}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <form onSubmit={handleSaveOrganization} className="grid gap-3">
                      <Input
                        value={editOrganizationName}
                        onChange={(event) => setEditOrganizationName(event.target.value)}
                        className="border-white/10 bg-slate-900/60 text-white"
                        placeholder="Название организации"
                      />
                      <Input
                        value={editOrganizationLegalName}
                        onChange={(event) => setEditOrganizationLegalName(event.target.value)}
                        className="border-white/10 bg-slate-900/60 text-white"
                        placeholder="Юр. название"
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          value={editProductName}
                          onChange={(event) => setEditProductName(event.target.value)}
                          className="border-white/10 bg-slate-900/60 text-white"
                          placeholder="Название продукта / кабинета"
                        />
                        <Input
                          value={editPrimaryColor}
                          onChange={(event) => setEditPrimaryColor(event.target.value)}
                          className="border-white/10 bg-slate-900/60 text-white"
                          placeholder="Основной цвет, например #D7FF00"
                        />
                      </div>
                      <Input
                        value={editLogoUrl}
                        onChange={(event) => setEditLogoUrl(event.target.value)}
                        className="border-white/10 bg-slate-900/60 text-white"
                        placeholder="URL логотипа, если нужен брендинг"
                      />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          value={editTimezone}
                          onChange={(event) => setEditTimezone(event.target.value)}
                          className="border-white/10 bg-slate-900/60 text-white"
                          placeholder="Часовой пояс, например Asia/Qyzylorda"
                        />
                        <Input
                          value={editCurrency}
                          onChange={(event) => setEditCurrency(event.target.value.toUpperCase())}
                          className="border-white/10 bg-slate-900/60 text-white"
                          placeholder="Валюта, например KZT"
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          value={editSupportEmail}
                          onChange={(event) => setEditSupportEmail(event.target.value)}
                          className="border-white/10 bg-slate-900/60 text-white"
                          placeholder="Email поддержки"
                        />
                        <Input
                          value={editSupportPhone}
                          onChange={(event) => setEditSupportPhone(event.target.value)}
                          className="border-white/10 bg-slate-900/60 text-white"
                          placeholder="Телефон поддержки"
                        />
                      </div>

                      {isSuperAdmin ? (
                        <>
                          <Input
                            value={editOrganizationSlug}
                            onChange={(event) => setEditOrganizationSlug(slugify(event.target.value))}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="slug организации"
                          />
                          <select
                            value={editOrganizationStatus}
                            onChange={(event) => setEditOrganizationStatus(event.target.value)}
                            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                          >
                            <option value="active">Активна</option>
                            <option value="trial">Тестовый режим</option>
                            <option value="suspended">Приостановлена</option>
                            <option value="archived">В архиве</option>
                          </select>
                          <select
                            value={editPlanCode}
                            onChange={(event) => setEditPlanCode(event.target.value)}
                            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                          >
                            {availablePlanOptions.map((plan) => (
                              <option key={plan.code} value={plan.code}>
                                {formatPlanName(plan)} {plan.priceMonthly ? `• ${plan.priceMonthly} ${plan.currency}/мес` : ''}
                              </option>
                            ))}
                          </select>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <select
                              value={editSubscriptionStatus}
                              onChange={(event) => setEditSubscriptionStatus(event.target.value)}
                              className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                            >
                              <option value="trialing">Пробный период</option>
                              <option value="active">Активна</option>
                              <option value="past_due">Просрочена</option>
                              <option value="canceled">Отменена</option>
                              <option value="expired">Истекла</option>
                            </select>
                            <select
                              value={editBillingPeriod}
                              onChange={(event) => setEditBillingPeriod(event.target.value)}
                              className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                            >
                              <option value="monthly">Ежемесячно</option>
                              <option value="yearly">Ежегодно</option>
                              <option value="custom">Особый период</option>
                            </select>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <Input
                              value={editSubscriptionEndsAt}
                              onChange={(event) => setEditSubscriptionEndsAt(event.target.value)}
                              className="border-white/10 bg-slate-900/60 text-white"
                              type="date"
                              placeholder="Дата окончания периода"
                            />
                            <Input
                              value={editCancelAt}
                              onChange={(event) => setEditCancelAt(event.target.value)}
                              className="border-white/10 bg-slate-900/60 text-white"
                              type="date"
                              placeholder="Дата отмены"
                            />
                          </div>
                        </>
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                          Тариф и статус подписки сейчас управляются только из контура супер-админа.
                        </div>
                      )}

                      <Button type="submit" disabled={savingOrganization}>
                        {savingOrganization ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                        Сохранить изменения
                      </Button>
                    </form>

                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-medium text-white">Текущие точки</div>
                      {activeOrganizationDetails.companies.length ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {activeOrganizationDetails.companies.map((company) => (
                            <div key={company.id} className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3">
                              <div className="text-sm font-medium text-white">{company.name}</div>
                              <div className="mt-1 text-xs text-slate-500">{company.code || 'Без кода'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-400">Пока нет ни одной точки. Ниже можно добавить первую.</div>
                      )}
                    </div>

                    {activeOrganizationDetails.subscription?.plan?.limits &&
                    Object.keys(activeOrganizationDetails.subscription.plan.limits).length > 0 ? (
                      <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                        <div className="mb-3 text-sm font-medium text-white">Лимиты текущего плана</div>
                        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                          {Object.entries(activeOrganizationDetails.subscription.plan.limits).map(([key, value]) => (
                            <div key={key} className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{LIMIT_LABELS[key] || key}</div>
                              <div className="mt-1 text-sm font-medium text-white">{String(value)}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
                      <div className="mb-3 text-sm font-medium text-white">Участники организации</div>

                      {canInviteMembers ? (
                        <form onSubmit={handleInviteMember} className="mb-4 grid gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                          <Input
                            value={inviteFullName}
                            onChange={(event) => setInviteFullName(event.target.value)}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Имя сотрудника"
                          />
                          <Input
                            value={inviteEmail}
                            onChange={(event) => setInviteEmail(event.target.value)}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="email сотрудника"
                            type="email"
                          />
                          <select
                            value={inviteRole}
                            onChange={(event) => setInviteRole(event.target.value as OrganizationMember['role'])}
                            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                          >
                            {MEMBER_ROLE_OPTIONS.map((role) => (
                              <option key={role.value} value={role.value}>
                                {role.label}
                              </option>
                            ))}
                          </select>
                          <Button type="submit" disabled={invitingMember}>
                            {invitingMember ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Users className="mr-2 h-4 w-4" />}
                            Пригласить в организацию
                          </Button>
                        </form>
                      ) : (
                        <div className="mb-4 rounded-2xl border border-white/10 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
                          Приглашать участников сейчас может только владелец организации или супер-админ.
                        </div>
                      )}

                      {loadingMembers ? (
                        <div className="text-sm text-slate-400">Загружаем участников...</div>
                      ) : organizationMembers.length ? (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {organizationMembers.map((member) => (
                            <div key={member.id} className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium text-white">{member.fullName}</div>
                                  <div className="truncate text-xs text-slate-500">{member.email || 'Без email'}</div>
                                </div>
                                <div className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-slate-300">
                                  {formatAccessRole(member.role)}
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                                  Статус: {formatSubscriptionStatus(member.status)}
                                </span>
                                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                                  Аккаунт: {formatAccountState(member.accountState)}
                                </span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-sm text-slate-400">Пока никто не приглашён в эту организацию.</div>
                      )}
                    </div>
                  </div>
                ) : null}

                {isSuperAdmin ? (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-4 flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-fuchsia-500/10 p-3">
                          <CreditCard className="h-5 w-5 text-fuchsia-300" />
                        </div>
                        <div>
                          <h2 className="text-base font-semibold text-white">Тарифы и доступ к страницам</h2>
                          <p className="text-sm text-slate-400">
                            Создавай планы, управляй лимитами и настраивай модульный доступ к разделам продукта.
                          </p>
                        </div>
                      </div>
                      <Button type="button" variant="outline" onClick={handleCreatePlanDraft}>
                        <PlusCircle className="mr-2 h-4 w-4" />
                        Новый тариф
                      </Button>
                    </div>

                    <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
                      <div className="space-y-3">
                        {availablePlanOptions.map((plan) => {
                          const enabledLabels = getEnabledFeatureLabels(plan.features || {})
                          const isSelected = selectedManagedPlan?.id === plan.id
                          return (
                            <button
                              key={plan.id}
                              type="button"
                              onClick={() => setSelectedPlanId(plan.id)}
                              className={`w-full rounded-2xl border px-4 py-4 text-left transition ${
                                isSelected
                                  ? 'border-fuchsia-400 bg-fuchsia-500/10'
                                  : 'border-white/10 bg-slate-950/60 hover:border-white/20'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-sm font-semibold text-white">{formatPlanName(plan)}</span>
                                    <Badge variant="outline" className="border-white/10 text-slate-300">
                                      {formatPlanEditorStatus(plan.status)}
                                    </Badge>
                                  </div>
                                  <div className="mt-1 text-xs text-slate-400">{plan.code}</div>
                                </div>
                                <div className="text-right text-xs text-slate-400">
                                  {getPlanPrice(plan, 'monthly') ? (
                                    <>
                                      <div className="text-sm font-medium text-white">{getPlanPrice(plan, 'monthly')} {plan.currency}</div>
                                      <div>/ мес</div>
                                    </>
                                  ) : (
                                    'Без цены'
                                  )}
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                {enabledLabels.length ? (
                                  enabledLabels.map((label) => (
                                    <span key={label} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300">
                                      {label}
                                    </span>
                                  ))
                                ) : (
                                  <span className="text-xs text-slate-500">Платные модули пока не включены</span>
                                )}
                              </div>
                            </button>
                          )
                        })}
                      </div>

                      <form onSubmit={handleSavePlan} className="space-y-4 rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {planEditor.id ? `Редактирование тарифа ${planEditor.name || ''}` : 'Создание нового тарифа'}
                            </div>
                            <div className="text-xs text-slate-400">
                              Наборы функций здесь напрямую влияют на доступ к страницам в системе.
                            </div>
                          </div>
                          {planEditor.id ? (
                            <Badge className="bg-fuchsia-500/10 text-fuchsia-100 hover:bg-fuchsia-500/10">
                              {planEditor.code}
                            </Badge>
                          ) : null}
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <Input
                            value={planEditor.name}
                            onChange={(event) => setPlanEditor((current) => ({ ...current, name: event.target.value }))}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Название тарифа"
                          />
                          <Input
                            value={planEditor.code}
                            onChange={(event) =>
                              setPlanEditor((current) => ({
                                ...current,
                                code: event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'),
                              }))
                            }
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="код-тарифа"
                          />
                        </div>

                        <Input
                          value={planEditor.description}
                          onChange={(event) => setPlanEditor((current) => ({ ...current, description: event.target.value }))}
                          className="border-white/10 bg-slate-900/60 text-white"
                          placeholder="Краткое описание тарифа"
                        />

                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                          <Input
                            value={planEditor.priceMonthly}
                            onChange={(event) => setPlanEditor((current) => ({ ...current, priceMonthly: event.target.value }))}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Цена / месяц"
                          />
                          <Input
                            value={planEditor.priceYearly}
                            onChange={(event) => setPlanEditor((current) => ({ ...current, priceYearly: event.target.value }))}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Цена / год"
                          />
                          <Input
                            value={planEditor.currency}
                            onChange={(event) => setPlanEditor((current) => ({ ...current, currency: event.target.value.toUpperCase() }))}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Валюта"
                          />
                          <select
                            value={planEditor.status}
                            onChange={(event) => setPlanEditor((current) => ({ ...current, status: event.target.value }))}
                            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                          >
                            <option value="active">Активный</option>
                            <option value="archived">Архивный</option>
                          </select>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <div className="mb-3 text-sm font-medium text-white">Лимиты тарифа</div>
                          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            {LIMIT_FIELD_ORDER.map((key) => (
                              <Input
                                key={key}
                                value={planEditor.limits[key] || ''}
                                onChange={(event) =>
                                  setPlanEditor((current) => ({
                                    ...current,
                                    limits: { ...current.limits, [key]: event.target.value },
                                  }))
                                }
                                className="border-white/10 bg-slate-900/60 text-white"
                                placeholder={LIMIT_LABELS[key]}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                          <div className="mb-3 text-sm font-medium text-white">Доступ к разделам</div>
                          <div className="grid gap-3">
                            {SUBSCRIPTION_FEATURE_BUNDLES.map((bundle) => {
                              const enabled = Boolean(planEditor.features[bundle.feature])
                              return (
                                <button
                                  key={bundle.feature}
                                  type="button"
                                  onClick={() =>
                                    setPlanEditor((current) => ({
                                      ...current,
                                      features: {
                                        ...current.features,
                                        [bundle.feature]: !enabled,
                                      },
                                    }))
                                  }
                                  className={`rounded-2xl border px-4 py-4 text-left transition ${
                                    enabled
                                      ? 'border-emerald-400 bg-emerald-500/10'
                                      : 'border-white/10 bg-slate-900/50 hover:border-white/20'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-3">
                                    <div>
                                      <div className="text-sm font-medium text-white">{bundle.label}</div>
                                      <div className="mt-1 text-xs text-slate-400">{bundle.description}</div>
                                    </div>
                                    <Badge variant={enabled ? 'default' : 'outline'}>
                                      {enabled ? 'Включено' : 'Выключено'}
                                    </Badge>
                                  </div>
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {bundle.pages.map((page) => (
                                      <span key={page} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300">
                                        {page}
                                      </span>
                                    ))}
                                  </div>
                                </button>
                              )
                            })}
                          </div>
                        </div>

                        <Button type="submit" disabled={savingPlan} className="w-full">
                          {savingPlan ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
                          {planEditor.id ? 'Сохранить тариф' : 'Создать тариф'}
                        </Button>
                      </form>
                    </div>
                  </div>
                ) : null}

                {canCreateOrganizations ? (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex items-center gap-3">
                        <div className="rounded-2xl bg-violet-500/10 p-3">
                          <Sparkles className="h-5 w-5 text-violet-300" />
                        </div>
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-base font-semibold text-white">Создать новую организацию</h2>
                            <Badge className="bg-violet-500/15 text-violet-100 hover:bg-violet-500/15">Умный запуск</Badge>
                          </div>
                          <p className="text-sm text-slate-400">Новый клиент, новый проект или отдельный бизнес-контур с подсказкой по тарифу и первому запуску.</p>
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-2 text-xs text-slate-300">
                        Система сама подскажет подходящий тариф по модулям и масштабу.
                      </div>
                    </div>

                    <Tabs value={createOrganizationTab} onValueChange={(value) => setCreateOrganizationTab(value as 'smart' | 'quick')} className="gap-4">
                      <TabsList className="w-full justify-start rounded-2xl bg-slate-950/70 p-1">
                        <TabsTrigger value="smart" className="rounded-xl data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                          Умный режим
                        </TabsTrigger>
                        <TabsTrigger value="quick" className="rounded-xl data-[state=active]:bg-slate-900 data-[state=active]:text-white">
                          Быстрое создание
                        </TabsTrigger>
                      </TabsList>

                      <TabsContent value="smart" className="space-y-4">
                        <form onSubmit={handleCreateOrganization} className="grid gap-4">
                          <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                            <div className="space-y-4">
                              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                                  <CheckCircle2 className="h-4 w-4 text-sky-400" />
                                  Шаг 1. Основа клиента
                                </div>
                                <div className="grid gap-3">
                                  <Input
                                    value={organizationName}
                                    onChange={(event) => {
                                      setOrganizationName(event.target.value)
                                      if (!organizationSlug.trim()) {
                                        setOrganizationSlug(slugify(event.target.value))
                                      }
                                    }}
                                    className="border-white/10 bg-slate-900/60 text-white"
                                    placeholder="Например: F16 Holding"
                                  />
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    <Input
                                      value={organizationSlug}
                                      onChange={(event) => setOrganizationSlug(slugify(event.target.value))}
                                      className="border-white/10 bg-slate-900/60 text-white"
                                      placeholder="slug организации"
                                    />
                                    <Input
                                      value={organizationLegalName}
                                      onChange={(event) => setOrganizationLegalName(event.target.value)}
                                      className="border-white/10 bg-slate-900/60 text-white"
                                      placeholder="Юр. название, если нужно"
                                    />
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-slate-400">
                                    Адрес организации и доступы будут строиться вокруг slug: <span className="font-mono text-slate-200">{organizationSlug || 'company-slug'}</span>
                                    <div className="mt-2 rounded-xl border border-sky-500/20 bg-sky-500/10 px-3 py-2 text-slate-200">
                                      Поддомен клиента: <span className="font-mono text-white">{suggestedWorkspaceHost}</span>
                                    </div>
                                  </div>
                                  <Input
                                    value={organizationTrialDays}
                                    onChange={(event) => setOrganizationTrialDays(event.target.value)}
                                    className="border-white/10 bg-slate-900/60 text-white"
                                    placeholder="Дней пробного периода, например 14"
                                  />
                                </div>
                              </div>

                              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                                  Шаг 2. Что нужно этому клиенту
                                </div>
                                <div className="grid gap-3 sm:grid-cols-2">
                                  {BUSINESS_MODEL_OPTIONS.map((option) => (
                                    <button
                                      key={option.value}
                                      type="button"
                                      onClick={() => setOrganizationBusinessModel(option.value)}
                                      className={`rounded-2xl border px-4 py-4 text-left transition ${
                                        organizationBusinessModel === option.value
                                          ? 'border-sky-400 bg-sky-500/10'
                                          : 'border-white/10 bg-black/20 hover:border-white/20'
                                      }`}
                                    >
                                      <div className="text-sm font-medium text-white">{option.label}</div>
                                      <div className="mt-1 text-xs text-slate-400">{option.hint}</div>
                                    </button>
                                  ))}
                                </div>

                                <div className="mt-4">
                                  <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-500">Масштаб сети</div>
                                  <div className="grid gap-3 sm:grid-cols-3">
                                    {POINT_SCALE_OPTIONS.map((option) => (
                                      <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setOrganizationPointScale(option.value)}
                                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                                          organizationPointScale === option.value
                                            ? 'border-emerald-400 bg-emerald-500/10'
                                            : 'border-white/10 bg-black/20 hover:border-white/20'
                                        }`}
                                      >
                                        <div className="text-sm font-medium text-white">{option.label}</div>
                                        <div className="mt-1 text-xs text-slate-400">{option.hint}</div>
                                      </button>
                                    ))}
                                  </div>
                                </div>

                                <div className="mt-4">
                                  <div className="mb-3 text-xs uppercase tracking-[0.18em] text-slate-500">Модули и интеграции</div>
                                  <div className="grid gap-3 sm:grid-cols-2">
                                    {[
                                      { key: 'ai', label: 'AI-аналитика и прогнозы', enabled: organizationNeedAi, toggle: () => setOrganizationNeedAi((value) => !value) },
                                      { key: 'inventory', label: 'Склад и остатки', enabled: organizationNeedInventory, toggle: () => setOrganizationNeedInventory((value) => !value) },
                                      { key: 'pos', label: 'POS и терминал', enabled: organizationNeedPos, toggle: () => setOrganizationNeedPos((value) => !value) },
                                      { key: 'telegram', label: 'Telegram-бот и автоотчёты', enabled: organizationNeedTelegram, toggle: () => setOrganizationNeedTelegram((value) => !value) },
                                    ].map((item) => (
                                      <button
                                        key={item.key}
                                        type="button"
                                        onClick={item.toggle}
                                        className={`rounded-2xl border px-4 py-3 text-left transition ${
                                          item.enabled ? 'border-violet-400 bg-violet-500/10' : 'border-white/10 bg-black/20 hover:border-white/20'
                                        }`}
                                      >
                                        <div className="flex items-center justify-between gap-2">
                                          <span className="text-sm font-medium text-white">{item.label}</span>
                                          <span className={`h-2.5 w-2.5 rounded-full ${item.enabled ? 'bg-violet-300' : 'bg-slate-600'}`} />
                                        </div>
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                                <div className="mb-4 flex items-center gap-2 text-sm font-medium text-white">
                                  <CheckCircle2 className="h-4 w-4 text-amber-400" />
                                  Шаг 3. Первая точка и запуск
                                </div>
                                <div className="grid gap-3">
                                  <Input
                                    value={firstCompanyName}
                                    onChange={(event) => setFirstCompanyName(event.target.value)}
                                    className="border-white/10 bg-slate-900/60 text-white"
                                    placeholder="Первая точка внутри организации"
                                  />
                                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                                    <span>Подсказка:</span>
                                    <button
                                      type="button"
                                      onClick={() => setFirstCompanyName(suggestedFirstCompanyName)}
                                      disabled={!suggestedFirstCompanyName}
                                      className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-slate-200 transition hover:border-white/20 disabled:opacity-40"
                                    >
                                      Использовать «{suggestedFirstCompanyName || 'сначала укажи название'}»
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="rounded-3xl border border-[#d7ff00]/20 bg-[#d7ff00]/5 p-4">
                                <div className="flex items-center justify-between gap-3">
                                  <div>
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Рекомендация</div>
                                    <div className="mt-2 text-xl font-semibold text-white">
                                      {formatPlanName(recommendedCreatePlan || null) || organizationPlanCode}
                                    </div>
                                  </div>
                                  <Sparkles className="h-5 w-5 text-[#d7ff00]" />
                                </div>
                                <p className="mt-3 text-sm text-slate-300">
                                  На основе масштаба сети и выбранных модулей система рекомендует этот тариф как стартовый.
                                </p>
                                <div className="mt-4 flex flex-wrap gap-2">
                                  <Badge variant="outline" className="border-[#d7ff00]/30 text-[#f3ff9d]">
                                    {selectedBusinessModel?.label || organizationBusinessModel}
                                  </Badge>
                                  <Badge variant="outline" className="border-[#d7ff00]/30 text-[#f3ff9d]">
                                    {selectedPointScale?.label || `${organizationPointScale} точек`}
                                  </Badge>
                                </div>
                              </div>

                              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                  <div className="text-sm font-medium text-white">Выбранный тариф</div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOrganizationPlanManual((value) => !value)
                                      if (organizationPlanManual) {
                                        setOrganizationPlanCode(recommendedPlanCode)
                                      }
                                    }}
                                    className="text-xs text-slate-400 underline-offset-4 hover:text-white hover:underline"
                                  >
                                    {organizationPlanManual ? 'Вернуть авто-режим' : 'Выбрать вручную'}
                                  </button>
                                </div>
                                <div className="grid gap-3">
                                  {availablePlanOptions.map((plan) => {
                                    const planFeatureLabels = getEnabledFeatureLabels(plan.features || {})
                                    const isRecommended = plan.code === recommendedPlanCode
                                    const isSelected = plan.code === organizationPlanCode
                                    return (
                                      <button
                                        key={plan.code}
                                        type="button"
                                        onClick={() => {
                                          setOrganizationPlanManual(true)
                                          setOrganizationPlanCode(plan.code)
                                        }}
                                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                                          isSelected
                                            ? 'border-sky-400 bg-sky-500/10'
                                            : 'border-white/10 bg-black/20 hover:border-white/20'
                                        }`}
                                      >
                                        <div className="flex items-start justify-between gap-3">
                                          <div>
                                            <div className="flex flex-wrap items-center gap-2">
                                              <span className="text-base font-semibold text-white">{formatPlanName(plan)}</span>
                                              {isRecommended ? (
                                                <Badge className="bg-[#d7ff00]/15 text-[#f3ff9d] hover:bg-[#d7ff00]/15">Рекомендуем</Badge>
                                              ) : null}
                                            </div>
                                            <div className="mt-1 text-xs text-slate-400">
                                              {plan.description || 'Тариф для этого клиентского контура.'}
                                            </div>
                                          </div>
                                          <div className="text-right text-xs text-slate-400">
                                            {getPlanPrice(plan, 'monthly') ? (
                                              <>
                                                <div className="text-sm font-medium text-white">{getPlanPrice(plan, 'monthly')} {plan.currency}</div>
                                                <div>/ месяц</div>
                                              </>
                                            ) : (
                                              'Цена не задана'
                                            )}
                                          </div>
                                        </div>
                                        {planFeatureLabels.length ? (
                                          <div className="mt-3 flex flex-wrap gap-2">
                                            {planFeatureLabels.slice(0, 4).map((label) => (
                                              <span key={label} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300">
                                                {label}
                                              </span>
                                            ))}
                                          </div>
                                        ) : null}
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>

                              <div className="rounded-3xl border border-white/10 bg-slate-950/60 p-4">
                                <div className="text-sm font-medium text-white">Что будет создано</div>
                                <div className="mt-3 space-y-3 text-sm text-slate-300">
                                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Организация</div>
                                    <div className="mt-1 font-medium text-white">{organizationName || 'Название появится здесь'}</div>
                                    <div className="text-xs text-slate-500">slug: {organizationSlug || 'company-slug'}</div>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Рабочий адрес</div>
                                    <div className="mt-1 font-medium text-white">{suggestedWorkspaceHost}</div>
                                    <div className="text-xs text-slate-500">{suggestedWorkspaceUrl}</div>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Первая точка</div>
                                    <div className="mt-1 font-medium text-white">{firstCompanyName || 'Можно создать позже'}</div>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Старт подписки</div>
                                    <div className="mt-1 font-medium text-white">
                                      Пробный период на {Number(organizationTrialDays) || 14} дней
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      После создания сразу появится история биллинга и дедлайн по активации.
                                    </div>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Включенные возможности</div>
                                    <div className="mt-2 flex flex-wrap gap-2">
                                      {selectedPlanFeatureLabels.length ? (
                                        selectedPlanFeatureLabels.map((label) => (
                                          <span key={label} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] text-slate-300">
                                            {label}
                                          </span>
                                        ))
                                      ) : (
                                        <span className="text-xs text-slate-500">У выбранного плана пока нет явно заданных флагов возможностей.</span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Какие разделы откроются</div>
                                    <div className="mt-2 space-y-2">
                                      {selectedCreatePlanBundles.length ? (
                                        selectedCreatePlanBundles.map((bundle) => (
                                          <div key={bundle.feature} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                                            <div className="text-xs font-medium text-white">{bundle.label}</div>
                                            <div className="mt-1 text-[11px] text-slate-400">
                                              {bundle.pages.join(', ')}
                                            </div>
                                          </div>
                                        ))
                                      ) : (
                                        <span className="text-xs text-slate-500">На базовом наборе откроются только общие разделы без платных модулей.</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <Button type="submit" disabled={creatingOrganization} className="mt-4 w-full">
                                  {creatingOrganization ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                                  Создать организацию и открыть проект
                                </Button>
                              </div>
                            </div>
                          </div>
                        </form>
                      </TabsContent>

                      <TabsContent value="quick">
                        <form onSubmit={handleCreateOrganization} className="grid gap-3">
                          <Input
                            value={organizationName}
                            onChange={(event) => {
                              setOrganizationName(event.target.value)
                              if (!organizationSlug.trim()) {
                                setOrganizationSlug(slugify(event.target.value))
                              }
                            }}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Название организации"
                          />
                          <Input
                            value={organizationSlug}
                            onChange={(event) => setOrganizationSlug(slugify(event.target.value))}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="slug организации"
                          />
                          <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-xs text-slate-400">
                            Поддомен клиента создастся автоматически: <span className="font-mono text-slate-200">{suggestedWorkspaceHost}</span>
                          </div>
                          <Input
                            value={organizationLegalName}
                            onChange={(event) => setOrganizationLegalName(event.target.value)}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Юр. название, если нужно"
                          />
                          <select
                            value={organizationPlanCode}
                            onChange={(event) => {
                              setOrganizationPlanManual(true)
                              setOrganizationPlanCode(event.target.value)
                            }}
                            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                          >
                            {availablePlanOptions.map((plan) => (
                              <option key={plan.code} value={plan.code}>
                                {formatPlanName(plan)}
                              </option>
                            ))}
                          </select>
                          <Input
                            value={organizationTrialDays}
                            onChange={(event) => setOrganizationTrialDays(event.target.value)}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Дней пробного периода"
                          />
                          <Input
                            value={firstCompanyName}
                            onChange={(event) => setFirstCompanyName(event.target.value)}
                            className="border-white/10 bg-slate-900/60 text-white"
                            placeholder="Первая точка внутри организации, если нужна"
                          />
                          <Button type="submit" disabled={creatingOrganization}>
                            {creatingOrganization ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                            Создать организацию
                          </Button>
                        </form>
                      </TabsContent>
                    </Tabs>
                  </div>
                ) : null}

                {canCreateCompanies ? (
                  <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="rounded-2xl bg-emerald-500/10 p-3">
                        <Store className="h-5 w-5 text-emerald-300" />
                      </div>
                      <div>
                        <h2 className="text-base font-semibold text-white">Добавить новую точку</h2>
                        <p className="text-sm text-slate-400">
                          Активная организация: <span className="font-medium text-white">{activeOrganizationLabel}</span>
                        </p>
                      </div>
                    </div>

                    <form onSubmit={handleCreateCompany} className="grid gap-3">
                      <Input
                        value={companyName}
                        onChange={(event) => setCompanyName(event.target.value)}
                        className="border-white/10 bg-slate-900/60 text-white"
                        placeholder="Название точки"
                        disabled={!activeOrganizationId}
                      />
                      <Input
                        value={companyCode}
                        onChange={(event) => setCompanyCode(event.target.value)}
                        className="border-white/10 bg-slate-900/60 text-white"
                        placeholder="Код точки, если используете"
                        disabled={!activeOrganizationId}
                      />
                      <Button type="submit" disabled={creatingCompany || !activeOrganizationId}>
                        {creatingCompany ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                        Создать точку
                      </Button>
                    </form>
                  </div>
                ) : null}

                <Button variant="outline" className="mt-2 w-full" onClick={handleSignOut} disabled={!!switchingId}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Выйти
                </Button>

                {loadingHub ? (
                  <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-400">
                    Обновляем SaaS-кабинет...
                  </div>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function SelectOrganizationPage() {
  return (
    <Suspense fallback={null}>
      <SelectOrganizationContent />
    </Suspense>
  )
}
