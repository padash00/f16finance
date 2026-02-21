'use client'

import { useEffect, useState, useCallback, useMemo, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'

// =====================
// TYPES (под твою структуру)
// =====================
type Operator = {
  id: string
  name: string
  short_name: string | null
  telegram_id?: string | null  // если есть в таблице
  company_id: string | null
  is_active: boolean
}

type Staff = {
  id: string
  full_name: string
  short_name: string | null
}

type Company = {
  id: string
  name: string
  code: string | null
}

type Task = {
  id: string
  title: string
  description: string | null
  task_number: number
  status: string
  priority: string
  operator_id: string | null
  created_by: string | null
  company_id: string | null
  due_date: string | null
  tags: string[] | null
  created_at: string
  updated_at: string
  completed_at: string | null
  
  // Расширенные поля (будут заполняться отдельно)
  operator_name?: string
  operator_short_name?: string | null
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
}

// =====================
// CONSTANTS
// =====================
const STATUS_CONFIG: Record<string, { title: string; color: string }> = {
  backlog: { title: 'Бэклог', color: 'bg-gray-500/10 text-gray-400' },
  todo: { title: 'К выполнению', color: 'bg-blue-500/10 text-blue-400' },
  in_progress: { title: 'В работе', color: 'bg-yellow-500/10 text-yellow-400' },
  review: { title: 'На проверке', color: 'bg-purple-500/10 text-purple-400' },
  done: { title: 'Готово', color: 'bg-emerald-500/10 text-emerald-400' },
  archived: { title: 'Архив', color: 'bg-gray-500/10 text-gray-400' }
}

const PRIORITY_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
  critical: { icon: '🔥', color: 'text-red-400 bg-red-500/10', label: 'Критический' },
  high: { icon: '⚡', color: 'text-orange-400 bg-orange-500/10', label: 'Высокий' },
  medium: { icon: '📌', color: 'text-blue-400 bg-blue-500/10', label: 'Средний' },
  low: { icon: '💧', color: 'text-green-400 bg-green-500/10', label: 'Низкий' }
}

// =====================
// UTILS
// =====================
const formatDate = (date: string | null) => {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('ru-RU')
}

const isOverdue = (dueDate: string | null, status: string) => {
  if (!dueDate || status === 'done' || status === 'archived') return false
  return new Date(dueDate) < new Date()
}

// =====================
// LOADING
// =====================
function TasksLoading() {
  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
      <Sidebar />
      <main className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 animate-pulse flex items-center justify-center">
            <Kanban className="w-8 h-8 text-white" />
          </div>
          <p className="text-gray-400">Загрузка задач...</p>
        </div>
      </main>
    </div>
  )
}

