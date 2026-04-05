'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { TaskPriority, TaskStatus } from '@/lib/core/types'

export type TaskRow = {
  id: string
  task_number: number
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  due_date: string | null
  operator_id: string | null
  company_id: string | null
  created_at: string
}

export type UseTasksOptions = {
  status?: TaskStatus
  operatorId?: string
  companyId?: string
  pageSize?: number
  /** Set to false to skip the initial fetch */
  enabled?: boolean
}

/**
 * Fetches tasks from GET /api/admin/tasks with pagination and race condition prevention.
 */
export function useTasks(options: UseTasksOptions = {}) {
  const { status, operatorId, companyId, pageSize = 100, enabled = true } = options

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const fetchPage = useCallback(
    async (targetPage: number, mode: 'replace' | 'append') => {
      abortRef.current?.abort()
      const controller = new AbortController()
      abortRef.current = controller

      if (mode === 'replace') setLoading(true)
      else setLoadingMore(true)
      setError(null)

      try {
        const params = new URLSearchParams()
        if (status) params.set('status', status)
        if (operatorId) params.set('operator_id', operatorId)
        if (companyId) params.set('company_id', companyId)
        params.set('page', String(targetPage))
        params.set('page_size', String(pageSize))

        const res = await fetch(`/api/admin/tasks?${params}`, { signal: controller.signal })
        if (!res.ok) {
          const body = await res.json().catch(() => ({}))
          throw new Error(body.error || `HTTP ${res.status}`)
        }
        const body = await res.json()
        const pageRows: TaskRow[] = body.data ?? []

        setHasMore(body.hasMore ?? false)
        if (mode === 'replace') {
          setTasks(pageRows)
          setPage(targetPage)
        } else {
          setTasks((prev) => [...prev, ...pageRows])
          setPage(targetPage)
        }
      } catch (e: unknown) {
        if ((e as Error)?.name === 'AbortError') return
        setError(e instanceof Error ? e.message : 'Ошибка загрузки задач')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setLoadingMore(false)
        }
      }
    },
    [status, operatorId, companyId, pageSize],
  )

  useEffect(() => {
    if (enabled) fetchPage(0, 'replace')
    return () => abortRef.current?.abort()
  }, [fetchPage, enabled])

  const loadMore = useCallback(() => {
    if (loadingMore || loading || !hasMore) return
    fetchPage(page + 1, 'append')
  }, [loadingMore, loading, hasMore, fetchPage, page])

  const reload = useCallback(() => fetchPage(0, 'replace'), [fetchPage])

  return { tasks, loading, loadingMore, hasMore, error, reload, loadMore }
}
