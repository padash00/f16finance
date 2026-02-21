'use client'

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { supabase } from '@/lib/supabaseClient'
import {
  Plus,
  Search,
  Filter,
  X,
  Calendar,
  Clock,
  User,
  MessageSquare,
  Paperclip,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  MoreHorizontal,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Trash2,
  Edit2,
  Copy,
  RefreshCw,
  Download,
  Settings,
  Menu,
  Grid,
  List,
  Kanban,
  LayoutGrid,
  LayoutList,
  Send,
  Phone,
  Mail,
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =====================
// TYPES (исправлено - используем operators)
// =====================
type Operator = {
  id: string
  name: string
  short_name: string | null
  telegram_id: string | null
  company_id: string | null
  is_active: boolean
}

type Task = {
  id: string
  task_number: number
  title: string
  description: string | null
  status: 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'
  priority: 'critical' | 'high' | 'medium' | 'low'
  project_id: string | null
  company_id: string | null
  operator_id: string | null  // ✅ вместо assigned_to
  created_by: string | null
  parent_task_id: string | null
  start_date: string | null
  due_date: string | null
  estimated_hours: number | null
  actual_hours: number | null
  tags: string[] | null
  is_urgent: boolean
  is_important: boolean
  created_at: string
  updated_at: string
  completed_at: string | null
  
  // Расширенные поля (джойны)
  operator_name?: string
  operator_short_name?: string | null
  operator_telegram_id?: string | null
  created_by_name?: string
  company_name?: string
  company_code?: string | null
  project_name?: string
  project_color?: string
  comments_count?: number
  checklist?: TaskChecklist[]
}

type TaskChecklist = {
  id: string
  task_id: string
  title: string
  is_completed: boolean
  completed_by: string | null
  completed_at: string | null
  position: number
}

type TaskComment = {
  id: string
  task_id: string
  operator_id: string | null  // ✅ комментарии от операторов
  staff_id: string | null      // или от staff
  content: string
  parent_comment_id: string | null
  attachments: any | null
  created_at: string
  author_name?: string
  author_type?: 'operator' | 'staff'
}

type Company = {
  id: string
  name: string
  code: string | null
}

type Project = {
  id: string
  name: string
  description: string | null
  company_id: string | null
  color: string
  icon: string
  is_active: boolean
}

type Staff = {
  id: string
  full_name: string
  short_name: string | null
}

// =====================
// CONSTANTS
// =====================
const STATUS_CONFIG: Record<string, { title: string; color: string; icon: any }> = {
  backlog: { 
    title: 'Бэклог', 
    color: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    icon: Menu 
  },
  todo: { 
    title: 'К выполнению', 
    color: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
    icon: List 
  },
  in_progress: { 
    title: 'В работе', 
    color: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
    icon: Grid 
  },
  review: { 
    title: 'На проверке', 
    color: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
    icon: Eye 
  },
  done: { 
    title: 'Готово', 
    color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
    icon: CheckCircle2 
  },
  archived: { 
    title: 'Архив', 
    color: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
    icon: EyeOff 
  }
}

const PRIORITY_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  critical: { icon: '🔥', color: 'text-red-400 bg-red-500/10', label: 'Критический' },
  high: { icon: '⚡', color: 'text-orange-400 bg-orange-500/10', label: 'Высокий' },
  medium: { icon: '📌', color: 'text-blue-400 bg-blue-500/10', label: 'Средний' },
  low: { icon: '💧', color: 'text-green-400 bg-green-500/10', label: 'Низкий' }
}

const COMPANY_COLORS: Record<string, string> = {
  arena: 'border-emerald-500/30 bg-emerald-500/5',
  ramen: 'border-amber-500/30 bg-amber-500/5',
  extra: 'border-violet-500/30 bg-violet-500/5'
}

// =====================
// UTILS
// =====================
const formatDate = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('ru-RU')
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
  if (!code) return 'border-gray-500/30 bg-gray-500/5'
  return COMPANY_COLORS[code.toLowerCase()] || 'border-gray-500/30 bg-gray-500/5'
}

