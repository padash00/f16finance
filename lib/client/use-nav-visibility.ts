'use client'

/**
 * Видимость пункта меню: фича тарифа + capability страницы.
 *
 *   const { isNavItemVisible } = useNavVisibility()
 *   NAV.filter((item) => isNavItemVisible(item.href))
 *
 * Зачем отдельный хук: главный сайдбар гейтит пункты сам, а модуль «Магазин»
 * рисует своё меню в собственной оболочке — и до сих пор рисовал статический
 * список без проверок. Из-за этого организация без аддона `addon.webpos` видела
 * пункт «Web POS», а сотрудник без права на раздел — все разделы склада.
 *
 * Пока роль и capabilities ещё грузятся, пункт считается видимым: иначе меню
 * мигает пустотой на каждом заходе.
 */

import { useCallback, useEffect, useState } from 'react'

import { findCapabilityPageByPath } from '@/lib/core/capabilities'
import { getPathFeature } from '@/lib/nav/sections'
import { useCapabilities } from '@/lib/client/use-capabilities'

type OrgFeatures = { features: string[]; allAccess: boolean; ready: boolean }

const initial: OrgFeatures = { features: [], allAccess: true, ready: false }

// Кэш на вкладку: оболочка магазина монтируется на каждой странице раздела,
// сессию-роль незачем перезапрашивать при каждой навигации.
let cache: OrgFeatures | null = null
let inFlight: Promise<OrgFeatures> | null = null

async function loadOrgFeatures(): Promise<OrgFeatures> {
  try {
    const response = await fetch('/api/auth/session-role', { cache: 'no-store' })
    const json = await response.json().catch(() => null)
    if (!response.ok || !json) return { ...initial, ready: true }
    return {
      features: Array.isArray(json.orgFeatures) ? json.orgFeatures : [],
      allAccess: json.featuresAllAccess !== false,
      ready: true,
    }
  } catch {
    return { ...initial, ready: true }
  }
}

export function useNavVisibility() {
  const { can, isLoading: capsLoading } = useCapabilities()
  const [org, setOrg] = useState<OrgFeatures>(cache || initial)

  useEffect(() => {
    if (cache) return
    let ignore = false
    inFlight = inFlight || loadOrgFeatures()
    void inFlight.then((result) => {
      cache = result
      inFlight = null
      if (!ignore) setOrg(result)
    })
    return () => { ignore = true }
  }, [])

  const isNavItemVisible = useCallback(
    (href: string) => {
      if (org.ready && !org.allAccess) {
        const feature = getPathFeature(href)
        if (feature && !org.features.includes(feature)) return false
      }
      if (!capsLoading) {
        const page = findCapabilityPageByPath(href)
        if (page) return can(`${page.id}.view`)
      }
      return true
    },
    [org, capsLoading, can],
  )

  return { isNavItemVisible, ready: org.ready && !capsLoading }
}
