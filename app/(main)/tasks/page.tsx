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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { getOperatorDisplayName, getOperatorShortLabel } from '@/lib/core/operator-name'

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
}

type TaskFormState = {
  title: string
  description: string
  priority: TaskPriority
  status: TaskStatus
  operator_id: string
  company_id: string
  due_date: string
  tags: string
}

type Task = {
  id: string
  title: string
  description: string | null
  task_number: number
  status: TaskStatus
  priority: TaskPriority
  operator_id: string | null
  created_by: string | null
  company_id: string | null
  due_date: string | null
  tags: string[] | null
  created_at: string
  updated_at: string
  completed_at: string | null
  
  // Расширенные поля
  operator_name?: string
  operator_short_name?: string | null
  operator_telegram?: string | null
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

type TasksQueryTask = Omit<Task, 'operator_name' | 'operator_short_name' | 'operator_telegram' | 'company_name' | 'company_code' | 'comments_count'>

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
  companies: Company[]
  nextTaskNumber: number
}

// =====================
// CONSTANTS
// =====================
const STATUS_CONFIG: Record<TaskStatus, { title: string; color: string; icon: any }> = {
  backlog: { title: 'Бэклог', color: 'bg-gray-500/10 text-gray-400 border-gray-500/20', icon: Clock },
  todo: { title: 'К выполнению', color: 'bg-blue-500/10 text-blue-400 border-blue-500/20', icon: CheckCircle2 },
  in_progress: { title: 'В работе', color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20', icon: Briefcase },
  review: { title: 'На проверке', color: 'bg-purple-500/10 text-purple-400 border-purple-500/20', icon: Eye },
  done: { title: 'Готово', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: CheckCircle2 },
  archived: { title: 'Архив', color: 'bg-gray-500/10 text-gray-400 border-gray-500/20', icon: EyeOff }
}

const PRIORITY_CONFIG: Record<TaskPriority, { icon: string; color: string; label: string }> = {
  critical: { icon: '🔥', color: 'text-red-400 bg-red-500/10 border-red-500/20', label: 'Критический' },
  high: { icon: '⚡', color: 'text-orange-400 bg-orange-500/10 border-orange-500/20', label: 'Высокий' },
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
    tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    helper: 'Задача сразу перейдет в колонку "В работе".',
  },
  need_info: {
    label: 'Нужны уточнения',
    status: 'backlog',
    tone: 'border-sky-500/30 bg-sky-500/10 text-sky-200',
    helper: 'Задача вернется в ожидание уточнений.',
  },
  blocked: {
    label: 'Не могу выполнить',
    status: 'backlog',
    tone: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
    helper: 'Руководитель увидит, что задача заблокирована.',
  },
  already_done: {
    label: 'Уже сделано',
    status: 'review',
    tone: 'border-violet-500/30 bg-violet-500/10 text-violet-200',
    helper: 'Задача уйдет на проверку.',
  },
  complete: {
    label: 'Завершил задачу',
    status: 'done',
    tone: 'border-amber-500/30 bg-amber-500/10 text-amber-200',
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
  if (!code) return 'border-gray-500/30 bg-gray-500/5 text-gray-400'
  return COMPANY_COLORS[code.toLowerCase()] || 'border-gray-500/30 bg-gray-500/5 text-gray-400'
}

const createEmptyTaskForm = (): TaskFormState => ({
  title: '',
  description: '',
  priority: 'medium',
  status: 'todo',
  operator_id: '',
  company_id: '',
  due_date: '',
  tags: '',
})

const toTaskFormState = (task: Task): TaskFormState => ({
  title: task.title,
  description: task.description || '',
  priority: task.priority,
  status: task.status,
  operator_id: task.operator_id || '',
  company_id: task.company_id || '',
  due_date: task.due_date || '',
  tags: task.tags?.join(', ') || '',
})

const parseTags = (value: string) =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const enrichTasks = (taskRows: TasksQueryTask[], operators: Operator[], companies: Company[]): Task[] =>
  taskRows.map((task) => {
    const operator = operators.find((item) => item.id === task.operator_id)
    const company = companies.find((item) => item.id === task.company_id)

    return {
      ...task,
      operator_name: operator ? getOperatorDisplayName(operator, 'Оператор') : undefined,
      operator_short_name: operator ? getOperatorShortLabel(operator, 'Оператор') : undefined,
      operator_telegram: operator?.telegram_chat_id,
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
          <p className="text-gray-400">Загрузка задач...</p>
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

  // Состояния
  const [tasks, setTasks] = useState<Task[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban')
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
  const [filterOperator, setFilterOperator] = useState(searchParams.get('operator') || 'all')
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
      setTasks(enrichTasks(tasksData, operatorsData, companiesData))
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
    if (filterOperator !== 'all') params.set('operator', filterOperator)
    if (filterCompany !== 'all') params.set('company', filterCompany)
    
    router.replace(`/tasks?${params.toString()}`, { scroll: false })
  }, [searchTerm, filterStatus, filterPriority, filterOperator, filterCompany, router])

  // Фильтрация задач
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      // Поиск
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const matches = 
          task.title.toLowerCase().includes(term) ||
          task.task_number.toString().includes(term) ||
          task.operator_name?.toLowerCase().includes(term) ||
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

      // Фильтр по оператору
      if (filterOperator !== 'all' && task.operator_id !== filterOperator) return false

      // Фильтр по компании
      if (filterCompany !== 'all' && task.company_id !== filterCompany) return false

      return true
    })
  }, [tasks, searchTerm, filterStatus, filterPriority, filterOperator, filterCompany])

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
    setFilterOperator('all')
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
    if (!task.operator_telegram) {
      toast({
        title: 'Telegram не настроен',
        description: 'У оператора нет telegram_chat_id.',
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
        description: `${task.operator_name || task.operator_short_name || 'Оператор'} получил сообщение в Telegram.`,
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

  if (loading && !refreshing) {
    return <TasksLoading />
  }

  if (error) {
    return (
    <>
          <div className="app-page max-w-7xl">
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
        <div className="app-page max-w-7xl space-y-6">
          {/* Header */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border border-white/10 p-6 lg:p-8">
            <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-fuchsia-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl shadow-lg shadow-violet-500/25">
                  <Kanban className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Задачи операторов
                  </h1>
                  <p className="text-gray-400 mt-1 flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    Уведомления в Telegram
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className={`rounded-xl border-white/10 bg-gray-900/50 backdrop-blur-xl hover:bg-white/10 ${refreshing ? 'animate-spin' : ''}`}
                  onClick={() => loadData(true)}
                  title="Обновить"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>

                <div className="flex bg-gray-900/50 backdrop-blur-xl rounded-xl p-1 border border-white/10">
                  <button
                    onClick={() => setViewMode('kanban')}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'kanban' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
                    )}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white'
                    )}
                  >
                    <LayoutList className="w-4 h-4" />
                  </button>
                </div>

                <Button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Новая задача
                </Button>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <p className="text-xs text-gray-500">Всего задач</p>
              <p className="text-2xl font-bold text-white">{stats.total}</p>
            </Card>
            <Card className="p-4 bg-red-500/5 border-red-500/20">
              <p className="text-xs text-red-400">Просрочено</p>
              <p className="text-2xl font-bold text-red-400">{stats.overdue}</p>
            </Card>
            <Card className="p-4 bg-rose-500/5 border-rose-500/20">
              <p className="text-xs text-rose-400">Критических</p>
              <p className="text-2xl font-bold text-rose-400">{stats.critical}</p>
            </Card>
          </div>

          {/* Filters */}
          <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <div className="flex flex-wrap items-center gap-3">
              <Filter className="w-4 h-4 text-gray-500" />

              {/* Поиск */}
              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Поиск задач..."
                  className="w-full pl-9 pr-8 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500/50"
                />
                {searchTerm && (
                  <button
                    onClick={() => setSearchTerm('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Фильтр по статусу */}
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">Все статусы</option>
                {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                  <option key={key} value={key}>{config.title}</option>
                ))}
              </select>

              {/* Фильтр по приоритету */}
              <select
                value={filterPriority}
                onChange={(e) => setFilterPriority(e.target.value)}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">Все приоритеты</option>
                {Object.entries(PRIORITY_CONFIG).map(([key, config]) => (
                  <option key={key} value={key}>{config.icon} {config.label}</option>
                ))}
              </select>

              {/* Фильтр по оператору */}
              <select
                value={filterOperator}
                onChange={(e) => setFilterOperator(e.target.value)}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">Все операторы</option>
                {operators.map(op => (
                  <option key={op.id} value={op.id}>
                    {getOperatorDisplayName(op)} {op.telegram_chat_id ? '📱' : ''}
                  </option>
                ))}
              </select>

              {/* Фильтр по компании */}
              <select
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">Все компании</option>
                {companies.map(company => (
                  <option key={company.id} value={company.id}>{company.name}</option>
                ))}
              </select>

              {/* Фильтр "Просроченные" */}
              <button
                onClick={() => setFilterStatus(filterStatus === 'overdue' ? 'all' : 'overdue')}
                className={cn(
                  "px-3 py-2 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5",
                  filterStatus === 'overdue'
                    ? 'bg-red-500/20 border-red-500/40 text-red-300'
                    : 'bg-gray-800/50 border-white/10 text-gray-400 hover:text-red-300 hover:border-red-500/30'
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
                filterOperator !== 'all' || filterCompany !== 'all') && (
                <button
                  onClick={resetFilters}
                  className="text-sm text-gray-500 hover:text-white transition-colors ml-auto"
                >
                  Сбросить
                </button>
              )}
            </div>
          </Card>

          {/* Overdue Banner */}
          {(() => {
            const overdueTasks = filteredTasks.filter(t => isOverdue(t.due_date, t.status))
            if (overdueTasks.length === 0) return null
            return (
              <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertCircle className="w-5 h-5 text-red-400" />
                  <h3 className="text-sm font-semibold text-red-400">
                    Просроченные задачи: {overdueTasks.length}
                  </h3>
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
                          <span className="text-sm text-white truncate">{task.title}</span>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-xs text-gray-400">{formatDate(task.due_date)}</span>
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
                    <p className="text-xs text-gray-500 pl-1">
                      … и ещё {overdueTasks.length - 5} просроченных задач
                    </p>
                  )}
                </div>
              </div>
            )
          })()}

          {/* Content */}
          {viewMode === 'kanban' ? (
            // Kanban View
            <div className="flex gap-4 overflow-x-auto pb-4 min-h-[600px]">
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
                      "w-80 flex-shrink-0 rounded-xl border backdrop-blur-xl p-3 transition-colors",
                      dragOverStatus === status
                        ? 'border-violet-400/50 bg-violet-500/10'
                        : 'border-white/5 bg-gray-900/40',
                    )}
                  >
                    {/* Заголовок колонки */}
                    <div className="flex items-center justify-between mb-3 px-2">
                      <div className="flex items-center gap-2">
                        <Icon className={cn("w-4 h-4", config.color.split(' ')[0])} />
                        <h3 className="font-medium text-sm">{config.title}</h3>
                      </div>
                      <span className="text-xs bg-white/5 px-2 py-1 rounded-full">
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
                            "text-center py-8 text-xs text-gray-500 border border-dashed rounded-lg transition-colors",
                            dragOverStatus === status ? 'border-violet-400/50 bg-violet-500/5' : 'border-white/5',
                          )}
                        >
                          Нет задач
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            // List View
            <Card className="bg-gray-900/40 backdrop-blur-xl border-white/5 overflow-hidden">
              {/* Bulk action bar */}
              {selectedTaskIds.size > 0 && (
                <div className="flex items-center gap-3 px-4 py-3 bg-violet-500/10 border-b border-violet-500/20">
                  <span className="text-sm text-violet-300 font-medium">
                    {selectedTaskIds.size} задач выбрано
                  </span>
                  <div className="flex items-center gap-2 ml-auto">
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10 hover:text-yellow-200 text-xs"
                      onClick={() => bulkUpdateStatus('in_progress')}
                    >
                      В работу
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-purple-500/30 text-purple-300 hover:bg-purple-500/10 hover:text-purple-200 text-xs"
                      onClick={() => bulkUpdateStatus('review')}
                    >
                      На проверку
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/10 hover:text-emerald-200 text-xs"
                      onClick={() => bulkUpdateStatus('done')}
                    >
                      Готово
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-white/10 text-gray-400 hover:bg-white/5 text-xs"
                      onClick={() => setSelectedTaskIds(new Set())}
                    >
                      Снять выбор
                    </Button>
                  </div>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-gray-900/50">
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400 w-10">
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
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">#</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Задача</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Статус</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Приоритет</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Оператор</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Дедлайн</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Компания</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredTasks.map(task => (
                      <tr
                        key={task.id}
                        onClick={() => {
                          setSelectedTask(task)
                          setIsTaskModalOpen(true)
                        }}
                        className={cn(
                          "hover:bg-white/5 transition-colors cursor-pointer",
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
                            className="border-white/20"
                          />
                        </td>
                        <td className="py-3 px-4 text-sm text-gray-400">#{task.task_number}</td>
                        <td className="py-3 px-4">
                          <span className="text-sm text-white line-clamp-1">{task.title}</span>
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
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[10px] font-bold">
                              {task.operator_name?.[0] || task.operator_short_name?.[0] || '?'}
                            </div>
                            <span className="text-sm text-gray-300">
                              {task.operator_name || task.operator_short_name || '—'}
                            </span>
                            {task.operator_telegram && (
                              <Send className="w-3 h-3 text-blue-400" />
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {task.due_date ? (
                            <span className={cn(
                              "text-sm",
                              isOverdue(task.due_date, task.status) ? "text-red-400" : "text-gray-300"
                            )}>
                              {formatDate(task.due_date)}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
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
                            <span className="text-gray-500">—</span>
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
          <div className="flex justify-between items-center text-xs text-gray-500">
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
        "bg-gray-800/50 border border-white/5 rounded-lg p-3 hover:bg-gray-700/50 transition-colors cursor-pointer relative group",
        isDragging && 'opacity-50 ring-1 ring-violet-400/40',
      )}
    >
      {/* Кнопки действий */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        {task.operator_telegram && (
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
          className="p-1 hover:bg-white/10 rounded"
        >
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
        
        {showMenu && (
          <div className="absolute right-0 mt-6 w-40 bg-gray-800 border border-white/10 rounded-lg shadow-xl z-10">
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
                  className="w-full px-3 py-2 text-left text-xs hover:bg-white/5 flex items-center gap-2"
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
        <span className="text-[10px] text-gray-500">#{task.task_number}</span>
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

      {/* Оператор и компания */}
      <div className="flex items-center justify-between text-xs mb-2">
        <div className="flex items-center gap-1 text-gray-400">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[8px] font-bold">
            {task.operator_short_name?.[0] || task.operator_name?.[0] || '?'}
          </div>
                            <span className="text-[10px]">{task.operator_name || task.operator_short_name || 'Не назначен'}</span>
          {task.operator_telegram && (
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

      {/* Дедлайн */}
      {task.due_date && (
        <div className={cn(
          "flex items-center gap-1 text-[10px]",
          isTaskOverdue ? "text-red-400" : "text-gray-500"
        )}>
          <Calendar className="w-3 h-3" />
          <span>{formatDate(task.due_date)}</span>
          {isTaskOverdue && <span className="text-red-400">(просрочено)</span>}
          {!isTaskOverdue && daysUntilDue !== null && daysUntilDue <= 3 && daysUntilDue >= 0 && (
            <span className="text-yellow-400">(осталось {daysUntilDue} дн.)</span>
          )}
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
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [responseNote, setResponseNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingTask, setSavingTask] = useState(false)
  const [responding, setResponding] = useState<TaskResponse | null>(null)
  const [editForm, setEditForm] = useState<TaskFormState>(() => toTaskFormState(task))

  const loadComments = useCallback(async () => {
    if (!task?.id) return

    const { data } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', task.id)
      .order('created_at', { ascending: true })

    if (data) {
      setComments(data.map((c: any) => ({
        ...c,
        author_name:
          (c.operator_id
            ? getOperatorDisplayName(operators.find((o: Operator) => o.id === c.operator_id), 'Оператор')
            : null) ||
          (c.staff_id ? staff.find((item) => item.id === c.staff_id)?.full_name : null) ||
          'Система',
        author_type: c.operator_id ? 'operator' : c.staff_id ? 'staff' : undefined,
      })))
    }
  }, [operators, staff, task])

  useEffect(() => {
    if (isOpen && task) {
      setEditForm(toTaskFormState(task))
      setResponseNote('')
      loadComments()
    }
  }, [isOpen, task, loadComments])

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
      operator_id: editForm.operator_id || null,
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
      onClose()
      toast({
        title: 'Задача обновлена',
        description: 'Изменения сохранены.',
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

  const priorityConfig = PRIORITY_CONFIG[task.priority]
  const statusConfig = STATUS_CONFIG[task.status]
  const StatusIcon = statusConfig.icon
  const isTaskOverdue = isOverdue(task.due_date, task.status)
  const daysUntilDue = getDaysUntilDue(task.due_date)

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-white/10 text-white max-w-2xl max-h-[90vh] overflow-auto">
        <DialogHeader>
          <div className="flex items-start justify-between">
            <div>
              <DialogTitle className="text-xl flex items-center gap-2">
                <span className="text-gray-500">#{task.task_number}</span>
                <span>{task.title}</span>
              </DialogTitle>
              <DialogDescription className="text-gray-400 mt-1">
                Создано {formatDateTime(task.created_at)}
              </DialogDescription>
            </div>
            {task.operator_telegram && (
              <Button
                size="sm"
                variant="outline"
                onClick={onNotify}
                className="gap-2 border-white/10"
              >
                <Send className="w-4 h-4" />
                Уведомить
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-3 text-sm font-medium text-white">Редактирование задачи</div>

            <div className="space-y-3">
              <Input
                value={editForm.title}
                onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                className="bg-gray-800/50 border-white/10"
                placeholder="Название задачи"
              />

              <textarea
                value={editForm.description}
                onChange={(e) => setEditForm((prev) => ({ ...prev, description: e.target.value }))}
                className="min-h-24 w-full resize-none rounded-lg border border-white/10 bg-gray-800/50 p-3 text-sm text-white"
                placeholder="Описание задачи"
              />

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <select
                  value={editForm.operator_id}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, operator_id: e.target.value }))}
                  className="h-10 rounded-lg border border-white/10 bg-gray-800/50 px-3 text-sm text-white"
                >
                  <option value="">Без оператора</option>
                  {operators.map((operator) => (
                    <option key={operator.id} value={operator.id}>
                      {getOperatorDisplayName(operator)}
                    </option>
                  ))}
                </select>

                <select
                  value={editForm.company_id}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, company_id: e.target.value }))}
                  className="h-10 rounded-lg border border-white/10 bg-gray-800/50 px-3 text-sm text-white"
                >
                  <option value="">Без компании</option>
                  {companies.map((company) => (
                    <option key={company.id} value={company.id}>
                      {company.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, status: e.target.value as TaskStatus }))}
                  className="h-10 rounded-lg border border-white/10 bg-gray-800/50 px-3 text-sm text-white"
                >
                  {Object.entries(STATUS_CONFIG).map(([status, config]) => (
                    <option key={status} value={status}>
                      {config.title}
                    </option>
                  ))}
                </select>

                <select
                  value={editForm.priority}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, priority: e.target.value as TaskPriority }))}
                  className="h-10 rounded-lg border border-white/10 bg-gray-800/50 px-3 text-sm text-white"
                >
                  {Object.entries(PRIORITY_CONFIG).map(([priority, config]) => (
                    <option key={priority} value={priority}>
                      {config.icon} {config.label}
                    </option>
                  ))}
                </select>

                <Input
                  type="date"
                  value={editForm.due_date}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, due_date: e.target.value }))}
                  className="bg-gray-800/50 border-white/10"
                />
              </div>

              <Input
                value={editForm.tags}
                onChange={(e) => setEditForm((prev) => ({ ...prev, tags: e.target.value }))}
                className="bg-gray-800/50 border-white/10"
                placeholder="Теги через запятую"
              />

              <div className="flex justify-end">
                <Button
                  onClick={handleTaskSave}
                  disabled={savingTask || !editForm.title.trim()}
                  className="gap-2"
                >
                  {savingTask ? 'Сохраняем...' : 'Сохранить изменения'}
                </Button>
              </div>
            </div>
          </div>

          {/* Мета-информация */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Статус</p>
              <div className="flex items-center gap-2">
                <StatusIcon className={cn("w-4 h-4", statusConfig.color.split(' ')[0])} />
                <span className="text-sm">{statusConfig.title}</span>
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Приоритет</p>
              <div className="flex items-center gap-2">
                <span className={cn("text-sm px-2 py-0.5 rounded-full", priorityConfig.color)}>
                  {priorityConfig.icon} {priorityConfig.label}
                </span>
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Оператор</p>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold">
                  {task.operator_short_name?.[0] || task.operator_name?.[0] || '?'}
                </div>
                <span className="text-sm">{task.operator_name || 'Не назначен'}</span>
                {task.operator_telegram && (
                  <Send className="w-3 h-3 text-blue-400" />
                )}
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Дедлайн</p>
              {task.due_date ? (
                <div className={cn(
                  "flex items-center gap-2 text-sm",
                  isTaskOverdue ? "text-red-400" : "text-gray-300"
                )}>
                  <Calendar className="w-4 h-4" />
                  <span>{formatDate(task.due_date)}</span>
                  {isTaskOverdue && <span className="text-xs text-red-400">(просрочено)</span>}
                  {!isTaskOverdue && daysUntilDue !== null && daysUntilDue <= 3 && daysUntilDue >= 0 && (
                    <span className="text-xs text-yellow-400">(осталось {daysUntilDue} дн.)</span>
                  )}
                </div>
              ) : (
                <span className="text-sm text-gray-500">Не указан</span>
              )}
            </div>
          </div>

          {/* Компания */}
          {task.company_name && (
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Компания</p>
              <span className={cn(
                "text-xs px-2 py-1 rounded-full border",
                getCompanyStyle(task.company_code ?? null)
              )}>
                {task.company_name}
              </span>
            </div>
          )}

          {/* Описание */}
          {task.description && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">Описание</h3>
              <div className="bg-gray-800/50 border border-white/5 rounded-lg p-3">
                <p className="text-sm whitespace-pre-wrap">{task.description}</p>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
            <div className="mb-2 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-violet-300" />
              <h3 className="text-sm font-medium text-white">Быстрый ответ по задаче</h3>
            </div>
            <p className="mb-3 text-xs leading-5 text-gray-400">
              Используй быстрый ответ, если задачу приняли в работу, нужна помощь или нужно сразу отправить её на проверку.
            </p>

            <textarea
              value={responseNote}
              onChange={(e) => setResponseNote(e.target.value)}
              placeholder="Короткий комментарий для истории задачи и уведомления..."
              className="mb-3 min-h-20 w-full resize-none rounded-lg border border-white/10 bg-gray-800/50 p-3 text-sm text-white"
            />

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {TASK_RESPONSE_ORDER.map((key) => {
                const config = RESPONSE_CONFIG[key]
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleQuickResponse(key)}
                    disabled={responding !== null}
                    className={cn(
                      'rounded-xl border px-3 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                      config.tone,
                    )}
                  >
                    <div className="text-sm font-medium">{config.label}</div>
                    <div className="mt-1 text-xs opacity-80">{config.helper}</div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Теги */}
          {task.tags && task.tags.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">Теги</h3>
              <div className="flex flex-wrap gap-2">
                {task.tags.map((tag: string) => (
                  <span
                    key={tag}
                    className="text-xs px-2 py-1 rounded-full bg-gray-800 text-gray-300 border border-white/5"
                  >
                    #{tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Комментарии */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">Комментарии</h3>
            
            {/* Форма комментария */}
            <div className="flex gap-2 mb-4">
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Напишите комментарий..."
                className="flex-1 bg-gray-800/50 border border-white/10 rounded-lg p-2 text-sm resize-none text-white"
                rows={2}
              />
              <Button
                onClick={handleAddComment}
                disabled={loading || !newComment.trim()}
                className="self-end bg-violet-500 hover:bg-violet-600"
              >
                Отправить
              </Button>
            </div>

            {/* Список комментариев */}
            <div className="space-y-3 max-h-60 overflow-auto">
              {comments.map(comment => (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {comment.author_name?.[0] || '?'}
                  </div>
                  <div className="flex-1 bg-gray-800/50 border border-white/5 rounded-lg p-3">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-sm">{comment.author_name}</span>
                      <span className="text-xs text-gray-500">
                        {formatDateTime(comment.created_at)}
                      </span>
                    </div>
                    <p className="text-sm">{comment.content}</p>
                  </div>
                </div>
              ))}
              {comments.length === 0 && (
                <p className="text-sm text-gray-500 italic">Нет комментариев</p>
              )}
            </div>
          </div>
        </div>
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
  companies,
  nextTaskNumber,
}: CreateTaskModalProps) {
  const { toast } = useToast()
  const [form, setForm] = useState<TaskFormState>(createEmptyTaskForm())
  const [loading, setLoading] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      setForm(createEmptyTaskForm())
      setSubmitError(null)
    }
  }, [isOpen])

  const buildTaskData = (taskNumber: number) => {
    const payload: {
      title: string
      description: string | null
      priority: TaskPriority
      status: TaskStatus
      operator_id: string | null
      company_id: string | null
      due_date: string | null
      tags: string[]
      task_number: number
    } = {
      title: form.title.trim(),
      description: form.description.trim() || null,
      priority: form.priority,
      status: form.status,
      operator_id: form.operator_id || null,
      company_id: form.company_id || null,
      due_date: form.due_date || null,
      tags: parseTags(form.tags),
      task_number: taskNumber,
    }

    return payload
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
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
            ? 'Новая задача добавлена в систему. Уведомление сотруднику не отправилось автоматически.'
            : form.operator_id
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
      <DialogContent className="bg-gray-900 border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
          <DialogDescription className="text-gray-400">
            Создайте задачу для оператора
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
            className="bg-gray-800/50 border-white/10"
            required
          />

          <textarea
            placeholder="Описание"
            value={form.description}
            onChange={(e) => setForm({...form, description: e.target.value})}
            className="w-full h-24 bg-gray-800/50 border border-white/10 rounded-lg p-2 text-sm resize-none text-white"
          />

          <div className="grid grid-cols-2 gap-3">
            <select
              value={form.operator_id}
              onChange={(e) => setForm({...form, operator_id: e.target.value})}
              className="h-9 bg-gray-800/50 border border-white/10 rounded-lg px-3 text-sm text-white"
            >
              <option value="">Выберите оператора</option>
              {operators.map((op: Operator) => (
                <option key={op.id} value={op.id}>
                  {getOperatorDisplayName(op)} {op.telegram_chat_id ? '📱' : ''}
                </option>
              ))}
            </select>

            <select
              value={form.company_id}
              onChange={(e) => setForm({...form, company_id: e.target.value})}
              className="h-9 bg-gray-800/50 border border-white/10 rounded-lg px-3 text-sm text-white"
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
              className="h-9 bg-gray-800/50 border border-white/10 rounded-lg px-3 text-sm text-white"
            >
              <option value="low">💧 Низкий</option>
              <option value="medium">📌 Средний</option>
              <option value="high">⚡ Высокий</option>
              <option value="critical">🔥 Критический</option>
            </select>

            <Input
              type="date"
              value={form.due_date}
              onChange={(e) => setForm({...form, due_date: e.target.value})}
              className="bg-gray-800/50 border-white/10"
            />
          </div>

          <Input
            placeholder="Теги (через запятую)"
            value={form.tags}
            onChange={(e) => setForm({...form, tags: e.target.value})}
            className="bg-gray-800/50 border-white/10"
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