// =====================
// MAIN CONTENT
// =====================
function TasksContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // Состояния
  const [tasks, setTasks] = useState<Task[]>([])
  const [operators, setOperators] = useState<Operator[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [staff, setStaff] = useState<Staff[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'kanban' | 'list'>('kanban')
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)

  // Фильтры
  const [searchTerm, setSearchTerm] = useState(searchParams.get('q') || '')
  const [filterStatus, setFilterStatus] = useState(searchParams.get('status') || 'all')
  const [filterOperator, setFilterOperator] = useState(searchParams.get('operator') || 'all')

  // Загрузка данных
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)

    try {
      // Загружаем операторов
      const { data: operatorsData, error: operatorsError } = await supabase
        .from('operators')
        .select('id, name, short_name, company_id, is_active')
        .eq('is_active', true)

      if (operatorsError) throw operatorsError
      setOperators(operatorsData || [])

      // Загружаем компании
      const { data: companiesData, error: companiesError } = await supabase
        .from('companies')
        .select('id, name, code')

      if (companiesError) throw companiesError
      setCompanies(companiesData || [])

      // Загружаем задачи
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select('*')
        .order('created_at', { ascending: false })

      if (tasksError) throw tasksError

      // Обогащаем задачи данными
      const enrichedTasks = (tasksData || []).map(task => ({
        ...task,
        operator_name: operatorsData?.find(o => o.id === task.operator_id)?.name,
        operator_short_name: operatorsData?.find(o => o.id === task.operator_id)?.short_name,
        company_name: companiesData?.find(c => c.id === task.company_id)?.name,
        company_code: companiesData?.find(c => c.id === task.company_id)?.code,
      }))

      setTasks(enrichedTasks)

    } catch (err) {
      console.error('Error loading data:', err)
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // Фильтрация задач
  const filteredTasks = useMemo(() => {
    return tasks.filter(task => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase()
        const matches = task.title.toLowerCase().includes(term) ||
                       task.operator_name?.toLowerCase().includes(term)
        if (!matches) return false
      }
      if (filterStatus !== 'all' && task.status !== filterStatus) return false
      if (filterOperator !== 'all' && task.operator_id !== filterOperator) return false
      return true
    })
  }, [tasks, searchTerm, filterStatus, filterOperator])

  // Группировка по статусам
  const tasksByStatus = useMemo(() => {
    const grouped: Record<string, Task[]> = {}
    Object.keys(STATUS_CONFIG).forEach(status => {
      grouped[status] = filteredTasks.filter(t => t.status === status)
    })
    return grouped
  }, [filteredTasks])

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
        t.id === taskId ? { ...t, status: newStatus } : t
      ))
    }
  }

  if (loading) {
    return <TasksLoading />
  }

  if (error) {
    return (
      <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950">
        <Sidebar />
        <main className="flex-1 p-8">
          <Card className="p-6 border-red-500/30 bg-red-500/10">
            <div className="flex items-center gap-2 text-red-300">
              <AlertCircle className="w-5 h-5" />
              <span>{error}</span>
            </div>
            <Button onClick={loadData} className="mt-4 bg-violet-500 hover:bg-violet-600">
              <RefreshCw className="w-4 h-4 mr-2" />
              Повторить
            </Button>
          </Card>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-gray-100">
      <Sidebar />

      <main className="flex-1 overflow-auto">
        <div className="p-4 lg:p-8 max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-violet-600/20 via-fuchsia-600/20 to-pink-600/20 border border-white/10 p-6 lg:p-8">
            <div className="absolute top-0 right-0 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-fuchsia-500/20 rounded-full blur-3xl" />

            <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-gradient-to-br from-violet-500 to-fuchsia-500 rounded-2xl">
                  <Kanban className="w-8 h-8 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold text-white">
                    Задачи операторов
                  </h1>
                  <p className="text-gray-400 mt-1">
                    Управление задачами и контроль выполнения
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={loadData}
                  className="border-white/10 bg-gray-900/50 hover:bg-white/10"
                >
                  <RefreshCw className="w-4 h-4" />
                </Button>

                <div className="flex bg-gray-900/50 rounded-xl p-1 border border-white/10">
                  <button
                    onClick={() => setViewMode('kanban')}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'kanban' ? 'bg-white/10 text-white' : 'text-gray-400'
                    )}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setViewMode('list')}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-400'
                    )}
                  >
                    <LayoutList className="w-4 h-4" />
                  </button>
                </div>

                <Button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="bg-gradient-to-r from-violet-500 to-fuchsia-500 hover:from-violet-600 hover:to-fuchsia-600"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Новая задача
                </Button>
              </div>
            </div>
          </div>

          {/* Filters */}
          <Card className="p-4 bg-gray-900/40 backdrop-blur-xl border-white/5">
            <div className="flex flex-wrap items-center gap-3">
              <Filter className="w-4 h-4 text-gray-500" />

              <div className="relative flex-1 max-w-xs">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Поиск задач..."
                  className="w-full pl-9 pr-8 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white"
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

              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white"
              >
                <option value="all">Все статусы</option>
                {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                  <option key={key} value={key}>{config.title}</option>
                ))}
              </select>

              <select
                value={filterOperator}
                onChange={(e) => setFilterOperator(e.target.value)}
                className="px-3 py-2 bg-gray-800/50 border border-white/10 rounded-lg text-sm text-white"
              >
                <option value="all">Все операторы</option>
                {operators.map(op => (
                  <option key={op.id} value={op.id}>{op.name}</option>
                ))}
              </select>
            </div>
          </Card>

          {/* Kanban Board */}
          {viewMode === 'kanban' && (
            <div className="flex gap-4 overflow-x-auto pb-4 min-h-[600px]">
              {Object.entries(STATUS_CONFIG).map(([status, config]) => {
                const statusTasks = tasksByStatus[status] || []
                
                return (
                  <div
                    key={status}
                    className="w-80 flex-shrink-0 rounded-xl border border-white/5 bg-gray-900/40 backdrop-blur-xl p-3"
                  >
                    <div className="flex items-center justify-between mb-3 px-2">
                      <h3 className="font-medium text-sm">{config.title}</h3>
                      <span className="text-xs bg-white/5 px-2 py-1 rounded-full">
                        {statusTasks.length}
                      </span>
                    </div>

                    <div className="space-y-2">
                      {statusTasks.map(task => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          onClick={() => {
                            setSelectedTask(task)
                            setIsTaskModalOpen(true)
                          }}
                          onStatusChange={(newStatus) => handleStatusChange(task.id, newStatus)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* List View */}
          {viewMode === 'list' && (
            <Card className="bg-gray-900/40 backdrop-blur-xl border-white/5 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/5 bg-gray-900/50">
                      <th className="py-3 px-4 text-left">Задача</th>
                      <th className="py-3 px-4 text-left">Статус</th>
                      <th className="py-3 px-4 text-left">Приоритет</th>
                      <th className="py-3 px-4 text-left">Оператор</th>
                      <th className="py-3 px-4 text-left">Дедлайн</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredTasks.map(task => (
                      <tr
                        key={task.id}
                        onClick={() => {
                          setSelectedTask(task)
                          setIsTaskModalOpen(true)
                        }}
                        className="border-t border-white/5 hover:bg-white/5 cursor-pointer"
                      >
                        <td className="py-3 px-4">
                          <div>
                            <span className="font-medium">#{task.task_number}</span>
                            <div className="text-sm text-gray-300">{task.title}</div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "text-xs px-2 py-1 rounded-full",
                            STATUS_CONFIG[task.status]?.color
                          )}>
                            {STATUS_CONFIG[task.status]?.title}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <span className={cn(
                            "text-xs px-2 py-1 rounded-full",
                            PRIORITY_CONFIG[task.priority]?.color
                          )}>
                            {PRIORITY_CONFIG[task.priority]?.icon} {PRIORITY_CONFIG[task.priority]?.label}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          {task.operator_name || '—'}
                        </td>
                        <td className="py-3 px-4">
                          {task.due_date && (
                            <span className={isOverdue(task.due_date, task.status) ? 'text-red-400' : ''}>
                              {formatDate(task.due_date)}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </main>

      {/* Modals */}
      {selectedTask && (
        <TaskDetailModal
          task={selectedTask}
          isOpen={isTaskModalOpen}
          onClose={() => {
            setIsTaskModalOpen(false)
            setSelectedTask(null)
          }}
          operators={operators}
        />
      )}

      <CreateTaskModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={() => {
          loadData()
          setIsCreateModalOpen(false)
        }}
        operators={operators}
        companies={companies}
      />
    </div>
  )
}

// =====================
// TASK CARD
// =====================
function TaskCard({ task, onClick, onStatusChange }: any) {
  const [showMenu, setShowMenu] = useState(false)

  return (
    <div
      onClick={onClick}
      className="bg-gray-800/50 border border-white/5 rounded-lg p-3 hover:bg-gray-700/50 cursor-pointer relative group"
    >
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100">
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
          <div className="absolute right-0 mt-1 w-40 bg-gray-800 border border-white/10 rounded-lg shadow-xl z-10">
            {Object.entries(STATUS_CONFIG).map(([status, config]) => {
              if (status === task.status) return null
              return (
                <button
                  key={status}
                  onClick={(e) => {
                    e.stopPropagation()
                    onStatusChange(status)
                    setShowMenu(false)
                  }}
                  className="w-full px-3 py-2 text-left text-xs hover:bg-white/5"
                >
                  {config.title}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="pr-8 mb-2">
        <span className="text-[10px] text-gray-500">#{task.task_number}</span>
        <h4 className="font-medium text-sm line-clamp-2 mt-1">{task.title}</h4>
      </div>

      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-[8px] font-bold">
            {task.operator_name?.[0] || '?'}
          </div>
          <span className="text-gray-400">{task.operator_name || 'Не назначен'}</span>
        </div>

        {task.due_date && (
          <span className={cn(
            "text-[10px]",
            isOverdue(task.due_date, task.status) ? "text-red-400" : "text-gray-500"
          )}>
            {formatDate(task.due_date)}
          </span>
        )}
      </div>
    </div>
  )
}

// =====================
// TASK DETAIL MODAL
// =====================
function TaskDetailModal({ task, isOpen, onClose, operators }: any) {
  const [comments, setComments] = useState<TaskComment[]>([])

  useEffect(() => {
    if (isOpen && task) {
      loadComments()
    }
  }, [isOpen, task])

  const loadComments = async () => {
    const { data } = await supabase
      .from('task_comments')
      .select('*')
      .eq('task_id', task.id)
      .order('created_at', { ascending: true })

    if (data) {
      setComments(data.map((c: any) => ({
        ...c,
        author_name: operators.find((o: Operator) => o.id === c.operator_id)?.name || 'Админ'
      })))
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-white/10 text-white max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <span className="text-gray-500">#{task.task_number}</span>
            <span>{task.title}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-400">Статус</p>
              <p className="text-sm mt-1">{STATUS_CONFIG[task.status]?.title}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-400">Приоритет</p>
              <p className="text-sm mt-1">{PRIORITY_CONFIG[task.priority]?.label}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-400">Оператор</p>
              <p className="text-sm mt-1">{task.operator_name || 'Не назначен'}</p>
            </div>
            <div className="p-3 bg-white/5 rounded-lg">
              <p className="text-xs text-gray-400">Дедлайн</p>
              <p className="text-sm mt-1">{formatDate(task.due_date)}</p>
            </div>
          </div>

          {task.description && (
            <div>
              <h3 className="text-sm font-medium text-gray-400 mb-2">Описание</h3>
              <div className="bg-gray-800/50 rounded-lg p-3">
                <p className="text-sm whitespace-pre-wrap">{task.description}</p>
              </div>
            </div>
          )}

          <div>
            <h3 className="text-sm font-medium text-gray-400 mb-2">Комментарии</h3>
            <div className="space-y-3 max-h-60 overflow-auto">
              {comments.map(comment => (
                <div key={comment.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-xs font-bold">
                    {comment.author_name?.[0] || '?'}
                  </div>
                  <div className="flex-1 bg-gray-800/50 rounded-lg p-3">
                    <div className="flex justify-between mb-1">
                      <span className="font-medium text-sm">{comment.author_name}</span>
                      <span className="text-xs text-gray-500">
                        {new Date(comment.created_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm">{comment.content}</p>
                  </div>
                </div>
              ))}
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
function CreateTaskModal({ isOpen, onClose, onSuccess, operators, companies }: any) {
  const [form, setForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    status: 'todo',
    operator_id: '',
    company_id: '',
    due_date: ''
  })
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    const { error } = await supabase
      .from('tasks')
      .insert([{
        ...form,
        created_by: '00000000-0000-0000-0000-000000000000', // временный ID
      }])

    setLoading(false)

    if (!error) {
      onSuccess()
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-gray-900 border-white/10 text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            placeholder="Название задачи"
            value={form.title}
            onChange={(e) => setForm({...form, title: e.target.value})}
            className="bg-gray-800/50 border-white/10"
            required
          />

          <textarea
            placeholder="Описание"
            value={form.description}
            onChange={(e) => setForm({...form, description: e.target.value})}
            className="w-full h-24 bg-gray-800/50 border border-white/10 rounded-lg p-2 text-sm"
          />

          <select
            value={form.operator_id}
            onChange={(e) => setForm({...form, operator_id: e.target.value})}
            className="w-full h-9 bg-gray-800/50 border border-white/10 rounded-lg px-3 text-sm"
          >
            <option value="">Выберите оператора</option>
            {operators.map((op: Operator) => (
              <option key={op.id} value={op.id}>{op.name}</option>
            ))}
          </select>

          <select
            value={form.priority}
            onChange={(e) => setForm({...form, priority: e.target.value})}
            className="w-full h-9 bg-gray-800/50 border border-white/10 rounded-lg px-3 text-sm"
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

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Создание...' : 'Создать'}
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
