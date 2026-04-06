'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type ExpenseRow = {
  id: string
  date: string
  company_id: string
  operator_id: string | null
  category: string | null
  cash_amount: number | null
  kaspi_amount: number | null
  comment: string | null
  attachment_url: string | null
}

export type UseExpensesOptions = {
  from?: string
  to?: string
  companyId?: string
  /** Filter by exact category */
  category?: string
  /** Filter by payment type > 0 */
  payFilter?: 'cash' | 'kaspi'
  /** Server-side ilike search on comment and category (min 2 chars) */
  search?: string
  /** Sort order (default: date_desc) */
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc'
  /** Rows per page (default: 200; API caps at 2000) */
  pageSize?: number
  /** Set to false to skip the initial fetch */
  enabled?: boolean
}

/** Верхняя граница строк, подгружаемых серией page/page_size (API макс. 2000 за запрос) */
const MAX_ROWS_HARD_LIMIT = 20_000

/**
 * Fetches expense rows from GET /api/admin/expenses with full pagination support.
 * Handles race conditions via an internal reqId ref.
 * Exposes setRows for optimistic updates after mutations.
 */
export function useExpenses(options: UseExpensesOptions = {}) {
  const {
    from,
    to,
    companyId,
    category,
    payFilter,
    search,
    sort = 'date_desc',
    pageSize = 200,
    enabled = true,
  } = options

  const [rows, setRows] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const reqIdRef = useRef(0)

  const fetchPage = useCallback(
    async (targetPage: number, mode: 'replace' | 'append') => {
      const myReqId = ++reqIdRef.current
      if (mode === 'replace') setLoading(true)
      else setLoadingMore(true)
      setError(null)

      try {
        if (targetPage * pageSize >= MAX_ROWS_HARD_LIMIT) {
          setHasMore(false)
          return
        }

        const params = new URLSearchParams()
        if (from) params.set('from', from)
        if (to) params.set('to', to)
        if (companyId) params.set('company_id', companyId)
        if (category) params.set('category', category)
        if (payFilter) params.set('pay_filter', payFilter)
        if (search && search.length >= 2) params.set('search', search)
        params.set('sort', sort)
        params.set('page', String(targetPage))
        params.set('page_size', String(pageSize))

        const res = await fetch(`/api/admin/expenses?${params}`)
        if (myReqId !== reqIdRef.current) return
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const body = await res.json()
        const pageRows: ExpenseRow[] = body.data ?? []

        if (myReqId !== reqIdRef.current) return
        setHasMore(pageRows.length === pageSize && (targetPage + 1) * pageSize < MAX_ROWS_HARD_LIMIT)

        if (mode === 'replace') {
          setRows(pageRows)
          setPage(targetPage)
        } else {
          setRows((prev) => [...prev, ...pageRows])
          setPage(targetPage)
        }
      } catch (e: unknown) {
        if (myReqId !== reqIdRef.current) return
        setError(e instanceof Error ? e.message : 'Ошибка загрузки расходов')
        setHasMore(false)
      } finally {
        if (myReqId !== reqIdRef.current) return
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [from, to, companyId, category, payFilter, search, sort, pageSize],
  )

  useEffect(() => {
    if (enabled) fetchPage(0, 'replace')
  }, [fetchPage, enabled])

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return
    fetchPage(page + 1, 'append')
  }, [loadingMore, loading, hasMore, fetchPage, page])

  const reload = useCallback(() => fetchPage(0, 'replace'), [fetchPage])

  return { rows, setRows, loading, loadingMore, hasMore, error, loadMore, reload }
}
