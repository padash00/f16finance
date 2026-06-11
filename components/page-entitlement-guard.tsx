'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect } from 'react'

import { getPathFeature } from '@/lib/nav/sections'
import { useNavSession } from '@/lib/nav/use-nav-session'

/**
 * Клиентский guard: прямой заход по URL на страницу, закрытую пакетом
 * (нет нужной фичи и не allAccess) → редирект на дашборд.
 * Дополняет скрытие пунктов меню (фича не куплена → и не зайти руками).
 * Fail-open: пока сессия не загружена, featuresAllAccess=true → не редиректим.
 */
export function PageEntitlementGuard() {
  const pathname = usePathname()
  const router = useRouter()
  const { orgFeatures, featuresAllAccess } = useNavSession()

  useEffect(() => {
    if (!pathname) return
    const feature = getPathFeature(pathname)
    if (feature && !featuresAllAccess && !orgFeatures.includes(feature)) {
      router.replace(`/dashboard?upgrade=${encodeURIComponent(feature)}`)
    }
  }, [pathname, orgFeatures, featuresAllAccess, router])

  return null
}
