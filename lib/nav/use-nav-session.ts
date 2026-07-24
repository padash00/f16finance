'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { canAccessPath, type StaffRole, type SubscriptionFeature } from '@/lib/core/access'
import { findCapabilityPageByPath } from '@/lib/core/capabilities'
import { useCapabilities } from '@/lib/client/use-capabilities'
import type { SessionRoleInfo } from '@/lib/core/types'
import { getPathFeature, type NavSection } from '@/lib/nav/sections'

export type NavSession = {
  userEmail: string | null
  displayName: string | null
  staffRole: StaffRole | null
  roleLabel: string | null
  isSuperAdmin: boolean
  isTenantContext: boolean
  isStaff: boolean
  isOperator: boolean
  isLeadOperator: boolean
  organizations: NonNullable<SessionRoleInfo['organizations']>
  activeOrganization: SessionRoleInfo['activeOrganization']
  subscriptionFeatures: Partial<Record<SubscriptionFeature, boolean>>
  rolePermissionOverrides: Array<{ path: string; enabled: boolean }>
  orgFeatures: string[]
  featuresAllAccess: boolean
  isSwitchingOrganization: boolean
  handleLogout: () => Promise<void>
  handleSwitchOrganization: (organizationId: string) => Promise<void>
  filterSection: (section: NavSection) => NavSection
}

export function useNavSession(): NavSession {
  const router = useRouter()
  const { can: canDo, isLoading: capsLoading } = useCapabilities()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [roleLabel, setRoleLabel] = useState<string | null>(null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isTenantContext, setIsTenantContext] = useState(false)
  const [isStaff, setIsStaff] = useState(false)
  const [isOperator, setIsOperator] = useState(false)
  const [isLeadOperator, setIsLeadOperator] = useState(false)
  const [organizations, setOrganizations] = useState<NonNullable<SessionRoleInfo['organizations']>>([])
  const [activeOrganization, setActiveOrganization] = useState<SessionRoleInfo['activeOrganization']>(null)
  const [subscriptionFeatures, setSubscriptionFeatures] = useState<Partial<Record<SubscriptionFeature, boolean>>>({})
  const [rolePermissionOverrides, setRolePermissionOverrides] = useState<Array<{ path: string; enabled: boolean }>>([])
  const [orgFeatures, setOrgFeatures] = useState<string[]>([])
  const [featuresAllAccess, setFeaturesAllAccess] = useState(true)
  const [isSwitchingOrganization, setIsSwitchingOrganization] = useState(false)

  useEffect(() => {
    let ignore = false

    const loadUser = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser()

      if (!ignore) {
        setUserEmail(user?.email || null)
      }

      const response = await fetch('/api/auth/session-role').catch(() => null)
      const json = await response?.json().catch(() => null)

      if (!ignore && response?.ok) {
        setIsSuperAdmin(!!json?.isSuperAdmin)
        setIsTenantContext(!!json?.isTenantContext)
        setIsStaff(!!json?.isStaff)
        setIsOperator(!!json?.isOperator)
        setIsLeadOperator(!!json?.isLeadOperator)
        setStaffRole((json?.staffRole as StaffRole | null) || null)
        setDisplayName((json?.displayName as string | null) || null)
        setRoleLabel((json?.roleLabel as string | null) || null)
        setOrganizations(Array.isArray(json?.organizations) ? json.organizations : [])
        setActiveOrganization((json?.activeOrganization as SessionRoleInfo['activeOrganization']) || null)
        setSubscriptionFeatures(
          ((json?.activeSubscription as SessionRoleInfo['activeSubscription'] | null)?.plan?.features as
            | Partial<Record<SubscriptionFeature, boolean>>
            | undefined) || {},
        )
        setRolePermissionOverrides(Array.isArray(json?.rolePermissionOverrides) ? json.rolePermissionOverrides : [])
        setOrgFeatures(Array.isArray(json?.orgFeatures) ? json.orgFeatures : [])
        setFeaturesAllAccess(json?.featuresAllAccess !== false)
      }
    }

    loadUser()
    return () => {
      ignore = true
    }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handleSwitchOrganization = async (organizationId: string) => {
    if (!organizationId || activeOrganization?.id === organizationId) return

    try {
      setIsSwitchingOrganization(true)
      const response = await fetch('/api/auth/active-organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ organizationId }),
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.error || `HTTP ${response.status}`)
      }

      const body = await response.json().catch(() => null)
      setActiveOrganization(body?.activeOrganization || null)
      router.refresh()
      window.location.reload()
    } finally {
      setIsSwitchingOrganization(false)
    }
  }

  const filterSection = useCallback((section: NavSection): NavSection => ({
    ...section,
    // Секции больше не гейтятся целиком — каждый пункт проверяет свою
    // пер-страничную фичу (модель «1 фича = 1 страница»).
    items: section.items.filter((item) => {
      if (item.href === '/operator-lead' && !isLeadOperator) return false

      // Гейтинг по фиче ПАКЕТА (пер-страничная). allAccess → не гейтим.
      // getPathFeature вернёт null для базовых страниц (всегда доступны).
      if (!featuresAllAccess) {
        const feat = getPathFeature(item.href)
        if (feat && !orgFeatures.includes(feat)) return false
      }

      // Если страница есть в каталоге capabilities — приоритет у новой модели.
      // Capabilities ещё не загружены — fallback на старую логику;
      // загружены — смотрим <page-id>.view.
      if (!capsLoading) {
        const capPage = findCapabilityPageByPath(item.href)
        if (capPage) {
          return canDo(`${capPage.id}.view`)
        }
      }

      return canAccessPath({
        pathname: item.href,
        isStaff,
        isOperator,
        staffRole,
        isSuperAdmin,
        subscriptionFeatures,
        rolePermissionOverrides,
      })
    }),
  }), [isLeadOperator, capsLoading, canDo, isStaff, isOperator, staffRole, isSuperAdmin, subscriptionFeatures, rolePermissionOverrides, orgFeatures, featuresAllAccess])

  return {
    userEmail,
    displayName,
    staffRole,
    roleLabel,
    isSuperAdmin,
    isTenantContext,
    isStaff,
    isOperator,
    isLeadOperator,
    organizations,
    activeOrganization,
    subscriptionFeatures,
    rolePermissionOverrides,
    orgFeatures,
    featuresAllAccess,
    isSwitchingOrganization,
    handleLogout,
    handleSwitchOrganization,
    filterSection,
  }
}