const sendTelegramNotification = async (telegramId: string, message: string) => {
  // Здесь должен быть ваш Telegram Bot API
  console.log(`Sending to ${telegramId}: ${message}`)
  // Реальная отправка через бота
  // const response = await fetch(`/api/telegram/send`, {
  //   method: 'POST',
  //   body: JSON.stringify({ chat_id: telegramId, text: message })
  // })
}

// =====================
// LOADING COMPONENT
// =====================
function TasksLoading() {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center animate-pulse">
            <Kanban className="w-8 h-8 text-white" />
          </div>
          <p className="text-gray-400">Загрузка задач...</p>
        </div>
      </main>
    </div>
  )
}

// =====================
// MAIN CONTENT COMPONENT
// =====================
function TasksContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Состояния
  const [tasks, setTasks] = useState<Task[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [projects, setProjects] = useState<Project[]>([])
  const [staff, setStaff] = useState<Staff[]>([]) // для created_by
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // Фильтры из URL
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '')
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || 'all')
  const [filterPriority, setFilterPriority] = useState(searchParams.get('priority') || 'all')
  const [filterCompany, setFilterCompany] = useState(searchParams.get('company') || 'all')
  const [filterOperator, setFilterOperator] = useState(searchParams.get('operator') || 'all')
  const [showArchived, setShowArchived] = useState(searchParams.get('archived') === '1')

  // Загрузка данных
  const loadData = useCallback(async (showRefresh = false) => {
    if (showRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      // Загружаем задачи с информацией об операторах
      let tasksQuery = supabase
        .from('tasks')
        .select(`
          *,
          operator:operators!operator_id(name, short_name, telegram_id),
          creator:staff!created_by(full_name),
          company:companies(name, code),
          project:projects(name, color, icon),
          comments:task_comments(count),
          checklist:task_checklist(*)
        `)
        .order('task_number', { ascending: false })

      if (!showArchived) {
        tasksQuery = tasksQuery.neq('status', 'archived')
      }

      const { data: tasksData, error: tasksError } = await tasksQuery

      if (tasksError) throw tasksError

      // Загружаем операторов
      const { data: operatorsData, error: operatorsError } = await supabase
        .from('operators')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (operatorsError) throw operatorsError

      // Загружаем компании
      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select('*')
        .order('name')

      if (companiesError) throw companiesError

      // Загружаем проекты
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .eq('is_active', true)
        .order('name')

      if (projectsError) throw projectsError

      // Загружаем staff (для created_by)
      const { data: staffData, error: staffError } = await supabase
        .from('staff')
        .select('*')
        .eq('is_active', true)

      if (staffError) throw staffError

      // Форматируем задачи
      const formattedTasks = tasksData?.map(task => ({
        ...task,
        operator_name: task.operator?.name,
        operator_short_name: task.operator?.short_name,
        operator_telegram_id: task.operator?.telegram_id,
        created_by_name: task.creator?.full_name,
        company_name: task.company?.name,
        company_code: task.company?.code,
        project_name: task.project?.name,
        project_color: task.project?.color,
        comments_count: task.comments?.[0]?.count || 0,
        checklist: task.checklist || []
      })) || []

      setTasks(formattedTasks)
      setOperators(operatorsData || [])
      setCompanies(companiesData || [])
      setProjects(projectsData || [])
      setStaff(staffData || [])
    } catch (err) {
      console.error('Error loading data:', err)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [showArchived])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Синхронизация фильтров с URL
  useEffect(() => {
    const params = new URLSearchParams()
    if (searchTerm) params.set('q', searchTerm)
    if (filterStatus !== 'all') params.set('status', filterStatus)
    if (filterPriority !== 'all') params.set('priority', filterPriority)
    if (filterCompany !== 'all') params.set('company', filterCompany)
    if (filterOperator !== 'all') params.set('operator', filterOperator)
    if (showArchived) params.set('archived', '1')
    
    router.replace(`/tasks?${params.toString()}`, { scroll: false })
  }, [searchTerm, filterStatus, filterPriority, filterCompany, filterOperator, showArchived, router])

  // Фильтрация задач
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      // Поиск по тексту
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const matches = 
          task.title.toLowerCase().includes(term) ||
          task.task_number.toString().includes(term) ||
          task.description?.toLowerCase().includes(term) ||
          task.operator_name?.toLowerCase().includes(term)
        if (!matches) return false
      }

      // Фильтр по статусу
      if (filterStatus !== 'all' && task.status !== filterStatus) return false

      // Фильтр по приоритету
      if (filterPriority !== 'all' && task.priority !== filterPriority) return false

      // Фильтр по компании
      if (filterCompany !== 'all' && task.company_id !== filterCompany) return false

      // Фильтр по оператору
      if (filterOperator !== 'all' && task.operator_id !== filterOperator) return false

      return true
    })
  }, [tasks, searchTerm, filterStatus, filterPriority, filterCompany, filterOperator])

  // Группировка по статусам для канбана
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
    const upcoming = filteredTasks.filter(t => {
      const days = getDaysUntilDue(t.due_date)
      return days !== null && days >= 0 && days <= 3 && t.status !== 'done'
    }).length
    const critical = filteredTasks.filter(t => t.priority === 'critical' && t.status !== 'done').length
    
    return { total, overdue, upcoming, critical }
  }, [filteredTasks])

  // Обработчики
  const resetFilters = () => {
    setSearchTerm('')
    setFilterStatus('all')
    setFilterPriority('all')
    setFilterCompany('all')
    setFilterOperator('all')
    setShowArchived(false)
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
    setIsTaskModalOpen(true)
  }

  const handleCreateTask = () => {
    setIsCreateModalOpen(true)
  }

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    const { error } = await supabase
      .from('tasks')
      .update({ 
        status: newStatus,
        completed_at: newStatus === 'done' ? new Date().toISOString() : null
      })
      .eq('id', taskId)

    if (!error) {
      setTasks(prev => prev.map(t => 
        t.id === taskId 
          ? { 
              ...t, 
              status: newStatus as any,
              completed_at: newStatus === 'done' ? new Date().toISOString() : null
            } 
          : t
      ))

      // Отправляем уведомление оператору в Telegram
      const task = tasks.find(t => t.id === taskId)
      if (task?.operator_telegram_id) {
        await sendTelegramNotification(
          task.operator_telegram_id,
          `📋 Статус задачи #${task.task_number} изменён на "${STATUS_CONFIG[newStatus].title}"`
        )
      }
    }
  }

  const handleNotifyOperator = async (task: Task) => {
    if (!task.operator_telegram_id) {
      alert('У оператора нет Telegram ID')
      return
    }

    const message = `📋 Задача #${task.task_number}\n` +
      `${task.title}\n\n` +
      `📅 Дедлайн: ${task.due_date ? formatDate(task.due_date) : 'не указан'}\n` +
      `🔥 Приоритет: ${PRIORITY_CONFIG[task.priority].label}\n` +
      `📊 Статус: ${STATUS_CONFIG[task.status].title}`

    await sendTelegramNotification(task.operator_telegram_id, message)
    alert('Уведомление отправлено!')
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
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
                    Уведомления приходят в Telegram
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
                  onClick={handleCreateTask}
                  className="rounded-xl bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600 gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Новая задача
                </Button>
              </div>
            </div>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
              <p className="text-xs text-gray-500">Всего задач</p>
              <p className="text-2xl font-bold text-white">{stats.total}</p>
            </Card>
            <Card className="p-4 bg-red-500/5 border-red-500/20">
              <p className="text-xs text-red-400">Просрочено</p>
              <p className="text-2xl font-bold text-red-400">{stats.overdue}</p>
            </Card>
            <Card className="p-4 bg-yellow-500/5 border-yellow-500/20">
              <p className="text-xs text-yellow-400">Скоро дедлайн</p>
              <p className="text-2xl font-bold text-yellow-400">{stats.upcoming}</p>
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

              {/* Фильтр по оператору */}
              <select
                value={filterOperator}
                onChange={(e) => setFilterOperator(e.target.value)}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white focus:outline-none focus:border-violet-500/50"
              >
                <option value="all">Все операторы</option>
                {operators.map(op => (
                  <option key={op.id} value={op.id}>{op.name}</option>
                ))}
              </select>

              {/* Показывать архивные */}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  className="rounded border-white/10 bg-gray-800/50 text-violet-500 focus:ring-violet-500/20"
                />
                <span className="text-sm text-gray-400">Архивные</span>
              </label>

              {/* Сброс фильтров */}
              {(searchTerm || filterStatus !== 'all' || filterPriority !== 'all' || 
                filterCompany !== 'all' || filterOperator !== 'all' || showArchived) && (
                <button
                  onClick={resetFilters}
                  className="text-sm text-gray-500 hover:text-white transition-colors ml-auto"
                >
                  Сбросить
                </button>
              )}
            </div>
          </Card>

          {/* Content */}
          {loading && !refreshing ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-gray-500">Загрузка задач...</p>
            </div>
          ) : error ? (
            <Card className="p-6 border-red-500/30 bg-red-500/10">
              <div className="flex items-center gap-2 text-red-300">
                <AlertCircle className="w-5 h-5" />
                <span>{error}</span>
              </div>
            </Card>
          ) : viewMode === 'kanban' ? (
            // Kanban View
            <div className="flex gap-4 overflow-x-auto pb-4 min-h-[600px]">
              {Object.entries(STATUS_CONFIG).map(([status, config]) => {
                if (!showArchived && status === 'archived') return null
                
                const statusTasks = tasksByStatus[status] || []
                const Icon = config.icon
                
                return (
                  <div
                    key={status}
                    className="w-80 flex-shrink-0 rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-xl p-3"
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
                          onClick={() => handleTaskClick(task)}
                          onStatusChange={(newStatus) => handleStatusChange(task.id, newStatus)}
                          onNotify={() => handleNotifyOperator(task)}
                        />
                      ))}
                      {statusTasks.length === 0 && (
                        <div className="text-center py-8 text-xs text-gray-500 border border-dashed border-white/5 rounded-lg">
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
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-gray-900/50">
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Задача</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Статус</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Приоритет</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Оператор</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Дедлайн</th>
                      <th className="py-3 px-4 text-left text-xs font-medium text-gray-400">Компания</th>
                      <th className="py-3 px-4 text-right text-xs font-medium text-gray-400">Действия</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {filteredTasks.map(task => (
                      <tr
                        key={task.id}
                        onClick={() => handleTaskClick(task)}
                        className="hover:bg-white/5 transition-colors cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <div className="flex flex-col">
                            <span className="font-medium text-white">#{task.task_number}</span>
                            <span className="text-sm text-gray-300 line-clamp-1">{task.title}</span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "text-xs px-2 py-1 rounded-full border",
                            STATUS_CONFIG[task.status].color
                          )}>
                            {STATUS_CONFIG[task.status].title}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "text-xs px-2 py-1 rounded-full",
                            PRIORITY_CONFIG[task.priority].color
                          )}>
                            {PRIORITY_CONFIG[task.priority].icon} {PRIORITY_CONFIG[task.priority].label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[10px] font-bold">
                              {task.operator_name?.[0] || '?'}
                            </div>
                            <span className="text-sm text-gray-300">{task.operator_name || 'Не назначен'}</span>
                            {task.operator_telegram_id && (
                              <Send className="w-3 h-3 text-blue-400" />
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {task.due_date ? (
                            <div className={cn(
                              "flex items-center gap-1 text-sm",
                              isOverdue(task.due_date, task.status) ? "text-red-400" : "text-gray-300"
                            )}>
                              <Calendar className="w-3 h-3" />
                              {formatDate(task.due_date)}
                              {isOverdue(task.due_date, task.status) && (
                                <span className="text-[10px] text-red-400">(просрочено)</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4">
                          {task.company_name ? (
                            <span className={cn(
                              "text-xs px-2 py-1 rounded-full border",
                              getCompanyStyle(task.company_code)
                            )}>
                              {task.company_name}
                            </span>
                          ) : (
                            <span className="text-gray-500">—</span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {task.operator_telegram_id && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-blue-400 hover:text-blue-300"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  handleNotifyOperator(task)
                                }}
                                title="Отправить в Telegram"
                              >
                                <Send className="w-4 h-4" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-gray-500 hover:text-white"
                              onClick={(e) => {
                                e.stopPropagation()
                                // Меню действий
                              }}
                            >
                              <MoreHorizontal className="w-4 h-4" />
                            </Button>
                          </div>
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
      </main>

      {/* Task Detail Modal */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={isTaskModalOpen}
          onClose={() => {
            setIsTaskModalOpen(false)
            setSelectedTask(null)
          }}
          onUpdate={(updatedTask) => {
            setTasks(prev => prev.map(t => t.id === updatedTask.id ? updatedTask : t))
          }}
          operators={operators}
          companies={companies}
          projects={projects}
          onNotify={handleNotifyOperator}
        />
      )}

      {/* Create Task Modal */}
      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={(newTask) => {
          setTasks(prev => [newTask, ...prev])
          loadData(true)
        }}
        operators={operators}
        companies={companies}
        projects={projects}
      />
    </div>
  )
}

// =====================
// TASK CARD COMPONENT
// =====================
function TaskCard({ task, onClick, onStatusChange, onNotify }: { 
  task: Task; 
  onClick: () => void;
  onStatusChange: (status: string) => void;
  onNotify: () => void;
}) {
  const [showMenu, setShowMenu] = useState(false)
  const isTaskOverdue = isOverdue(task.due_date, task.status)
  const daysUntilDue = getDaysUntilDue(task.due_date)

  return (
    <div
      onClick={onClick}
      className="bg-gray-800/50 border border-white/5 rounded-lg p-3 hover:bg-gray-700/50 transition-colors cursor-pointer relative group"
    >
      {/* Кнопки действий (по ховеру) */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
        {task.operator_telegram_id && (
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
              const Icon = config.icon
              return (
                <button
                  key={status}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStatusChange(status)
                    setShowMenu(false)
                  }}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-white/5 flex items-center gap-2"
                >
                  <Icon className="w-3.5 h-3.5" />
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
        <h4 className="font-medium text-sm line-clamp-2 mt-0.5">{task.title}</h4>
      </div>

      {/* Приоритет и теги */}
      <div className="flex flex-wrap gap-1 mb-2">
        <span className={cn(
          "text-[10px] px-1.5 py-0.5 rounded-full",
          PRIORITY_CONFIG[task.priority].color
        )}>
          {PRIORITY_CONFIG[task.priority].icon} {PRIORITY_CONFIG[task.priority].label}
        </span>
        
        {task.tags?.map(tag => (
          <span
            key={tag}
            className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-700/50 text-gray-300"
          >
            #{tag}
          </span>
        ))}
      </div>

      {/* Оператор и компания */}
      <div className="flex items-center justify-between text-xs mb-2">
        <div className="flex items-center gap-1 text-gray-400">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[8px] font-bold">
            {task.operator_name?.[0] || '?'}
          </div>
          <span className="text-[10px]">{task.operator_name || 'Не назначен'}</span>
          {task.operator_telegram_id && (
            <Send className="w-2.5 h-2.5 text-blue-400" />
          )}
        </div>

        {task.company_name && (
          <span className={cn(
            "text-[8px] px-1.5 py-0.5 rounded-full border",
            getCompanyStyle(task.company_code)
          )}>
            {task.company_name}
          </span>
        )}
      </div>

      {/* Дедлайн */}
      {task.due_date && (
        <div className={cn(
          "flex items-center gap-1 text-[10px] mb-2",
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

      {/* Чек-лист и комментарии */}
      <div className="flex items-center gap-3 text-[10px] text-gray-500">
        {task.checklist && task.checklist.length > 0 && (
          <span className="flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {task.checklist.filter(c => c.is_completed).length}/{task.checklist.length}
          </span>
        )}
        {task.comments_count ? (
          <span className="flex items-center gap-1">
            <MessageSquare className="w-3 h-3" />
            {task.comments_count}
          </span>
        ) : null}
      </div>
    </div>
  )
}

// =====================
// TASK DETAIL MODAL
// =====================
function TaskDetailModal({ task, isOpen, onClose, onUpdate, operators, companies, projects, onNotify }: any) {
  const [comments, setComments] = useState<TaskComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isOpen && task) {
      loadComments()
    }
  }, [isOpen, task])

  const loadComments = async () => {
    const { data } = await supabase
      .from('task_comments')
      .select(`
        *,
        operator:operator_id(name),
        staff:staff_id(full_name)
      `)
      .eq('task_id', task.id)
      .order('created_at', { ascending: true })

    if (data) {
      setComments(data.map((c: any) => ({
        ...c,
        author_name: c.operator?.name || c.staff?.full_name,
        author_type: c.operator_id ? 'operator' : 'staff'
      })))
    }
  }

  const handleAddComment = async () => {
    if (!newComment.trim()) return

    setLoading(true)
    // TODO: определить текущего пользователя (staff или operator)
    const commentData = {
      task_id: task.id,
      staff_id: 'current-staff-id', // заменить на реальный ID
      content: newComment
    }

    const { data, error } = await supabase
      .from('task_comments')
      .insert(commentData)
      .select()
      .single()

    if (!error && data) {
      setComments([...comments, {
        ...data,
        author_name: 'Администратор', // заменить на реальное имя
        author_type: 'staff'
      }])
      setNewComment('')
    }
    setLoading(false)
  }

  const priorityConfig = PRIORITY_CONFIG[task.priority]
  const statusConfig = STATUS_CONFIG[task.status]
  const StatusIcon = statusConfig.icon
  const isTaskOverdue = isOverdue(task.due_date, task.status)
  const daysUntilDue = getDaysUntilDue(task.due_date)

  if (!isOpen) return null

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-white/10 text-white max-w-3xl max-h-[90vh] overflow-auto">
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
            {task.operator_telegram_id && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => onNotify(task)}
                className="gap-2"
              >
                <Send className="w-4 h-4" />
                Уведомить в Telegram
              </Button>
            )}
          </div>
        </DialogHeader>

        <div className="space-y-6 py-4">
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
                  {task.operator_name?.[0] || '?'}
                </div>
                <span className="text-sm">{task.operator_name || 'Не назначен'}</span>
                {task.operator_telegram_id && (
                  <Send className="w-3 h-3 text-blue-400" />
                )}
              </div>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-500 mb-1">Дедлайн</p>
              {task.due_date ? (
                <div className={cn(
                  "flex items-center gap-2",
                  isTaskOverdue ? "text-red-400" : "text-gray-300"
                )}>
                  <Calendar className="w-4 h-4" />
                  <span className="text-sm">{formatDate(task.due_date)}</span>
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

          {/* Компания и проект */}
          {(task.company_name || task.project_name) && (
            <div className="flex gap-4 p-3 bg-white/5 rounded-lg">
              {task.company_name && (
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "text-xs px-2 py-1 rounded-full border",
                    getCompanyStyle(task.company_code)
                  )}>
                    {task.company_name}
                  </span>
                </div>
              )}
              {task.project_name && (
                <div className="flex items-center gap-2">
                  <span 
                    className="text-xs px-2 py-1 rounded-full"
                    style={{ backgroundColor: task.project_color + '20', color: task.project_color }}
                  >
                    {task.project_name}
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Описание */}
          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">Описание</h3>
            <div className="bg-gray-800/50 border border-white/5 rounded-lg p-4 min-h-[100px]">
              {task.description ? (
                <p className="text-sm whitespace-pre-wrap">{task.description}</p>
              ) : (
                <p className="text-sm text-gray-500 italic">Нет описания</p>
              )}
            </div>
          </div>

          {/* Чек-лист */}
          {task.checklist && task.checklist.length > 0 && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">Чек-лист</h3>
              <div className="space-y-2">
                {task.checklist.map((item: TaskChecklist) => (
                  <div key={item.id} className="flex items-center gap-2 bg-gray-800/30 p-2 rounded">
                    <input
                      type="checkbox"
                      checked={item.is_completed}
                      className="rounded border-white/10 bg-gray-800 text-violet-500"
                      readOnly
                    />
                    <span className={cn(
                      "text-sm flex-1",
                      item.is_completed && "line-through text-gray-500"
                    )}>
                      {item.title}
                    </span>
                  </div>
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
                className="flex-1 bg-gray-800/50 border border-white/10 rounded-lg p-3 text-sm resize-none text-white"
                rows={3}
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
              {comments.map((comment) => (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {comment.author_name?.[0] || '?'}
                  </div>
                  <div className="flex-1">
                    <div className="bg-gray-800/50 border border-white/5 rounded-lg p-3">
                      <div className="flex justify-between mb-1">
                        <span className="font-medium text-sm">{comment.author_name}</span>
                        <span className="text-xs text-gray-500">
                          {formatDateTime(comment.created_at)}
                        </span>
                      </div>
                      <p className="text-sm whitespace-pre-wrap">{comment.content}</p>
                    </div>
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
function CreateTaskModal({ isOpen, onClose, onSuccess, operators, companies, projects }: any) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    project_id: '',
    company_id: '',
    operator_id: '',
    due_date: '',
    estimated_hours: '',
    tags: '',
    is_urgent: false,
    is_important: false
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const taskData = {
      ...form,
      estimated_hours: form.estimated_hours ? Number(form.estimated_hours) : null,
      tags: form.tags ? form.tags.split(',').map(t => t.trim()) : [],
      created_by: 'current-staff-id', // TODO: get current staff ID
    }

    const { data, error } = await supabase
      .from('tasks')
      .insert([taskData])
      .select(`
        *,
        operator:operators!operator_id(name, short_name, telegram_id),
        company:companies(name, code),
        project:projects(name, color)
      `)
      .single()

    setLoading(false)

    if (!error && data) {
      // Отправляем уведомление оператору в Telegram
      if (data.operator?.telegram_id) {
        const message = `📋 Новая задача #${data.task_number}\n\n` +
          `${data.title}\n\n` +
          `📅 Дедлайн: ${data.due_date ? formatDate(data.due_date) : 'не указан'}\n` +
          `🔥 Приоритет: ${PRIORITY_CONFIG[data.priority].label}`

        await fetch('/api/telegram/send', {
          method: 'POST',
          body: JSON.stringify({
            chat_id: data.operator.telegram_id,
            text: message
          })
        })
      }

      onSuccess({
        ...data,
        operator_name: data.operator?.name,
        operator_short_name: data.operator?.short_name,
        operator_telegram_id: data.operator?.telegram_id,
        company_name: data.company?.name,
        company_code: data.company?.code,
        project_name: data.project?.name,
        checklist: [],
        comments_count: 0
      })
      onClose()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-white/10 text-white sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl">Новая задача</DialogTitle>
          <DialogDescription className="text-gray-400">
            Создайте задачу для оператора
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-4">
          <div className="space-y-2">
            <label className="text-xs text-gray-400 font-medium">Название *</label>
            <Input
              value={form.title}
              onChange={(e) => setForm({...form, title: e.target.value})}
              className="bg-gray-800/50 border-white/10 text-white"
              placeholder="Краткое описание задачи"
              required
            />
          </div>

          <div className="space-y-2">
            <label className="text-xs text-gray-400 font-medium">Описание</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({...form, description: e.target.value})}
              className="w-full min-h-[100px] bg-gray-800/50 border border-white/10 rounded-lg p-3 text-sm text-white resize-y"
              placeholder="Подробное описание задачи..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Приоритет</label>
              <select
                value={form.priority}
                onChange={(e) => setForm({...form, priority: e.target.value})}
                className="w-full h-9 rounded-md border border-white/10 bg-gray-800/50 px-3 py-1 text-sm text-white"
              >
                <option value="critical">🔥 Критический</option>
                <option value="high">⚡ Высокий</option>
                <option value="medium">📌 Средний</option>
                <option value="low">💧 Низкий</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Статус</label>
              <select
                value={form.status}
                onChange={(e) => setForm({...form, status: e.target.value})}
                className="w-full h-9 rounded-md border border-white/10 bg-gray-800/50 px-3 py-1 text-sm text-white"
              >
                <option value="todo">К выполнению</option>
                <option value="in_progress">В работе</option>
                <option value="review">На проверке</option>
                <option value="backlog">Бэклог</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Проект</label>
              <select
                value={form.project_id}
                onChange={(e) => setForm({...form, project_id: e.target.value})}
                className="w-full h-9 rounded-md border border-white/10 bg-gray-800/50 px-3 py-1 text-sm text-white"
              >
                <option value="">Без проекта</option>
                {projects.map((p: any) => (
                  <option key={p.id} value={p.id}>{p.icon} {p.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Компания</label>
              <select
                value={form.company_id}
                onChange={(e) => setForm({...form, company_id: e.target.value})}
                className="w-full h-9 rounded-md border border-white/10 bg-gray-800/50 px-3 py-1 text-sm text-white"
              >
                <option value="">Все компании</option>
                {companies.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Оператор</label>
              <select
                value={form.operator_id}
                onChange={(e) => setForm({...form, operator_id: e.target.value})}
                className="w-full h-9 rounded-md border border-white/10 bg-gray-800/50 px-3 py-1 text-sm text-white"
              >
                <option value="">Не назначен</option>
                {operators.map((op: Operator) => (
                  <option key={op.id} value={op.id}>
                    {op.name} {op.telegram_id ? '📱' : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Дедлайн</label>
              <Input
                type="date"
                value={form.due_date}
                onChange={(e) => setForm({...form, due_date: e.target.value})}
                className="bg-gray-800/50 border-white/10 text-white"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Оценка (часы)</label>
              <Input
                type="number"
                value={form.estimated_hours}
                onChange={(e) => setForm({...form, estimated_hours: e.target.value})}
                className="bg-gray-800/50 border-white/10 text-white"
                placeholder="2.5"
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs text-gray-400 font-medium">Теги (через запятую)</label>
              <Input
                value={form.tags}
                onChange={(e) => setForm({...form, tags: e.target.value})}
                className="bg-gray-800/50 border-white/10 text-white"
                placeholder="баг, срочно, дизайн"
              />
            </div>
          </div>

          <div className="flex gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_urgent}
                onChange={(e) => setForm({...form, is_urgent: e.target.checked})}
                className="rounded border-white/10 bg-gray-800/50 text-violet-500"
              />
              <span className="text-sm text-gray-400">Срочная</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.is_important}
                onChange={(e) => setForm({...form, is_important: e.target.checked})}
                className="rounded border-white/10 bg-gray-800/50 text-violet-500"
              />
              <span className="text-sm text-gray-400">Важная</span>
            </label>
          </div>

          <DialogFooter className="pt-4">
            <Button
              type="button"
              variant="ghost"
              onClick={onClose}
              className="text-gray-400 hover:text-white"
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={loading || !form.title}
              className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
            >
              {loading ? 'Создание...' : 'Создать задачу'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// =====================
// MAIN EXPORT with Suspense
// =====================
export default function TasksPage() {
  return (
    <Suspense fallback={<TasksLoading />}>
      <TasksContent />
    </Suspense>
  )
}
