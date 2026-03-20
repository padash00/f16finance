'use client'

import { useCallback, useEffect, useState } from 'react'

export type OperatorWithProfile = {
  id: string
  name: string
  short_name: string | null
  is_active: boolean
  role: string | null
  telegram_chat_id: string | null
  created_at: string | null
  operator_profiles: Array<{
    full_name: string | null
    phone: string | null
    email: string | null
    hire_date: string | null
    position: string | null
    photo_url: string | null
  }> | null
}

export type UseOperatorsOptions = {
  activeOnly?: boolean
  /** Set to false to skip the initial fetch */
  enabled?: boolean
}

/**
 * Fetches operators from GET /api/admin/operators.
 * Includes operator_profiles (full_name, phone, email, etc.).
 * Pages can use this hook instead of querying Supabase directly.
 */
export function useOperators(options: UseOperatorsOptions = {}) {
  const { activeOnly = false, enabled = true } = options

  const [operators, setOperators] = useState<OperatorWithProfile[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (activeOnly) params.set('active_only', 'true')

      const res = await fetch(`/api/admin/operators?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setOperators(body.data ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки операторов')
    } finally {
      setLoading(false)
    }
  }, [activeOnly])

  useEffect(() => {
    if (enabled) load()
  }, [load, enabled])

  return { operators, loading, error, reload: load }
}
