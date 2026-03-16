'use client'

import { useCallback, useEffect, useState } from 'react'

export type ExpenseRow = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
}

export type UseExpensesOptions = {
  from?: string
  to?: string
  companyId?: string
  /** Set to false to skip the initial fetch */
  enabled?: boolean
}

/**
 * Fetches expense rows from GET /api/admin/expenses.
 * Pages can use this hook instead of querying Supabase directly.
 */
export function useExpenses(options: UseExpensesOptions = {}) {
  const { from, to, companyId, enabled = true } = options

  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      if (companyId) params.set('company_id', companyId)

      const res = await fetch(`/api/admin/expenses?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setRows(body.data ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки расходов')
    } finally {
      setLoading(false)
    }
  }, [from, to, companyId])

  useEffect(() => {
    if (enabled) load()
  }, [load, enabled])

  return { rows, loading, error, reload: load }
}
