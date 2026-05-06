'use client'

/**
 * Клиентский хук для проверки capabilities на UI.
 *
 * Использование:
 *
 *   const { can, isLoading, isSuperAdmin } = useCapabilities()
 *
 *   {can('income.create') && (
 *     <Button onClick={openAddDialog}>Добавить доход</Button>
 *   )}
 *
 *   <DeleteButton disabled={!can('income.delete')} />
 *
 * Под капотом:
 * - При первом рендере делает GET /api/auth/me/capabilities
 * - Кэширует результат на уровне модуля (живёт пока вкладка открыта)
 * - При смене роли — пользователю надо перелогиниться (или вызвать
 *   refreshCapabilities() если есть UI для этого)
 *
 * Super admin видит can(...) === true для любого capability.
 */

import { useEffect, useState } from 'react'

type CapabilitiesState = {
  capabilities: Set<string>
  isSuperAdmin: boolean
  isLoading: boolean
  error: string | null
}

const initialState: CapabilitiesState = {
  capabilities: new Set(),
  isSuperAdmin: false,
  isLoading: true,
  error: null,
}

let moduleCache: CapabilitiesState | null = null
let inFlight: Promise<CapabilitiesState> | null = null
const subscribers = new Set<(state: CapabilitiesState) => void>()

async function fetchCapabilities(): Promise<CapabilitiesState> {
  try {
    const res = await fetch('/api/auth/me/capabilities', {
      credentials: 'include',
      cache: 'no-store',
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return {
        capabilities: new Set(),
        isSuperAdmin: false,
        isLoading: false,
        error: text || `HTTP ${res.status}`,
      }
    }
    const data = (await res.json()) as { capabilities: string[]; isSuperAdmin: boolean }
    return {
      capabilities: new Set(data.capabilities || []),
      isSuperAdmin: !!data.isSuperAdmin,
      isLoading: false,
      error: null,
    }
  } catch (e: any) {
    return {
      capabilities: new Set(),
      isSuperAdmin: false,
      isLoading: false,
      error: e?.message || 'load_failed',
    }
  }
}

async function ensureLoaded(): Promise<CapabilitiesState> {
  if (moduleCache && !moduleCache.isLoading) return moduleCache
  if (inFlight) return inFlight
  inFlight = fetchCapabilities().then((state) => {
    moduleCache = state
    inFlight = null
    for (const fn of subscribers) fn(state)
    return state
  })
  return inFlight
}

export function refreshCapabilities(): Promise<void> {
  moduleCache = null
  inFlight = null
  return ensureLoaded().then(() => undefined)
}

export type UseCapabilities = {
  /** Проверить наличие права. Super admin всегда получает true. */
  can: (capability: string) => boolean
  /** Проверить наличие любого из перечисленных прав */
  canAny: (capabilities: string[]) => boolean
  /** Проверить наличие всех перечисленных прав */
  canAll: (capabilities: string[]) => boolean
  /** Загружены ли права из сервера */
  isLoading: boolean
  /** Является ли пользователь супер-админом */
  isSuperAdmin: boolean
  /** Ошибка загрузки (null если ОК) */
  error: string | null
}

export function useCapabilities(): UseCapabilities {
  const [state, setState] = useState<CapabilitiesState>(moduleCache ?? initialState)

  useEffect(() => {
    let mounted = true
    if (!moduleCache || moduleCache.isLoading) {
      ensureLoaded().then((next) => {
        if (mounted) setState(next)
      })
    } else {
      setState(moduleCache)
    }

    const sub = (next: CapabilitiesState) => {
      if (mounted) setState(next)
    }
    subscribers.add(sub)
    return () => {
      mounted = false
      subscribers.delete(sub)
    }
  }, [])

  const can = (capability: string): boolean => {
    if (state.isSuperAdmin) return true
    return state.capabilities.has(capability)
  }

  const canAny = (caps: string[]): boolean => {
    if (state.isSuperAdmin) return true
    return caps.some((c) => state.capabilities.has(c))
  }

  const canAll = (caps: string[]): boolean => {
    if (state.isSuperAdmin) return true
    return caps.every((c) => state.capabilities.has(c))
  }

  return {
    can,
    canAny,
    canAll,
    isLoading: state.isLoading,
    isSuperAdmin: state.isSuperAdmin,
    error: state.error,
  }
}
