'use client'

import { useEffect, useState, useCallback, useMemo, Suspense, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabaseClient'
import { useToast } from '@/hooks/use-toast'
import {
  Plus,
  Search,
  Filter,
  X,
  Calendar,
  User,
  MessageSquare,
  CheckCircle2,
  MoreHorizontal,
  RefreshCw,
  Kanban,
  LayoutGrid,
  LayoutList,
  Send,
  AlertCircle,
  Clock,
  Briefcase,
  Eye,
  EyeOff,
  Tag,
  ArrowUpDown,
  Trash2,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { AdminPageHeader } from '@/components/admin/admin-page-header'
import { DatePicker } from '@/components/ui/date-picker'
import { getOperatorDisplayName, getOperatorShortLabel } from '@/lib/core/operator-name'
import { useCapabilities } from '@/lib/client/use-capabilities'

import type { Company, TaskPriority, TaskResponse, TaskStatus } from '@/lib/core/types'

// =====================
// TYPES
// =====================
type Operator = {
  id: string
  name: string
  short_name: string | null
  full_name?: string | null
  operator_profiles?: { full_name?: string | null }[] | null
  telegram_chat_id: string | null
  role: string | null
  is_active: boolean
}

type Staff = {
  id: string
  full_name: string
  short_name: string | null
  telegram_chat_id?: string | null
}

type TaskFormState = {
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  // Исполнитель: '' | 'op:<uuid>' (оператор) | 'st:<uuid>' (сотрудник)
  assignee: string
  company_id: string
  due_date: string
  tags: string
}

type ChecklistItem = { id: string; text: string; done: boolean }

type Task = {
  id: string
  title: string
  description: string | null
  task_number: number
  status: TaskStatus
  priority: TaskPriority
  operator_id: string | null
  staff_id?: string | null
  created_by: string | null
  company_id: string | null
  due_date: string | null
  tags: string[] | null
  checklist?: ChecklistItem[] | null
  created_at: string
  updated_at: string
  completed_at: string | null

  // Расширенные поля
  assignee_kind?: 'operator' | 'staff'
  assignee_name?: string
  assignee_short_name?: string | null
  assignee_telegram?: string | null
  creator_name?: string
  company_name?: string
  company_code?: string | null
  comments_count?: number
}

type TaskComment = {
  id: string
  task_id: string
  operator_id: string | null
  staff_id: string | null
  content: string
  created_at: string
  author_name?: string
  author_type?: 'operator' | 'staff'
}

type TasksQueryTask = Omit<Task, 'assignee_kind' | 'assignee_name' | 'assignee_short_name' | 'assignee_telegram' | 'creator_name' | 'company_name' | 'company_code' | 'comments_count'>

type TaskCardProps = {
  task: Task
  onClick: () => void
  onStatusChange: (status: TaskStatus) => void
  onNotify: () => void
  onDragStart: (task: Task) => void
  onDragEnd: () => void
  isDragging: boolean
}

type TaskDetailModalProps = {
  task: Task
  isOpen: boolean
  onClose: () => void
  operators: Operator[]
  staff: Staff[]
  companies: Company[]
  onNotify: () => void
  onTaskUpdated: () => Promise<void> | void
}

type CreateTaskModalProps = {
  isOpen: boolean
  onClose: () => void
  onSuccess: () => void
  operators: Operator[]
  staff: Staff[]
  companies: Company[]
  nextTaskNumber: number
}

// =====================
// CONSTANTS
// =====================
const STATUS_CONFIG: Record<TaskStatus, { title: string; color: string; icon: any }> = {
  backlog: { title: 'Бэклог', color: 'bg-slate-500/10 text-muted-foreground border-slate-500/20', icon: Clock },
  todo: { title: 'К выполнению', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: CheckCircle2 },
  in_progress: { title: 'В работе', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Briefcase },
  review: { title: 'На проверке', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: Eye },
  done: { title: 'Готово', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  archived: { title: 'Архив', color: 'bg-slate-500/10 text-muted-foreground border-slate-500/20', icon: EyeOff }
}

const PRIORITY_CONFIG: Record<TaskPriority, { icon: string; color: string; label: string }> = {
  critical: { icon: '🔥', color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'Критический' },
  high: { icon: '⚡', color: 'text-amber-400 bg-amber-500/10 border-amber-500/20', label: 'Высокий' },
  medium: { icon: '📌', color: 'text-blue-400 bg-blue-500/10 border-blue-500/20', label: 'Средний' },
  low: { icon: '💧', color: 'text-green-400 bg-green-500/10 border-green-500/20', label: 'Низкий' }
}

const RESPONSE_CONFIG: Record<
  TaskResponse,
  { label: string; status: TaskStatus; tone: string; helper: string }
> = {
  accept: {
    label: 'Принял в работу',
    status: 'in_progress',
    tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200 hover:bg-emerald-500/20',
    helper: 'Задача сразу перейдет в колонку "В работе".',
  },
  need_info: {
    label: 'Нужны уточнения',
    status: 'backlog',
    tone: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-200 hover:bg-sky-500/20',
    helper: 'Задача вернется в ожидание уточнений.',
  },
  blocked: {
    label: 'Не могу выполнить',
    status: 'backlog',
    tone: 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-200 hover:bg-rose-500/20',
    helper: 'Руководитель увидит, что задача заблокирована.',
  },
  already_done: {
    label: 'Уже сделано',
    status: 'review',
    tone: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200 hover:bg-violet-500/20',
    helper: 'Задача уйдет на проверку.',
  },
  complete: {
    label: 'Завершил задачу',
    status: 'done',
    tone: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-200 hover:bg-amber-500/20',
    helper: 'Задача будет закрыта как выполненная.',
  },
}

const TASK_RESPONSE_ORDER: TaskResponse[] = ['accept', 'need_info', 'blocked', 'already_done', 'complete']

const COMPANY_COLORS: Record<string, string> = {
  arena: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400',
  ramen: 'border-amber-500/30 bg-amber-500/5 text-amber-400',
  extra: 'border-violet-500/30 bg-violet-500/5 text-violet-400'
}

// =====================
// UTILS
// =====================
const formatDate = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('ru-RU', { 
    day: 'numeric', 
    month: 'short',
    year: 'numeric'
  })
}

const formatDateTime = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleString('ru-RU')
}

const isOverdue = (dueDate: string | null, status: string) => {
  if (!dueDate || status === 'done' || status === 'archived') return false
  return new Date(dueDate) < new Date()
}

const getDaysUntilDue = (dueDate: string | null) => {
  if (!dueDate) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(dueDate)
  due.setHours(0, 0, 0, 0)
  const diffTime = due.getTime() - today.getTime()
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
  return diffDays
}

const getCompanyStyle = (code: string | null) => {
  if (!code) return 'border-slate-500/30 bg-slate-500/5 text-muted-foreground'
  return COMPANY_COLORS[code.toLowerCase()] || 'border-slate-500/30 bg-slate-500/5 text-muted-foreground'
}

const createEmptyTaskForm = (): TaskFormState => ({
  title: '',
  description: '',
  priority: 'medium',
  status: 'todo',
  assignee: '',
  company_id: '',
  due_date: '',
  tags: '',
})

const taskAssigneeValue = (task: Pick<Task, 'operator_id' | 'staff_id'>) =>
  task.operator_id ? `op:${task.operator_id}` : task.staff_id ? `st:${task.staff_id}` : ''

const assigneeToPayload = (assignee: string) => ({
  operator_id: assignee.startsWith('op:') ? assignee.slice(3) : null,
  staff_id: assignee.startsWith('st:') ? assignee.slice(3) : null,
})

const toTaskFormState = (task: Task): TaskFormState => ({
  title: task.title,
  description: task.description || '',
  priority: task.priority,
  status: task.status,
  assignee: taskAssigneeValue(task),
  company_id: task.company_id || '',
  due_date: task.due_date || '',
  tags: task.tags?.join(', ') || '',
})

const parseTags = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const enrichTasks = (taskRows: TasksQueryTask[], operators: Operator[], staff: Staff[], companies: Company[]): Task[] =>
  taskRows.map((task) => {
    const operator = operators.find((item) => item.id === task.operator_id)
    const staffAssignee = !operator && task.staff_id ? staff.find((item) => item.id === task.staff_id) : undefined
    const creator = task.created_by ? staff.find((item) => item.id === task.created_by) : undefined
    const company = companies.find((item) => item.id === task.company_id)

    return {
      ...task,
      assignee_kind: operator ? 'operator' as const : staffAssignee ? 'staff' as const : undefined,
      assignee_name: operator
        ? getOperatorDisplayName(operator, 'Оператор')
        : staffAssignee
          ? staffAssignee.full_name || staffAssignee.short_name || 'Сотрудник'
          : undefined,
      assignee_short_name: operator
        ? getOperatorShortLabel(operator, 'Оператор')
        : staffAssignee
          ? staffAssignee.short_name || staffAssignee.full_name
          : undefined,
      assignee_telegram: operator?.telegram_chat_id || staffAssignee?.telegram_chat_id || null,
      creator_name: creator ? creator.short_name || creator.full_name : undefined,
      company_name: company?.name,
      company_code: company?.code ?? null,
    }
  })

// =====================
// LOADING COMPONENT
// =====================
function TasksLoading() {
  return (
    <>
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
            <Kanban className="w-8 h-8 text-white" />
          </div>
          <p className="text-muted-foreground">Загрузка задач...</p>
        </div>
    </>
  )
}

// =====================
// MAIN CONTENT COMPONENT
// =====================
function TasksContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const { can } = useCapabilities()

  // Состояния
  const [tasks, setTasks] = useState<Task[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // На телефоне канбан из шести колонок неудобен — стартуем со списка.
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) return 'list'
    return 'kanban'
  })
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set())
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null)
  const realtimeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Фильтры
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '')
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || 'all')
  const [filterPriority, setFilterPriority] = useState(searchParams.get('priority') || 'all')
  const [filterAssignee, setFilterAssignee] = useState(searchParams.get('assignee') || 'all')
  const [filterCompany, setFilterCompany] = useState(searchParams.get('company') || 'all')

  // Загрузка данных
  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const response = await fetch('/api/admin/tasks?includeLookups=1', { cache: 'no-store' })
      const json = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      const operatorsData = Array.isArray(json?.operators) ? (json.operators as Operator[]) : []
      const staffData = Array.isArray(json?.staff) ? (json.staff as Staff[]) : []
      const companiesData = Array.isArray(json?.companies) ? (json.companies as Company[]) : []
      const tasksData = Array.isArray(json?.data) ? (json.data as TasksQueryTask[]) : []

      setOperators(operatorsData)
      setStaff(staffData)
      setCompanies(companiesData)
      setTasks(enrichTasks(tasksData, operatorsData, staffData, companiesData))
    } catch (err) {
      console.error('Error loading data:', err)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    const scheduleRefresh = () => {
      if (isCreateModalOpen || isTaskModalOpen) return
      if (realtimeRefreshRef.current) {
        clearTimeout(realtimeRefreshRef.current)
      }
      realtimeRefreshRef.current = setTimeout(() => {
        loadData(true)
      }, 250)
    }

    const channel = supabase
      .channel('tasks-live-updates')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tasks' },
        scheduleRefresh,
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'task_comments' },
        scheduleRefresh,
      )
      .subscribe()

    return () => {
      if (realtimeRefreshRef.current) {
        clearTimeout(realtimeRefreshRef.current)
      }
      supabase.removeChannel(channel)
    }
  }, [loadData])

  useEffect(() => {
    let isRefreshing = false

    const refreshIfVisible = async () => {
      if (document.visibilityState !== 'visible' || isRefreshing) return
      if (isCreateModalOpen || isTaskModalOpen) return
      isRefreshing = true
      try {
        await loadData(true)
      } finally {
        isRefreshing = false
      }
    }

    const intervalId = window.setInterval(() => {
      refreshIfVisible()
    }, 4000)

    const onFocus = () => {
      refreshIfVisible()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        refreshIfVisible()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadData])

  useEffect(() => {
    if (!selectedTask) return

    const freshTask = tasks.find((task) => task.id === selectedTask.id)
    if (freshTask) {
      const hasChanged =
        freshTask.updated_at !== selectedTask.updated_at ||
        freshTask.status !== selectedTask.status ||
        freshTask.title !== selectedTask.title

      if (hasChanged) {
        setSelectedTask(freshTask)
      }
    }
  }, [tasks, selectedTask])

  // Синхронизация фильтров с URL
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchTerm) params.set('q', searchTerm)
    if (filterStatus !== 'all') params.set('status', filterStatus)
    if (filterPriority !== 'all') params.set('priority', filterPriority)
    if (filterAssignee !== 'all') params.set('assignee', filterAssignee)
    if (filterCompany !== 'all') params.set('company', filterCompany)

    router.replace(`/tasks?${params.toString()}`, { scroll: false })
  }, [searchTerm, filterStatus, filterPriority, filterAssignee, filterCompany, router])

  // Фильтрация задач
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      // Поиск
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const matches =
          task.title.toLowerCase().includes(term) ||
          task.task_number.toString().includes(term) ||
          task.assignee_name?.toLowerCase().includes(term) ||
          task.description?.toLowerCase().includes(term)
        if (!matches) return false
      }

      // Фильтр по статусу
      if (filterStatus === 'overdue') {
        return isOverdue(task.due_date, task.status)
      }
      if (filterStatus !== 'all' && task.status !== filterStatus) return false

      // Фильтр по приоритету
      if (filterPriority !== 'all' && task.priority !== filterPriority) return false

      // Фильтр по исполнителю (оператор или сотрудник)
      if (filterAssignee !== 'all' && taskAssigneeValue(task) !== filterAssignee) return false

      // Фильтр по компании
      if (filterCompany !== 'all' && task.company_id !== filterCompany) return false

      return true
    })
  }, [tasks, searchTerm, filterStatus, filterPriority, filterAssignee, filterCompany])

  // Группировка по статусам
  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {}
    Object.keys(STATUS_CONFIG).forEach(status => {
      grouped[status] = filteredTasks.filter(t => t.status === status)
    })
    return grouped
  }, [filteredTasks])

  // Статистика
  const stats = useMemo(() => {
    const total = filteredTasks.length
    const overdue = filteredTasks.filter(t => isOverdue(t.due_date, t.status)).length
    const critical = filteredTasks.filter(t => t.priority === 'critical' && t.status !== 'done').length

    return { total, overdue, critical }
  }, [filteredTasks])

  // Сортировка списка
  const [sortBy, setSortBy] = useState<'number' | 'due' | 'priority'>('number')
  const sortedListTasks = useMemo(() => {
    const priorityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
    const arr = [...filteredTasks]
    if (sortBy === 'due') {
      arr.sort((a, b) => (a.due_date || '9999-12-31').localeCompare(b.due_date || '9999-12-31') || b.task_number - a.task_number)
    } else if (sortBy === 'priority') {
      arr.sort((a, b) => (priorityOrder[a.priority] ?? 9) - (priorityOrder[b.priority] ?? 9) || b.task_number - a.task_number)
    } else {
      arr.sort((a, b) => b.task_number - a.task_number)
    }
    return arr
  }, [filteredTasks, sortBy])

  const nextTaskNumber = useMemo(
    () => tasks.reduce((maxNumber, task) => Math.max(maxNumber, task.task_number || 0), 0) + 1,
    [tasks],
  )

  // Сброс выбора при смене вида
  useEffect(() => {
    setSelectedTaskIds(new Set())
  }, [viewMode])

  // Bulk selection helpers
  const toggleTaskSelection = (id: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const bulkUpdateStatus = async (status: TaskStatus) => {
    if (selectedTaskIds.size === 0) return
    const ids = Array.from(selectedTaskIds)
    try {
      await Promise.all(
        ids.map(async (taskId) => {
          const response = await fetch('/api/admin/tasks', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'changeStatus',
              taskId,
              status,
            }),
          })

          const json = await response.json().catch(() => null)
          if (!response.ok) {
            throw new Error(json?.error || `Ошибка запроса (${response.status})`)
          }
        }),
      )

      setSelectedTaskIds(new Set())
      await loadData(true)
    } catch (error) {
      toast({
        title: 'Не удалось обновить задачи',
        description: error instanceof Error ? error.message : 'Попробуй ещё раз',
        variant: 'destructive',
      })
    }
  }

  // Обработчики
  const resetFilters = () => {
    setSearchTerm('')
    setFilterStatus('all')
    setFilterPriority('all')
    setFilterAssignee('all')
    setFilterCompany('all')
  }

  const handleStatusChange = async (taskId: string, newStatus: TaskStatus) => {
    try {
      const response = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'changeStatus',
          taskId,
          status: newStatus,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      await loadData(true)
      toast({
        title: 'Статус обновлён',
        description: `Задача переведена в статус "${STATUS_CONFIG[newStatus].title}".`,
      })
    } catch (error: any) {
      toast({
        title: 'Не удалось обновить статус',
        description: error?.message || 'Попробуй ещё раз',
        variant: 'destructive',
      })
    }
  }

  const handleNotifyOperator = async (task: Task) => {
    if (!task.assignee_telegram) {
      toast({
        title: 'Telegram не настроен',
        description: 'У исполнителя нет привязанного Telegram.',
        variant: 'destructive',
      })
      return
    }

    try {
      const response = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'notifyTask',
          taskId: task.id,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      toast({
        title: 'Уведомление отправлено',
        description: `${task.assignee_name || task.assignee_short_name || 'Исполнитель'} получил сообщение в Telegram.`,
      })
    } catch (error: any) {
      toast({
        title: 'Telegram не отправлен',
        description: error?.message || 'Не удалось отправить уведомление в Telegram',
        variant: 'destructive',
      })
    }
  }

  const handleTaskDrop = async (targetStatus: TaskStatus) => {
    if (!draggedTask) return

    const taskToMove = draggedTask
    setDraggedTask(null)
    setDragOverStatus(null)

    if (taskToMove.status === targetStatus) return
    await handleStatusChange(taskToMove.id, targetStatus)
  }

  // Быстрая задача прямо из колонки канбана: только название, остальное — умные
  // дефолты из активных фильтров (иначе созданная задача сразу пропадает из вида).
  const quickCreateTask = async (status: TaskStatus, title: string): Promise<boolean> => {
    const companyId = filterCompany !== 'all' ? filterCompany : (companies[0]?.id || '')
    const priority: TaskPriority =
      filterPriority !== 'all' ? (filterPriority as TaskPriority) : 'medium'
    try {
      const response = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'createTask',
          payload: {
            title,
            description: null,
            priority,
            status,
            ...assigneeToPayload(filterAssignee !== 'all' ? filterAssignee : ''),
            company_id: companyId,
            due_date: null,
            tags: [],
          },
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      await loadData(true)
      return true
    } catch (error: any) {
      toast({ title: 'Задача не создана', description: error?.message || 'Попробуй ещё раз', variant: 'destructive' })
      return false
    }
  }

  // Напомнить в Telegram всем исполнителям просроченных задач разом.
  const [notifyingAll, setNotifyingAll] = useState(false)
  const handleNotifyAllOverdue = async (overdueTasks: Task[]) => {
    const withTelegram = overdueTasks.filter((t) => t.assignee_telegram)
    if (withTelegram.length === 0) {
      toast({ title: 'Некому отправлять', description: 'Ни у одного исполнителя просроченных задач нет Telegram.', variant: 'destructive' })
      return
    }
    setNotifyingAll(true)
    let sent = 0
    let failed = 0
    for (const t of withTelegram) {
      try {
        const response = await fetch('/api/admin/tasks', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'notifyTask', taskId: t.id }),
        })
        if (response.ok) sent += 1
        else failed += 1
      } catch {
        failed += 1
      }
    }
    setNotifyingAll(false)
    const skipped = overdueTasks.length - withTelegram.length
    toast({
      title: 'Напоминания отправлены',
      description: `Отправлено: ${sent}${failed ? ` · ошибок: ${failed}` : ''}${skipped ? ` · без Telegram: ${skipped}` : ''}`,
    })
  }

  if (loading && !refreshing) {
    return <TasksLoading />
  }

  if (error) {
    return (
    <>
          <div className="app-page-wide">
          <Card className="p-6 border-red-500/30 bg-red-500/10">
            <div className="flex items-center gap-2 text-red-300">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
            <Button onClick={() => loadData(true)} className="mt-4 bg-violet-500 hover:bg-violet-600">
              <RefreshCw className="w-4 h-4 mr-2" />
              Повторить
            </Button>
          </Card>
          </div>
    </>
  )
  }

  return (
    <>
        <div className="app-page-wide space-y-6">
          {/* Header */}
          <AdminPageHeader
            title="Задачи"
            description="Задачи операторов и сотрудников — уведомления и ответы в Telegram"
            icon={<Kanban className="h-5 w-5" />}
            accent="blue"
            backHref="/"
            actions={
              <>
                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl border-border bg-white dark:bg-slate-900/50 backdrop-blur-xl hover:bg-surface-hover ${refreshing ? 'animate-spin' : ''}`}
                  onClick={() => loadData(true)}
                  title="Обновить"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>

                <div className="flex bg-white dark:bg-slate-900/50 backdrop-blur-xl rounded-xl p-1 border border-border">
                  <button
                    onClick={() => setViewMode('kanban')}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'kanban' ? 'bg-surface-hover text-foreground' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'
                    )}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'list' ? 'bg-surface-hover text-foreground' : 'text-muted-foreground hover:text-slate-900 dark:hover:text-white'
                    )}
                  >
                    <LayoutList className="w-4 h-4" />
                  </button>
                </div>

                {can('tasks.create') && (
                  <Button
                    onClick={() => setIsCreateModalOpen(true)}
                    className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 gap-2"
                  >
                    <Plus className="w-4 h-4" />
                    Новая задача
                  </Button>
                )}
              </>
            }
          />

          {/* Stats Cards */}
          <div className="grid grid-cols-3 gap-2 sm:gap-4">
            <Card className="p-3 sm:p-4 bg-white dark:bg-slate-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
              <p className="text-[11px] sm:text-xs text-slate-500">Всего задач</p>
              <p className="text-xl sm:text-2xl font-bold text-foreground">{stats.total}</p>
            </Card>
            <Card className="p-3 sm:p-4 bg-red-500/5 border-red-500/20">
              <p className="text-[11px] sm:text-xs text-red-400">Просрочено</p>
              <p className="text-xl sm:text-2xl font-bold text-red-400">{stats.overdue}</p>
            </Card>
            <Card className="p-3 sm:p-4 bg-rose-500/5 border-rose-500/20">
              <p className="text-[11px] sm:text-xs text-rose-400">Критических</p>
              <p className="text-xl sm:text-2xl font-bold text-rose-400">{stats.critical}</p>
            </Card>
          </div>

          {/* Filters */}
          <Card className="p-3 sm:p-4 bg-white dark:bg-slate-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
              {/* Поиск — на телефоне во всю ширину */}
              <div className="relative w-full sm:max-w-xs sm:flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Поиск задач..."
                  className="w-full pl-9 pr-8 py-2 bg-white dark:bg-slate-800/50 border border-border rounded-lg text-sm text-foreground placeholder-slate-500 focus:outline-none focus:border-violet-500/50"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-900 dark:hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Селекты — на телефоне сеткой 2×2 */}
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center sm:gap-3">
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-800/50 border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-violet-500/50 sm:w-auto"
                >
                  <option value="all">Все статусы</option>
                  {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                    <option key={key} value={key}>{config.title}</option>
                  ))}
                </select>

                <select
                  value={filterPriority}
                  onChange={(e) => setFilterPriority(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-800/50 border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-violet-500/50 sm:w-auto"
                >
                  <option value="all">Все приоритеты</option>
                  {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                    <option key={key} value={key}>{config.icon} {config.label}</option>
                  ))}
                </select>

                <select
                  value={filterAssignee}
                  onChange={(e) => setFilterAssignee(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-800/50 border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-violet-500/50 sm:w-auto"
                >
                  <option value="all">Все исполнители</option>
                  <optgroup label="Операторы">
                    {operators.map(op => (
                      <option key={op.id} value={`op:${op.id}`}>
                        {getOperatorDisplayName(op)} {op.telegram_chat_id ? '📱' : ''}
                      </option>
                    ))}
                  </optgroup>
                  {staff.length > 0 && (
                    <optgroup label="Сотрудники">
                      {staff.map(member => (
                        <option key={member.id} value={`st:${member.id}`}>
                          {member.full_name || member.short_name} {member.telegram_chat_id ? '📱' : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>

                <select
                  value={filterCompany}
                  onChange={(e) => setFilterCompany(e.target.value)}
                  className="w-full min-w-0 px-3 py-2 bg-white dark:bg-slate-800/50 border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-violet-500/50 sm:w-auto"
                >
                  <option value="all">Все компании</option>
                  {companies.map(company => (
                    <option key={company.id} value={company.id}>{company.name}</option>
                  ))}
                </select>
              </div>

              <div className="flex w-full items-center gap-2 sm:w-auto">
                {/* Фильтр "Просроченные" */}
                <button
                  onClick={() => setFilterStatus(filterStatus === 'overdue' ? 'all' : 'overdue')}
                  className={cn(
                    "flex-1 sm:flex-none px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center justify-center gap-1.5",
                    filterStatus === 'overdue'
                      ? 'bg-red-500/20 border-red-500/40 text-red-300'
                      : 'bg-white dark:bg-slate-800/50 border-border text-muted-foreground hover:text-red-300 hover:border-red-500/30'
                  )}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  Просроченные
                  {stats.overdue > 0 && (
                    <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] bg-red-500/30 text-red-300">
                      {stats.overdue}
                    </span>
                  )}
                </button>

                {/* Сброс фильтров */}
                {(searchTerm || filterStatus !== 'all' || filterPriority !== 'all' ||
                  filterAssignee !== 'all' || filterCompany !== 'all') && (
                  <button
                    onClick={resetFilters}
                    className="shrink-0 text-sm text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors sm:ml-auto"
                  >
                    Сбросить
                  </button>
                )}
              </div>
            </div>
          </Card>

          {/* Всё скрыто фильтрами — задачи есть, но ни одна не проходит */}
          {filteredTasks.length === 0 && tasks.length > 0 && (
            <div className="flex flex-col items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <EyeOff className="h-5 w-5 shrink-0 text-amber-500" />
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Все задачи скрыты фильтрами: показано 0 из {tasks.length}. Проверьте статус, приоритет и исполнителя.
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0 border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/10"
                onClick={resetFilters}
              >
                Сбросить фильтры
              </Button>
            </div>
          )}

          {/* Overdue Banner */}
          {(() => {
            const overdueTasks = filteredTasks.filter(t => isOverdue(t.due_date, t.status))
            if (overdueTasks.length === 0) return null
            return (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-5 h-5 text-red-400" />
                    <h3 className="text-sm font-semibold text-red-400">
                      Просроченные задачи: {overdueTasks.length}
                    </h3>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10 text-xs gap-1.5"
                    onClick={() => void handleNotifyAllOverdue(overdueTasks)}
                    disabled={notifyingAll}
                  >
                    {notifyingAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    Напомнить всем в Telegram
                  </Button>
                </div>
                <div className="space-y-2">
                  {overdueTasks.slice(0, 5).map(task => {
                    const days = getDaysUntilDue(task.due_date)
                    return (
                      <button
                        key={task.id}
                        onClick={() => { setSelectedTask(task); setIsTaskModalOpen(true) }}
                        className="w-full text-left flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs text-red-400 font-mono shrink-0">#{task.task_number}</span>
                          <span className="text-sm text-foreground truncate">{task.title}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-muted-foreground">{formatDate(task.due_date)}</span>
                          {days !== null && days < 0 && (
                            <span className="text-xs text-red-400 font-medium">
                              просрочено на {Math.abs(days)} дн.
                            </span>
                          )}
                        </div>
                      </button>
                    )
                  })}
                  {overdueTasks.length > 5 && (
                    <p className="text-xs text-slate-500 pl-1">
                      … и ещё {overdueTasks.length - 5} просроченных задач
                    </p>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Content */}
          {viewMode === 'kanban' ? (
            // Kanban View — на телефоне колонки почти во весь экран с доводкой свайпа
            <div className="flex gap-3 sm:gap-4 overflow-x-auto pb-4 min-h-[600px] snap-x snap-mandatory sm:snap-none">
              {Object.entries(STATUS_CONFIG).map(([status, config]) => {
                const statusTasks = tasksByStatus[status] || []
                const Icon = config.icon
                
                return (
                  <div
                    key={status}
                    onDragOver={(event) => {
                      event.preventDefault()
                      setDragOverStatus(status as TaskStatus)
                    }}
                    onDragLeave={() => {
                      if (dragOverStatus === status) setDragOverStatus(null)
                    }}
                    onDrop={async (event) => {
                      event.preventDefault()
                      await handleTaskDrop(status as TaskStatus)
                    }}
                    className={cn(
                      "w-[86vw] max-w-[320px] sm:w-80 sm:max-w-none flex-shrink-0 snap-center sm:snap-align-none rounded-xl border backdrop-blur-xl p-3 transition-colors",
                      dragOverStatus === status
                        ? 'border-violet-400/50 bg-violet-500/10'
                        : 'border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/40',
                    )}
                  >
                    {/* Заголовок колонки */}
                    <div className="flex items-center justify-between mb-3 px-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("w-4 h-4", config.color.split(' ')[0])} />
                        <h3 className="font-medium text-sm">{config.title}</h3>
                      </div>
                      <span className="text-xs bg-slate-100 dark:bg-white/5 px-2 py-1 rounded-full">
                        {statusTasks.length}
                      </span>
                    </div>

                    {/* Задачи */}
                    <div className="space-y-2 min-h-[200px]">
                      {statusTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onClick={() => {
                            setSelectedTask(task)
                            setIsTaskModalOpen(true)
                          }}
                          onStatusChange={(newStatus) => handleStatusChange(task.id, newStatus)}
                          onNotify={() => handleNotifyOperator(task)}
                          onDragStart={(currentTask) => setDraggedTask(currentTask)}
                          onDragEnd={() => {
                            setDraggedTask(null)
                            setDragOverStatus(null)
                          }}
                          isDragging={draggedTask?.id === task.id}
                        />
                      ))}
                      {statusTasks.length === 0 && (
                        <div
                          className={cn(
                            "text-center py-8 text-xs text-slate-500 border border-dashed rounded-lg transition-colors",
                            dragOverStatus === status ? 'border-violet-400/50 bg-violet-500/5' : 'border-slate-200 dark:border-white/5',
                          )}
                        >
                          Нет задач
                        </div>
                      )}
                    </div>

                    {can('tasks.create') && status !== 'archived' && (
                      <QuickAddTask status={status as TaskStatus} onCreate={quickCreateTask} />
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            // List View
            <Card className="bg-white dark:bg-slate-900/40 backdrop-blur-xl border-slate-200 dark:border-white/5 overflow-hidden">
              {/* Bulk action bar */}
              {selectedTaskIds.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 bg-violet-500/10 border-b border-violet-500/20">
                  <span className="text-sm text-violet-300 font-medium">
                    {selectedTaskIds.size} задач выбрано
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    {can('tasks.edit') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10 hover:text-yellow-200 text-xs"
                        onClick={() => bulkUpdateStatus('in_progress')}
                      >
                        В работу
                      </Button>
                    )}
                    {can('tasks.edit') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 hover:text-purple-200 text-xs"
                        onClick={() => bulkUpdateStatus('review')}
                      >
                        На проверку
                      </Button>
                    )}
                    {can('tasks.bulk_complete') && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 text-xs"
                        onClick={() => bulkUpdateStatus('done')}
                      >
                        Готово
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-border text-muted-foreground hover:bg-surface-muted text-xs"
                      onClick={() => setSelectedTaskIds(new Set())}
                    >
                      Снять выбор
                    </Button>
                  </div>
                </div>
              )}
              <div className="flex items-center justify-end gap-2 border-b border-slate-200 dark:border-white/5 px-4 py-2">
                <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as 'number' | 'due' | 'priority')}
                  className="h-8 rounded-lg border border-border bg-white dark:bg-slate-800/50 px-2 text-xs text-foreground outline-none"
                >
                  <option value="number">Сначала новые</option>
                  <option value="due">По сроку</option>
                  <option value="priority">По приоритету</option>
                </select>
              </div>
              {/* Мобильный список карточками — таблица на телефоне нечитаема */}
              <div className="md:hidden divide-y divide-slate-100 dark:divide-white/5">
                {sortedListTasks.map((task) => {
                  const overdueRow = isOverdue(task.due_date, task.status)
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => { setSelectedTask(task); setIsTaskModalOpen(true) }}
                      className="w-full px-4 py-3 text-left transition-colors active:bg-surface-muted"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug text-foreground">{task.title}</span>
                        <span className="shrink-0 font-mono text-[10px] text-slate-500">#{task.task_number}</span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
                        <span className="rounded-full border border-border bg-surface-muted px-1.5 py-0.5 text-muted-foreground">
                          {STATUS_CONFIG[task.status]?.title || task.status}
                        </span>
                        <span className={cn('rounded-full px-1.5 py-0.5', PRIORITY_CONFIG[task.priority]?.color)}>
                          {PRIORITY_CONFIG[task.priority]?.icon} {PRIORITY_CONFIG[task.priority]?.label}
                        </span>
                        {task.due_date && (
                          <span className={cn('flex items-center gap-1', overdueRow ? 'text-red-400 font-medium' : 'text-slate-500')}>
                            <Calendar className="h-3 w-3" />
                            {formatDate(task.due_date)}
                            {overdueRow ? ' · просрочено' : ''}
                          </span>
                        )}
                        {(task.assignee_short_name || task.assignee_name) && (
                          <span className="text-slate-500">· {task.assignee_short_name || task.assignee_name}</span>
                        )}
                      </div>
                    </button>
                  )
                })}
                {sortedListTasks.length === 0 && (
                  <p className="px-4 py-8 text-center text-sm text-slate-500">Нет задач по выбранным фильтрам</p>
                )}
              </div>

              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 dark:border-white/5 bg-slate-50 dark:bg-slate-900/50">
                      <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground w-10">
                        <Checkbox
                          checked={filteredTasks.length > 0 && filteredTasks.every(t => selectedTaskIds.has(t.id))}
                          onCheckedChange={(checked) => {
                            if (checked) {
                              setSelectedTaskIds(new Set(filteredTasks.map(t => t.id)))
                            } else {
                              setSelectedTaskIds(new Set())
                            }
                          }}
                          className="border-white/20"
                        />
                      </th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">#</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Задача</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Статус</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Приоритет</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Исполнитель</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Дедлайн</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground">Компания</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                    {sortedListTasks.map(task => (
                      <tr
                        key={task.id}
                        onClick={() => {
                          setSelectedTask(task)
                          setIsTaskModalOpen(true)
                        }}
                        className={cn(
                          "hover:bg-surface-muted transition-colors cursor-pointer",
                          selectedTaskIds.has(task.id) && "bg-violet-500/5"
                        )}
                      >
                        <td
                          className="py-3 px-4"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <Checkbox
                            checked={selectedTaskIds.has(task.id)}
                            onCheckedChange={() => toggleTaskSelection(task.id)}
                            className="border-slate-300 dark:border-white/20"
                          />
                        </td>
                        <td className="py-3 px-4 text-sm text-muted-foreground">#{task.task_number}</td>
                        <td className="py-3 px-4">
                          <span className="text-sm text-foreground line-clamp-1">{task.title}</span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "text-xs px-2 py-1 rounded-full border",
                            STATUS_CONFIG[task.status]?.color
                          )}>
                            {STATUS_CONFIG[task.status]?.title}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "text-xs px-2 py-1 rounded-full border",
                            PRIORITY_CONFIG[task.priority]?.color
                          )}>
                            {PRIORITY_CONFIG[task.priority]?.icon} {PRIORITY_CONFIG[task.priority]?.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              'w-6 h-6 rounded-full bg-gradient-to-br flex items-center justify-center text-[10px] font-bold text-white',
                              task.assignee_kind === 'staff' ? 'from-sky-500 to-cyan-500' : 'from-purple-500 to-pink-500',
                            )}>
                              {task.assignee_name?.[0] || task.assignee_short_name?.[0] || '?'}
                            </div>
                            <span className="text-sm text-body">
                              {task.assignee_name || task.assignee_short_name || '—'}
                            </span>
                            {task.assignee_telegram && (
                              <Send className="w-3 h-3 text-blue-400" />
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {task.due_date ? (
                            <span className={cn(
                              "text-sm",
                              isOverdue(task.due_date, task.status) ? "text-red-400" : "text-body"
                            )}>
                              {formatDate(task.due_date)}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {task.company_name ? (
                            <span className={cn(
                              "text-xs px-2 py-1 rounded-full border",
                              getCompanyStyle(task.company_code ?? null)
                            )}>
                              {task.company_name}
                            </span>
                          ) : (
                            <span className="text-slate-500">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Bottom info */}
          <div className="flex justify-between items-center text-xs text-slate-500">
            <div>
              Показано {filteredTasks.length} из {tasks.length} задач
            </div>
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Arena
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Ramen
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-violet-500" />
                Extra
              </span>
            </div>
          </div>
        </div>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={isTaskModalOpen}
          onClose={() => {
            setIsTaskModalOpen(false)
            setSelectedTask(null)
          }}
          operators={operators}
          staff={staff}
          companies={companies}
          onNotify={() => handleNotifyOperator(selectedTask)}
          onTaskUpdated={() => loadData(true)}
        />
      )}

      {/* Create Task Modal */}
      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          loadData(true)
          setIsCreateModalOpen(false)
        }}
        operators={operators}
        staff={staff}
        companies={companies}
        nextTaskNumber={nextTaskNumber}
      />
    </>
  )
}

// =====================
// TASK CARD COMPONENT
// =====================
function TaskCard({ task, onClick, onStatusChange, onNotify, onDragStart, onDragEnd, isDragging }: TaskCardProps) {
  const [showMenu, setShowMenu] = useState(false)
  const isTaskOverdue = isOverdue(task.due_date, task.status)
  const daysUntilDue = getDaysUntilDue(task.due_date)

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', task.id)
        onDragStart(task)
      }}
      onDragEnd={onDragEnd}
      onClick={onClick}
      className={cn(
        "bg-white dark:bg-slate-800/50 border border-slate-200 dark:border-white/5 rounded-lg p-3 hover:bg-slate-100 dark:hover:bg-slate-700/50 transition-colors cursor-pointer relative group",
        isDragging && 'opacity-50 ring-1 ring-violet-400/40',
      )}
    >
      {/* Кнопки действий */}
      <div className="absolute top-2 right-2 flex gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        {task.assignee_telegram && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onNotify()
            }}
            className="p-1 hover:bg-blue-500/20 rounded text-blue-400"
            title="Отправить в Telegram"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        )}
        <button
          onClick={(e) => {
            e.stopPropagation()
            setShowMenu(!showMenu)
          }}
          className="p-1 hover:bg-surface-hover rounded"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        
        {showMenu && (
          <div className="absolute right-0 mt-6 w-40 bg-card border border-border rounded-lg shadow-xl z-10">
            {Object.entries(STATUS_CONFIG).map(([status, config]) => {
              if (status === task.status || status === 'archived') return null
              return (
                <button
                  key={status}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStatusChange(status as TaskStatus)
                    setShowMenu(false)
                  }}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-surface-muted flex items-center gap-2"
                >
                  {config.title}
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Номер и заголовок */}
      <div className="pr-16 mb-2">
        <span className="text-[10px] text-slate-500">#{task.task_number}</span>
        <h4 className="font-medium text-sm line-clamp-2 mt-1">{task.title}</h4>
      </div>

      {/* Приоритет */}
      <div className="mb-2">
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full",
          PRIORITY_CONFIG[task.priority]?.color
        )}>
          {PRIORITY_CONFIG[task.priority]?.icon} {PRIORITY_CONFIG[task.priority]?.label}
        </span>
      </div>

      {/* Прогресс чек-листа */}
      {Array.isArray(task.checklist) && task.checklist.length > 0 && (() => {
        const doneCount = task.checklist.filter((i) => i.done).length
        const total = task.checklist.length
        return (
          <div className="mb-2">
            <div className="flex items-center gap-1 text-[10px] text-slate-500">
              <CheckCircle2 className={cn('w-3 h-3', doneCount === total ? 'text-emerald-400' : '')} />
              <span>{doneCount}/{total}</span>
            </div>
            <div className="mt-1 h-1 w-full overflow-hidden rounded bg-slate-200 dark:bg-white/10">
              <div
                className={cn('h-full transition-all', doneCount === total ? 'bg-emerald-500' : 'bg-violet-500')}
                style={{ width: `${(doneCount / total) * 100}%` }}
              />
            </div>
          </div>
        )
      })()}

      {/* Исполнитель и компания */}
      <div className="flex items-center justify-between text-xs mb-2">
        <div className="flex items-center gap-1 text-muted-foreground">
          <div className={cn(
            'w-5 h-5 rounded-full bg-gradient-to-br flex items-center justify-center text-[8px] font-bold text-white',
            task.assignee_kind === 'staff' ? 'from-sky-500 to-cyan-500' : 'from-purple-500 to-pink-500',
          )}>
            {task.assignee_short_name?.[0] || task.assignee_name?.[0] || '?'}
          </div>
          <span className="text-[10px]">{task.assignee_name || task.assignee_short_name || 'Не назначен'}</span>
          {task.assignee_telegram && (
            <Send className="w-2.5 h-2.5 text-blue-400" />
          )}
        </div>

        {task.company_name && (
          <span className={cn(
            "text-[8px] px-1.5 py-0.5 rounded-full border",
            getCompanyStyle(task.company_code ?? null)
          )}>
            {task.company_name}
          </span>
        )}
      </div>

      {/* Дедлайн + комментарии */}
      <div className="flex items-center justify-between mt-1">
        {task.due_date ? (
          <div className={cn(
            "flex items-center gap-1 text-[10px]",
            isTaskOverdue ? "text-red-400" : "text-slate-500"
          )}>
            <Calendar className="w-3 h-3" />
            <span>{formatDate(task.due_date)}</span>
            {isTaskOverdue && <span className="text-red-400">(просрочено)</span>}
            {!isTaskOverdue && daysUntilDue !== null && daysUntilDue <= 3 && daysUntilDue >= 0 && (
              <span className="text-yellow-400">(осталось {daysUntilDue} дн.)</span>
            )}
          </div>
        ) : <span />}
        {(task.comments_count ?? 0) > 0 && (
          <div className="flex items-center gap-0.5 text-[10px] text-slate-500">
            <MessageSquare className="w-3 h-3" />
            {task.comments_count}
          </div>
        )}
      </div>
    </div>
  )
}

// =====================
// БЫСТРАЯ ЗАДАЧА В КОЛОНКЕ
// =====================
function QuickAddTask({
  status,
  onCreate,
}: {
  status: TaskStatus
  onCreate: (status: TaskStatus, title: string) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const text = title.trim()
    if (!text || busy) return
    setBusy(true)
    const ok = await onCreate(status, text)
    setBusy(false)
    if (ok) setTitle('') // остаёмся в режиме ввода — можно накидать несколько подряд
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-white/10 py-2 text-xs text-slate-500 transition-colors hover:border-violet-400/50 hover:text-violet-400"
      >
        <Plus className="h-3.5 w-3.5" />
        Быстрая задача
      </button>
    )
  }

  return (
    <div className="mt-2 space-y-1.5">
      <Input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            void submit()
          }
          if (e.key === 'Escape') {
            setOpen(false)
            setTitle('')
          }
        }}
        placeholder="Название — Enter"
        className="h-8 bg-white dark:bg-slate-800/50 border-border text-sm"
        disabled={busy}
      />
      <div className="flex gap-1.5">
        <Button size="sm" className="h-7 flex-1 text-xs bg-violet-500 hover:bg-violet-600" onClick={() => void submit()} disabled={busy || !title.trim()}>
          {busy ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Добавить'}
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => { setOpen(false); setTitle('') }} disabled={busy}>
          Отмена
        </Button>
      </div>
    </div>
  )
}

// =====================
// ЧЕК-ЛИСТ ЗАДАЧИ
// =====================
function TaskChecklist({
  task,
  canEdit,
  onTaskUpdated,
}: {
  task: Task
  canEdit: boolean
  onTaskUpdated: () => Promise<void> | void
}) {
  const { toast } = useToast()
  const [items, setItems] = useState<ChecklistItem[]>(Array.isArray(task.checklist) ? task.checklist : [])
  const [newText, setNewText] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setItems(Array.isArray(task.checklist) ? task.checklist : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task.id, task.updated_at])

  const persist = async (next: ChecklistItem[]) => {
    const prev = items
    setItems(next)
    setSaving(true)
    try {
      const response = await fetch('/api/admin/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'updateTask', taskId: task.id, payload: { checklist: next } }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      await onTaskUpdated()
    } catch (error: any) {
      setItems(prev)
      toast({ title: 'Чек-лист не сохранён', description: error?.message || 'Попробуй ещё раз', variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const addItem = () => {
    const text = newText.trim()
    if (!text) return
    setNewText('')
    void persist([...items, { id: Math.random().toString(36).slice(2), text, done: false }])
  }

  const doneCount = items.filter((i) => i.done).length

  if (!canEdit && items.length === 0) return null

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-muted-foreground">
          Чек-лист{items.length > 0 ? ` · ${doneCount}/${items.length}` : ''}
        </h3>
        {saving && <RefreshCw className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      {items.length > 0 && (
        <div className="mb-2 h-1.5 w-full overflow-hidden rounded bg-slate-200 dark:bg-white/10">
          <div
            className={cn('h-full transition-all', doneCount === items.length ? 'bg-emerald-500' : 'bg-violet-500')}
            style={{ width: items.length ? `${(doneCount / items.length) * 100}%` : '0%' }}
          />
        </div>
      )}
      <div className="space-y-1">
        {items.map((item) => (
          <div key={item.id} className="group flex items-center gap-2 rounded-lg border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-800/50 px-3 py-2">
            <Checkbox
              checked={item.done}
              disabled={!canEdit || saving}
              onCheckedChange={(checked) =>
                void persist(items.map((i) => (i.id === item.id ? { ...i, done: checked === true } : i)))
              }
            />
            <span className={cn('flex-1 text-sm', item.done ? 'text-muted-foreground line-through' : 'text-foreground')}>
              {item.text}
            </span>
            {canEdit && (
              <button
                type="button"
                onClick={() => void persist(items.filter((i) => i.id !== item.id))}
                disabled={saving}
                className="text-muted-foreground opacity-0 transition hover:text-rose-400 group-hover:opacity-100"
                title="Удалить пункт"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>
      {canEdit && (
        <div className="mt-2 flex gap-2">
          <Input
            value={newText}
            onChange={(e) => setNewText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addItem()
              }
            }}
            placeholder="Новый пункт — Enter, чтобы добавить"
            className="h-8 bg-white dark:bg-slate-800/50 border-border text-sm"
            disabled={saving}
          />
          <Button type="button" size="sm" variant="outline" onClick={addItem} disabled={saving || !newText.trim()}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  )
}

// =====================
// TASK DETAIL MODAL
// =====================
function TaskDetailModal({
  task,
  isOpen,
  onClose,
  operators,
  staff,
  companies,
  onNotify,
  onTaskUpdated,
}: TaskDetailModalProps) {
  const { toast } = useToast()
  const { can } = useCapabilities()
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [responseNote, setResponseNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingTask, setSavingTask] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [responding, setResponding] = useState<TaskResponse | null>(null)
  const [editForm, setEditForm] = useState<TaskFormState>(() => toTaskFormState(task))

  const loadComments = useCallback(async () => {
    if (!task?.id) return
    const res = await fetch(`/api/admin/tasks?comments=1&taskId=${encodeURIComponent(task.id)}`, { cache: 'no-store' })
    const json = await res.json().catch(() => null)
    if (!res.ok || !Array.isArray(json?.comments)) return
    setComments(json.comments.map((c: any) => ({
      ...c,
      author_name:
        (c.operator_id
          ? getOperatorDisplayName(operators.find((o: Operator) => o.id === c.operator_id), 'Оператор')
          : null) ||
        (c.staff_id ? staff.find((item) => item.id === c.staff_id)?.full_name : null) ||
        'Система',
      author_type: c.operator_id ? 'operator' : c.staff_id ? 'staff' : undefined,
    })))
  }, [operators, staff, task])

  useEffect(() => {
    if (!isOpen || !task) return
    setEditForm(toTaskFormState(task))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, task?.id, task?.updated_at])

  useEffect(() => {
    if (!isOpen || !task) return
    setResponseNote('')
    loadComments()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, task?.id, loadComments])

  const handleAddComment = async () => {
    if (!newComment.trim()) return

    setLoading(true)
    const response = await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'addComment',
        taskId: task.id,
        content: newComment,
      }),
    })
    const json = await response.json().catch(() => null)

    setLoading(false)

    if (response.ok) {
      setNewComment('')
      loadComments()
      return
    }

    toast({
      title: 'Комментарий не добавлен',
      description: json?.error || 'Не удалось сохранить комментарий',
      variant: 'destructive',
    })
  }

  const handleTaskSave = async () => {
    if (!editForm.title.trim()) return

    setSavingTask(true)
    const payload = {
      title: editForm.title.trim(),
      description: editForm.description.trim() || null,
      priority: editForm.priority,
      status: editForm.status,
      ...assigneeToPayload(editForm.assignee),
      company_id: editForm.company_id || null,
      due_date: editForm.due_date || null,
      tags: parseTags(editForm.tags),
      completed_at: editForm.status === 'done' ? (task.completed_at || new Date().toISOString()) : null,
    }

    const response = await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'updateTask',
        taskId: task.id,
        payload,
      }),
    })
    const json = await response.json().catch(() => null)

    setSavingTask(false)

    if (response.ok) {
      await onTaskUpdated()
      toast({
        title: 'Изменения сохранены',
      })
      return
    }

    toast({
      title: 'Не удалось сохранить задачу',
      description: json?.error || 'Попробуй ещё раз',
      variant: 'destructive',
    })
  }

  const handleQuickResponse = async (responseType: TaskResponse) => {
    setResponding(responseType)

    const response = await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'respondTask',
        taskId: task.id,
        response: responseType,
        note: responseNote.trim() || null,
      }),
    })
    const json = await response.json().catch(() => null)

    setResponding(null)

    if (response.ok) {
      setResponseNote('')
      await onTaskUpdated()
      await loadComments()
      toast({
        title: 'Ответ сохранён',
        description: `${RESPONSE_CONFIG[responseType].label}. Задача перешла в "${STATUS_CONFIG[RESPONSE_CONFIG[responseType].status].title}".`,
      })
      return
    }

    toast({
      title: 'Не удалось сохранить ответ',
      description: json?.error || 'Попробуй ещё раз',
      variant: 'destructive',
    })
  }

  const handleDelete = async () => {
    if (!window.confirm(`Удалить задачу #${task.task_number} "${task.title}"? Это действие нельзя отменить.`)) return
    setDeleting(true)
    const response = await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'deleteTask', taskId: task.id }),
    })
    const json = await response.json().catch(() => null)
    setDeleting(false)
    if (response.ok) {
      await onTaskUpdated()
      onClose()
      toast({ title: 'Задача удалена' })
      return
    }
    toast({ title: 'Не удалось удалить задачу', description: json?.error || 'Попробуй ещё раз', variant: 'destructive' })
  }

  const priorityConfig = PRIORITY_CONFIG[task.priority]
  const statusConfig = STATUS_CONFIG[task.status]
  const StatusIcon = statusConfig.icon
  const isTaskOverdue = isOverdue(task.due_date, task.status)
  const daysUntilDue = getDaysUntilDue(task.due_date)
  const canEdit = can('tasks.edit')

  const baselineForm = useMemo(() => toTaskFormState(task), [task])
  const isDirty = useMemo(
    () => JSON.stringify(editForm) !== JSON.stringify(baselineForm),
    [editForm, baselineForm],
  )

  const fieldSelectClass =
    'h-9 w-full rounded-lg border border-border bg-white dark:bg-slate-800/50 px-2.5 text-sm text-foreground'
  const fieldLabelClass = 'mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground'

  const propertyFields = (
    <div className="space-y-3">
      <div>
        <label className={fieldLabelClass}>Статус</label>
        {canEdit ? (
          <select
            value={editForm.status}
            onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value as TaskStatus }))}
            className={fieldSelectClass}
          >
            {Object.entries(STATUS_CONFIG).map(([status, config]) => (
              <option key={status} value={status}>
                {config.title}
              </option>
            ))}
          </select>
        ) : (
          <span className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium', statusConfig.color)}>
            <StatusIcon className="h-3.5 w-3.5" />
            {statusConfig.title}
          </span>
        )}
      </div>

      <div>
        <label className={fieldLabelClass}>Приоритет</label>
        {canEdit ? (
          <select
            value={editForm.priority}
            onChange={(e) => setEditForm((prev) => ({ ...prev, priority: e.target.value as TaskPriority }))}
            className={fieldSelectClass}
          >
            {Object.entries(PRIORITY_CONFIG).map(([priority, config]) => (
              <option key={priority} value={priority}>
                {config.icon} {config.label}
              </option>
            ))}
          </select>
        ) : (
          <span className={cn('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium', priorityConfig.color)}>
            {priorityConfig.icon} {priorityConfig.label}
          </span>
        )}
      </div>

      <div>
        <label className={fieldLabelClass}>Исполнитель</label>
        {canEdit ? (
          <select
            value={editForm.assignee}
            onChange={(e) => setEditForm((prev) => ({ ...prev, assignee: e.target.value }))}
            className={fieldSelectClass}
          >
            <option value="">Без исполнителя</option>
            <optgroup label="Операторы">
              {operators.map((operator) => (
                <option key={operator.id} value={`op:${operator.id}`}>
                  {getOperatorDisplayName(operator)} {operator.telegram_chat_id ? '📱' : ''}
                </option>
              ))}
            </optgroup>
            {staff.length > 0 && (
              <optgroup label="Сотрудники">
                {staff.map((member) => (
                  <option key={member.id} value={`st:${member.id}`}>
                    {member.full_name || member.short_name} {member.telegram_chat_id ? '📱' : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <div className={cn(
              'flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white',
              task.assignee_kind === 'staff' ? 'from-sky-500 to-cyan-500' : 'from-purple-500 to-pink-500',
            )}>
              {task.assignee_short_name?.[0] || task.assignee_name?.[0] || '?'}
            </div>
            <span className="text-sm text-foreground">{task.assignee_name || 'Не назначен'}</span>
            {task.assignee_telegram && <Send className="h-3 w-3 text-blue-400" />}
          </div>
        )}
      </div>

      <div>
        <label className={fieldLabelClass}>Компания</label>
        {canEdit ? (
          <select
            value={editForm.company_id}
            onChange={(e) => setEditForm((prev) => ({ ...prev, company_id: e.target.value }))}
            className={fieldSelectClass}
          >
            <option value="">Без компании</option>
            {companies.map((company) => (
              <option key={company.id} value={company.id}>
                {company.name}
              </option>
            ))}
          </select>
        ) : task.company_name ? (
          <span className={cn('inline-flex rounded-full border px-2.5 py-1 text-xs', getCompanyStyle(task.company_code ?? null))}>
            {task.company_name}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </div>

      <div>
        <label className={fieldLabelClass}>Дедлайн</label>
        {canEdit ? (
          <DatePicker
            value={editForm.due_date}
            onChange={(v) => setEditForm((prev) => ({ ...prev, due_date: v }))}
          />
        ) : task.due_date ? (
          <div className={cn('flex items-center gap-1.5 text-sm', isTaskOverdue ? 'text-red-500 dark:text-red-400' : 'text-foreground')}>
            <Calendar className="h-4 w-4" />
            {formatDate(task.due_date)}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">Не указан</span>
        )}
        {isTaskOverdue && (
          <p className="mt-1 text-[11px] font-medium text-red-500 dark:text-red-400">Просрочено</p>
        )}
        {!isTaskOverdue && daysUntilDue !== null && daysUntilDue <= 3 && daysUntilDue >= 0 && (
          <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-300">Осталось {daysUntilDue} дн.</p>
        )}
      </div>

      <div>
        <label className={fieldLabelClass}>Теги</label>
        {canEdit ? (
          <Input
            value={editForm.tags}
            onChange={(e) => setEditForm((prev) => ({ ...prev, tags: e.target.value }))}
            className="h-9 bg-white dark:bg-slate-800/50 border-border text-sm"
            placeholder="Через запятую"
          />
        ) : task.tags && task.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {task.tags.map((tag: string) => (
              <span key={tag} className="rounded-full border border-slate-200 bg-card px-2 py-0.5 text-xs text-body dark:border-white/5">
                #{tag}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </div>

      <div>
        <label className={fieldLabelClass}>Постановщик</label>
        <span className="text-sm text-foreground">{task.creator_name || '—'}</span>
      </div>
    </div>
  )

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground flex max-h-[92dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(56rem,calc(100vw-2rem))]">
        <DialogTitle className="sr-only">Задача #{task.task_number}: {task.title}</DialogTitle>
        <DialogDescription className="sr-only">Детали и редактирование задачи</DialogDescription>

        {/* Шапка */}
        <div className="shrink-0 border-b border-border px-4 py-4 pr-12 md:px-6">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-muted-foreground">#{task.task_number}</span>
            <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', statusConfig.color)}>
              <StatusIcon className="h-3 w-3" />
              {statusConfig.title}
            </span>
            <span className={cn('rounded-full border px-2 py-0.5 text-[11px] font-medium', priorityConfig.color)}>
              {priorityConfig.icon} {priorityConfig.label}
            </span>
            {isTaskOverdue && (
              <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-[11px] font-medium text-red-500 dark:text-red-400">
                Просрочено
              </span>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              {task.assignee_telegram && can('tasks.notify') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onNotify}
                  className="h-7 gap-1.5 border-border px-2 text-xs"
                >
                  <Send className="h-3.5 w-3.5" />
                  Уведомить
                </Button>
              )}
              {can('tasks.delete') && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="h-7 gap-1.5 border-red-500/30 px-2 text-xs text-red-500 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {deleting ? 'Удаляем...' : 'Удалить'}
                </Button>
              )}
            </div>
          </div>
          {canEdit ? (
            <input
              value={editForm.title}
              onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
              className="mt-2 w-full rounded-md bg-transparent text-lg font-semibold text-foreground outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground hover:bg-surface-muted focus:bg-surface-muted px-1 -mx-1"
              placeholder="Название задачи"
            />
          ) : (
            <div className="mt-2 text-lg font-semibold text-foreground">{task.title}</div>
          )}
          <div className="mt-1 text-xs text-muted-foreground">
            Создано {formatDateTime(task.created_at)}
            {task.creator_name ? ` · ${task.creator_name}` : ''}
            {task.completed_at ? ` · выполнено ${formatDateTime(task.completed_at)}` : ''}
          </div>
        </div>

        {/* Тело: контент слева, свойства справа */}
        <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(0,1fr)_280px] md:overflow-hidden">
          <div className="min-h-0 space-y-5 px-4 py-4 md:overflow-y-auto md:px-6">
            {/* Параметры — мобильная версия */}
            <details className="rounded-xl border border-border bg-surface-muted px-4 py-3 md:hidden">
              <summary className="cursor-pointer select-none text-sm font-medium text-foreground">
                Параметры задачи
              </summary>
              <div className="mt-3">{propertyFields}</div>
            </details>

            {/* Описание */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">Описание</h3>
              {canEdit ? (
                <textarea
                  value={editForm.description}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                  className="min-h-24 w-full resize-none rounded-lg border border-border bg-white dark:bg-slate-800/50 p-3 text-sm text-foreground"
                  placeholder="Опиши, что нужно сделать и какой результат ждёшь..."
                />
              ) : task.description ? (
                <div className="rounded-lg border border-slate-200 bg-white p-3 dark:border-white/5 dark:bg-slate-800/50">
                  <p className="whitespace-pre-wrap text-sm">{task.description}</p>
                </div>
              ) : (
                <p className="text-sm italic text-muted-foreground">Без описания</p>
              )}
            </div>

            {/* Чек-лист */}
            <TaskChecklist task={task} canEdit={canEdit} onTaskUpdated={onTaskUpdated} />

            {can('tasks.respond') && (
            <div className="rounded-xl border border-border bg-surface-muted p-4">
              <div className="mb-1 flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-violet-500 dark:text-violet-300" />
                <h3 className="text-sm font-medium text-foreground">Быстрый ответ</h3>
              </div>
              <p className="mb-3 text-xs leading-5 text-muted-foreground">
                Один клик — комментарий в историю, уведомление и перенос задачи в нужную колонку.
              </p>

              <textarea
                value={responseNote}
                onChange={(e) => setResponseNote(e.target.value)}
                placeholder="Комментарий к ответу (необязательно)..."
                rows={2}
                className="mb-3 w-full resize-none rounded-lg border border-border bg-white dark:bg-slate-800/50 p-2.5 text-sm text-foreground"
              />

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {TASK_RESPONSE_ORDER.map((key) => {
                  const config = RESPONSE_CONFIG[key]
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => handleQuickResponse(key)}
                      disabled={responding !== null}
                      className={cn(
                        'rounded-xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                        config.tone,
                      )}
                    >
                      <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                        {config.label}
                        {responding === key && <RefreshCw className="h-3 w-3 animate-spin" />}
                      </div>
                      <div className="mt-0.5 text-[11px] opacity-80">{config.helper}</div>
                    </button>
                  )
                })}
              </div>
            </div>
            )}

            {/* Комментарии */}
            <div>
              <h3 className="mb-2 text-sm font-medium text-muted-foreground">
                Комментарии{comments.length > 0 ? ` · ${comments.length}` : ''}
              </h3>

              <div className="mb-4 flex gap-2">
                <textarea
                  value={newComment}
                  onChange={(e) => setNewComment(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault()
                      void handleAddComment()
                    }
                  }}
                  placeholder="Напишите комментарий... (Ctrl+Enter — отправить)"
                  className="flex-1 resize-none rounded-lg border border-border bg-white dark:bg-slate-800/50 p-2 text-sm text-foreground"
                  rows={2}
                />
                <Button
                  onClick={handleAddComment}
                  disabled={loading || !newComment.trim()}
                  className="self-end bg-violet-500 text-white hover:bg-violet-600"
                >
                  {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : 'Отправить'}
                </Button>
              </div>

              <div className="space-y-3">
                {comments.map(comment => (
                  <div key={comment.id} className="flex gap-3">
                    <div className={cn(
                      'flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br text-xs font-bold text-white',
                      comment.author_type === 'operator'
                        ? 'from-violet-500 to-fuchsia-500'
                        : comment.author_type === 'staff'
                          ? 'from-sky-500 to-cyan-500'
                          : 'from-slate-400 to-slate-500',
                    )}>
                      {comment.author_name?.[0] || '?'}
                    </div>
                    <div className="flex-1 rounded-lg border border-slate-200 bg-white p-3 dark:border-white/5 dark:bg-slate-800/50">
                      <div className="mb-1 flex justify-between gap-2">
                        <span className="text-sm font-medium">{comment.author_name}</span>
                        <span className="shrink-0 text-xs text-slate-500">
                          {formatDateTime(comment.created_at)}
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm">{comment.content}</p>
                    </div>
                  </div>
                ))}
                {comments.length === 0 && (
                  <p className="text-sm italic text-slate-500">Нет комментариев</p>
                )}
              </div>
            </div>
          </div>

          {/* Свойства — десктопный сайдбар */}
          <aside className="hidden min-h-0 border-l border-border bg-surface-muted px-4 py-4 md:block md:overflow-y-auto">
            <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Параметры
            </h3>
            {propertyFields}
          </aside>
        </div>

        {/* Панель несохранённых изменений */}
        {canEdit && isDirty && (
          <div className="shrink-0 border-t border-border bg-amber-500/5 px-4 py-3 md:px-6">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-amber-600 dark:text-amber-300">Есть несохранённые изменения</span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditForm(toTaskFormState(task))}
                  disabled={savingTask}
                >
                  Отменить
                </Button>
                <Button
                  size="sm"
                  onClick={handleTaskSave}
                  disabled={savingTask || !editForm.title.trim()}
                  className="bg-violet-500 text-white hover:bg-violet-600"
                >
                  {savingTask ? 'Сохраняем...' : 'Сохранить'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// =====================
// CREATE TASK MODAL
// =====================
function CreateTaskModal({
  isOpen,
  onClose,
  onSuccess,
  operators,
  staff,
  companies,
  nextTaskNumber,
}: CreateTaskModalProps) {
  const { toast } = useToast()
  const [form, setForm] = useState<TaskFormState>(createEmptyTaskForm())
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) return
    const base = createEmptyTaskForm()
    if (companies.length === 1) {
      base.company_id = companies[0].id
    }
    setForm(base)
    setSubmitError(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen])

  const buildTaskData = (taskNumber: number) => ({
    title: form.title.trim(),
    description: form.description.trim() || null,
    priority: form.priority,
    status: form.status,
    ...assigneeToPayload(form.assignee),
    company_id: form.company_id || null,
    due_date: form.due_date || null,
    tags: parseTags(form.tags),
    task_number: taskNumber,
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (companies.length > 0 && !form.company_id?.trim()) {
      setSubmitError('Выберите точку (компанию) для задачи')
      return
    }
    setLoading(true)
    setSubmitError(null)
    const response = await fetch('/api/admin/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'createTask',
        payload: buildTaskData(nextTaskNumber),
      }),
    })
    const json = await response.json().catch(() => null)

    setLoading(false)

    if (response.ok) {
      toast({
        title: 'Задача создана',
        description:
          json?.notification?.sent === false
            ? 'Новая задача добавлена в систему. Уведомление исполнителю не отправилось автоматически.'
            : form.assignee
              ? 'Новая задача добавлена в систему и отправлена исполнителю.'
              : 'Новая задача добавлена в систему.',
      })
      onSuccess()
      return
    }

    setSubmitError(json?.error || 'Не удалось создать задачу')
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card border-border text-foreground sm:max-w-md max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Создайте задачу для оператора или сотрудника
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {submitError && (
            <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
              {submitError}
            </div>
          )}

          <Input
            placeholder="Название задачи *"
            value={form.title}
            onChange={(e) => setForm({...form, title: e.target.value})}
            className="bg-white dark:bg-slate-800/50 border-border"
            required
          />

          <textarea
            placeholder="Описание"
            value={form.description}
            onChange={(e) => setForm({...form, description: e.target.value})}
            className="w-full h-24 bg-white dark:bg-slate-800/50 border border-border rounded-lg p-2 text-sm resize-none text-foreground"
          />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.assignee}
              onChange={(e) => setForm({...form, assignee: e.target.value})}
              className="h-9 bg-white dark:bg-slate-800/50 border border-border rounded-lg px-3 text-sm text-foreground"
            >
              <option value="">Исполнитель</option>
              <optgroup label="Операторы">
                {operators.map((op: Operator) => (
                  <option key={op.id} value={`op:${op.id}`}>
                    {getOperatorDisplayName(op)} {op.telegram_chat_id ? '📱' : ''}
                  </option>
                ))}
              </optgroup>
              {staff.length > 0 && (
                <optgroup label="Сотрудники">
                  {staff.map((member: Staff) => (
                    <option key={member.id} value={`st:${member.id}`}>
                      {member.full_name || member.short_name} {member.telegram_chat_id ? '📱' : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>

            <select
              value={form.company_id}
              onChange={(e) => setForm({...form, company_id: e.target.value})}
              className="h-9 bg-white dark:bg-slate-800/50 border border-border rounded-lg px-3 text-sm text-foreground"
            >
              <option value="">Выберите компанию</option>
              {companies.map((company: Company) => (
                <option key={company.id} value={company.id}>{company.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.priority}
              onChange={(e) => setForm({...form, priority: e.target.value as TaskPriority})}
              className="h-9 bg-white dark:bg-slate-800/50 border border-border rounded-lg px-3 text-sm text-foreground"
            >
              <option value="low">💧 Низкий</option>
              <option value="medium">📌 Средний</option>
              <option value="high">⚡ Высокий</option>
              <option value="critical">🔥 Критический</option>
            </select>

            <DatePicker
              value={form.due_date}
              onChange={(v) => setForm({...form, due_date: v})}
            />
          </div>

          {/* Быстрые сроки */}
          <div className="-mt-2 flex flex-wrap gap-1.5">
            {[
              { label: 'Сегодня', days: 0 },
              { label: 'Завтра', days: 1 },
              { label: '+3 дня', days: 3 },
              { label: 'Через неделю', days: 7 },
            ].map((preset) => {
              const d = new Date()
              d.setDate(d.getDate() + preset.days)
              const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
              const active = form.due_date === iso
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setForm({ ...form, due_date: active ? '' : iso })}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                    active
                      ? 'border-violet-400/60 bg-violet-500/15 text-violet-500 dark:text-violet-300'
                      : 'border-border text-muted-foreground hover:border-violet-400/40 hover:text-foreground',
                  )}
                >
                  {preset.label}
                </button>
              )
            })}
          </div>

          <Input
            placeholder="Теги (через запятую)"
            value={form.tags}
            onChange={(e) => setForm({...form, tags: e.target.value})}
            className="bg-white dark:bg-slate-800/50 border-border"
          />

          <DialogFooter className="pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={loading || !form.title}>
              {loading ? 'Создание...' : 'Создать задачу'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// =====================
// EXPORT
// =====================
export default function TasksPage() {
  return (
    <Suspense fallback={<TasksLoading />}>
      <TasksContent />
    </Suspense>
  )
}
