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
type OrganizationHubOverview = {
  id: string
  name: string
  slug: string
  legalName: string | null
  status: string
  createdAt: string | null
  companyCount: number
  memberCount: number
  companies: Array<{ id: string; name: string; code: string | null }>
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
  { value: 'starter', label: 'Starter' },
  { value: 'growth', label: 'Growth' },
  { value: 'enterprise', label: 'Enterprise' },
]
const FEATURE_LABELS: Record<string, string> = {
  ai_reports: 'AI-аналитика',
  inventory: 'Склад и остатки',
  web_pos: 'POS и терминал',
  telegram: 'Telegram-боты и отчёты',
  custom_branding: 'White-label и branding',
}
const BUSINESS_MODEL_OPTIONS = [
  { value: 'club', label: 'Клуб / арена', hint: 'Операторы, смены, касса и KPI по точкам.' },
  { value: 'restaurant', label: 'Общепит', hint: 'Продажи, расходы, кухня, Telegram и учёт.' },
  { value: 'retail', label: 'Retail / store', hint: 'Склад, остатки, каталог, POS и движение товара.' },
  { value: 'mixed', label: 'Смешанный формат', hint: 'Нужно сразу несколько модулей и гибкие лимиты.' },
] as const
const POINT_SCALE_OPTIONS = [
  { value: '1', label: '1 точка', hint: 'Один объект или одна площадка.' },
  { value: '2-5', label: '2-5 точек', hint: 'Сеть малого масштаба.' },
  { value: '6+', label: '6+ точек', hint: 'Несколько филиалов и рост по сети.' },
] as const
const MEMBER_ROLE_OPTIONS: Array<{ value: OrganizationMember['role']; label: string }> = [
  { value: 'owner', label: 'Owner' },
  { value: 'manager', label: 'Manager' },
  { value: 'marketer', label: 'Marketer' },
  { value: 'other', label: 'Other' },
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

function getEnabledFeatureLabels(features: Record<string, unknown> | null | undefined) {
  return Object.entries(features || {})
    .filter(([, enabled]) => Boolean(enabled))
    .map(([feature]) => FEATURE_LABELS[feature] || feature)
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
  const [loadingHub, setLoadingHub] = useState(false)
  const [organizationMembers, setOrganizationMembers] = useState<OrganizationMember[]>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
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
  const [editOrganizationStatus, setEditOrganizationStatus] = useState('active')
  const [editPlanCode, setEditPlanCode] = useState('starter')
  const [editSubscriptionStatus, setEditSubscriptionStatus] = useState('active')
  const [editBillingPeriod, setEditBillingPeriod] = useState('monthly')
  const [inviteFullName, setInviteFullName] = useState('')
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<OrganizationMember['role']>('manager')

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
        try {
          const hubResponse = await fetch('/api/admin/organizations', { cache: 'no-store' })
          const hubJson = await hubResponse.json().catch(() => null)
          if (active && hubResponse.ok) {
            setHubOrganizations(Array.isArray(hubJson?.organizations) ? hubJson.organizations : [])
            setPlans(Array.isArray(hubJson?.plans) ? hubJson.plans : [])
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
    if (organizationBusinessModel === 'retail') return `${baseName} Store`
    if (organizationBusinessModel === 'restaurant') return `${baseName} Kitchen`
    if (organizationPointScale === '1') return baseName
    return `${baseName} Central`
  }, [organizationBusinessModel, organizationName, organizationPointScale])
  const selectedPlanFeatureLabels = useMemo(
    () => getEnabledFeatureLabels(selectedCreatePlan?.features || {}),
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

  useEffect(() => {
    if (!activeOrganizationDetails) return
    setEditOrganizationName(activeOrganizationDetails.name || '')
    setEditOrganizationSlug(activeOrganizationDetails.slug || '')
    setEditOrganizationLegalName(activeOrganizationDetails.legalName || '')
    setEditOrganizationStatus(activeOrganizationDetails.status || 'active')
    setEditPlanCode(activeOrganizationDetails.subscription?.plan?.code || 'starter')
    setEditSubscriptionStatus(activeOrganizationDetails.subscription?.status || 'active')
    setEditBillingPeriod(activeOrganizationDetails.subscription?.billingPeriod || 'monthly')
  }, [activeOrganizationDetails])

  useEffect(() => {
    if (!organizationPlanManual) {
      setOrganizationPlanCode(recommendedPlanCode)
    }
  }, [organizationPlanManual, recommendedPlanCode])

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
      setFirstCompanyName('')
      setOrganizationBusinessModel('club')
      setOrganizationPointScale('1')
      setOrganizationNeedAi(false)
      setOrganizationNeedInventory(false)
      setOrganizationNeedPos(false)
      setOrganizationNeedTelegram(false)
      setOrganizationPlanManual(false)
      setCreateOrganizationTab('smart')
      setSuccess(`Организация "${body.organization.name}" создана и готова к работе.`)
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
          slug: editOrganizationSlug.trim() || null,
          organizationStatus: editOrganizationStatus,
          planCode: editPlanCode,
          subscriptionStatus: editSubscriptionStatus,
          billingPeriod: editBillingPeriod,
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

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.14),_transparent_32%),radial-gradient(circle_at_bottom_left,_rgba(16,185,129,0.12),_transparent_28%),linear-gradient(135deg,#050816_0%,#090f1f_48%,#050816_100%)] p-4">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center justify-center">
        <div className="grid w-full gap-6 lg:grid-cols-[1fr_0.95fr]">
          <Card className="hidden border-white/10 bg-slate-950/60 p-8 text-white backdrop-blur-xl lg:block">
            <div className="flex h-full flex-col justify-between">
              <div>
                <div className="mb-6 inline-flex rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-500 p-4 shadow-lg shadow-sky-500/20">
                  <Brain className="h-8 w-8 text-white" />
                </div>
                <h1 className="max-w-md text-4xl font-semibold leading-tight text-white">
                  Выберите проект, клиента или организацию, в которой хотите работать сейчас.
                </h1>
                <p className="mt-4 max-w-xl text-sm leading-6 text-slate-300">
                  После выбора система зафиксирует tenant-контекст и откроет только данные, точки, отчёты и людей этой организации.
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

          <Card className="border-white/10 bg-slate-950/70 p-6 text-white backdrop-blur-xl sm:p-8">
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
            ) : organizations.length === 0 ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
                  <div className="mb-2 flex items-center gap-2 font-medium">
                    <ShieldAlert className="h-4 w-4" />
                    Нет доступных организаций
                  </div>
                  Для этого аккаунта ещё не назначена организация. Нужна привязка со стороны администратора.
                </div>
                <Button variant="outline" className="w-full" onClick={handleSignOut}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Выйти
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
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

                {organizations.map((organization) => {
                  const isActive = activeOrganization?.id === organization.id
                  const isBusy = switchingId === organization.id
                  const overview = hubOrganizations.find((item) => item.id === organization.id)
                  const planName = overview?.subscription?.plan?.name || overview?.subscription?.plan?.code || 'Без тарифа'
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
                            {organization.slug} • {organization.accessRole}
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                              Тариф: {planName}
                            </span>
                            <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                              Статус: {subscriptionStatus}
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
                        <div className="mt-1 font-medium text-white">{activeOrganizationDetails.subscription?.plan?.name || 'Не задан'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                        <div className="text-slate-500">Статус подписки</div>
                        <div className="mt-1 font-medium text-white">{activeOrganizationDetails.subscription?.status || 'Не задан'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                        <div className="text-slate-500">Точек</div>
                        <div className="mt-1 font-medium text-white">{activeOrganizationDetails.companyCount}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3 text-sm">
                        <div className="text-slate-500">Сотрудников</div>
                        <div className="mt-1 font-medium text-white">{activeOrganizationDetails.memberCount}</div>
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
                            <option value="active">active</option>
                            <option value="trial">trial</option>
                            <option value="suspended">suspended</option>
                            <option value="archived">archived</option>
                          </select>
                          <select
                            value={editPlanCode}
                            onChange={(event) => setEditPlanCode(event.target.value)}
                            className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                          >
                            {availablePlanOptions.map((plan) => (
                              <option key={plan.code} value={plan.code}>
                                {plan.name} {plan.priceMonthly ? `• ${plan.priceMonthly} ${plan.currency}/мес` : ''}
                              </option>
                            ))}
                          </select>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <select
                              value={editSubscriptionStatus}
                              onChange={(event) => setEditSubscriptionStatus(event.target.value)}
                              className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                            >
                              <option value="trialing">trialing</option>
                              <option value="active">active</option>
                              <option value="past_due">past_due</option>
                              <option value="canceled">canceled</option>
                              <option value="expired">expired</option>
                            </select>
                            <select
                              value={editBillingPeriod}
                              onChange={(event) => setEditBillingPeriod(event.target.value)}
                              className="h-10 rounded-md border border-white/10 bg-slate-900/60 px-3 text-sm text-white outline-none"
                            >
                              <option value="monthly">monthly</option>
                              <option value="yearly">yearly</option>
                              <option value="custom">custom</option>
                            </select>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-slate-300">
                          Тариф и статус подписки сейчас управляются только из super-admin контура.
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
                              <div className="text-xs uppercase tracking-[0.16em] text-slate-500">{key}</div>
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
                          Приглашать участников сейчас может только владелец организации или super-admin.
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
                                  {member.role}
                                </div>
                              </div>
                              <div className="mt-3 flex flex-wrap gap-2">
                                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                                  Статус: {member.status}
                                </span>
                                <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[11px] text-slate-300">
                                  Аккаунт: {member.accountState}
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
                            <Badge className="bg-violet-500/15 text-violet-100 hover:bg-violet-500/15">Smart onboarding</Badge>
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
                                    Tenant URL и доступы будут строиться вокруг slug: <span className="font-mono text-slate-200">{organizationSlug || 'company-slug'}</span>
                                  </div>
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
                                      {recommendedCreatePlan?.name || organizationPlanCode}
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
                                              <span className="text-base font-semibold text-white">{plan.name}</span>
                                              {isRecommended ? (
                                                <Badge className="bg-[#d7ff00]/15 text-[#f3ff9d] hover:bg-[#d7ff00]/15">Рекомендуем</Badge>
                                              ) : null}
                                            </div>
                                            <div className="mt-1 text-xs text-slate-400">
                                              {plan.description || 'Тариф для этого tenant-контекста.'}
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
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Organization</div>
                                    <div className="mt-1 font-medium text-white">{organizationName || 'Название появится здесь'}</div>
                                    <div className="text-xs text-slate-500">slug: {organizationSlug || 'company-slug'}</div>
                                  </div>
                                  <div className="rounded-2xl border border-white/10 bg-black/20 px-3 py-3">
                                    <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Первая точка</div>
                                    <div className="mt-1 font-medium text-white">{firstCompanyName || 'Можно создать позже'}</div>
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
                                        <span className="text-xs text-slate-500">У выбранного плана пока нет явно заданных feature-флагов.</span>
                                      )}
                                    </div>
                                  </div>
                                </div>

                                <Button type="submit" disabled={creatingOrganization} className="mt-4 w-full">
                                  {creatingOrganization ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlusCircle className="mr-2 h-4 w-4" />}
                                  Создать организацию и открыть tenant
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
                                {plan.name}
                              </option>
                            ))}
                          </select>
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
