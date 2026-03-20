'use client'

import { useCallback, useEffect, useState } from 'react'
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
  /** Set to false to skip the initial fetch */
  enabled?: boolean
}

/**
 * Fetches tasks from GET /api/admin/tasks.
 * Pages can use this hook instead of querying Supabase directly.
 */
export function useTasks(options: UseTasksOptions = {}) {
  const { status, operatorId, companyId, enabled = true } = options

  const [tasks, setTasks] = useState<TaskRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (status) params.set('status', status)
      if (operatorId) params.set('operator_id', operatorId)
      if (companyId) params.set('company_id', companyId)

      const res = await fetch(`/api/admin/tasks?${params}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      const body = await res.json()
      setTasks(body.data ?? [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка загрузки задач')
    } finally {
      setLoading(false)
    }
  }, [status, operatorId, companyId])

  useEffect(() => {
    if (enabled) load()
  }, [load, enabled])

  return { tasks, loading, error, reload: load }
}
