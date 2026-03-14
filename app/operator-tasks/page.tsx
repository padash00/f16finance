'use client'

import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sidebar } from '@/components/sidebar'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabaseClient'
import { CheckCircle2, Clock3, Loader2, MessageSquare, RefreshCw, Send, SquareKanban, AlertTriangle } from 'lucide-react'

type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'review' | 'done' | 'archived'
type TaskResponse = 'accept' | 'need_info' | 'blocked' | 'already_done' | 'complete'

type Task = {
  id: string
  task_number: number
  title: string
  description: string | null
  status: TaskStatus
  priority: 'critical' | 'high' | 'medium' | 'low'
  due_date: string | null
  operator_name: string | null
  company_name: string | null
  company_code: string | null
  created_at: string
  updated_at: string
}

type TaskComment = {
  id: string
  task_id: string
  content: string
  created_at: string
  author_name: string
  author_type: 'operator' | 'staff'
}

type Notice = {
  tone: 'success' | 'error' | 'info'
  text: string
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  backlog: 'Бэклог',
  todo: 'К выполнению',
  in_progress: 'В работе',
  review: 'На проверке',
  done: 'Готово',
  archived: 'Архив',
}

const RESPONSE_CONFIG: Record<TaskResponse, { label: string; status: TaskStatus }> = {
  accept: { label: 'Принял в работу', status: 'in_progress' },
  need_info: { label: 'Нужны уточнения', status: 'backlog' },
  blocked: { label: 'Не могу выполнить', status: 'backlog' },
  already_done: { label: 'Уже сделано', status: 'review' },
  complete: { label: 'Завершил задачу', status: 'done' },
}

function formatDate(date: string | null) {
  if (!date) return 'Без дедлайна'
  return new Date(`${date}T12:00:00`).toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
  })
}

function formatDateTime(date: string) {
  return new Date(date).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function OperatorTasksPage() {
  const router = useRouter()
  const realtimeRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [submitting, setSubmitting] = useState<string | null>(null)
  const [commenting, setCommenting] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [comments, setComments] = useState<TaskComment[]>([])
  const [operatorName, setOperatorName] = useState<string>('Оператор')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [commentText, setCommentText] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;['/operator-dashboard', '/operator-schedule'].forEach((route) => router.prefetch(route))
  }, [router])

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) {
        setLoading(true)
      } else {
        setRefreshing(true)
      }

      const response = await fetch('/api/operator/tasks', { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      setTasks(json?.tasks || [])
      setComments(json?.comments || [])
      setOperatorName(json?.operator?.name || 'Оператор')
      setError(null)
    } catch (err: any) {
      console.error('Operator tasks load error', err)
      setError(err?.message || 'Не удалось загрузить задачи')
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
      .channel('operator-tasks-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleRefresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, scheduleRefresh)
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

    const intervalId = window.setInterval(() => refreshIfVisible(), 4000)
    const onFocus = () => refreshIfVisible()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refreshIfVisible()
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadData])

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedTaskId) || tasks[0] || null,
    [selectedTaskId, tasks],
  )

  useEffect(() => {
    if (!selectedTaskId && tasks.length > 0) {
      setSelectedTaskId(tasks[0].id)
    }
  }, [selectedTaskId, tasks])

  const taskComments = useMemo(
    () => (selectedTask ? comments.filter((comment) => comment.task_id === selectedTask.id) : []),
    [comments, selectedTask],
  )

  const taskGroups = useMemo(() => {
    return {
      active: tasks.filter((task) => ['todo', 'in_progress', 'review', 'backlog'].includes(task.status)),
      done: tasks.filter((task) => task.status === 'done'),
      archived: tasks.filter((task) => task.status === 'archived'),
    }
  }, [tasks])

  const handleResponse = async (responseType: TaskResponse) => {
    if (!selectedTask) return

    setSubmitting(responseType)
    setNotice(null)
    try {
      const response = await fetch('/api/operator/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respondTask',
          taskId: selectedTask.id,
          response: responseType,
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      setNotice({
        tone: 'success',
        text: `Ответ сохранён: ${RESPONSE_CONFIG[responseType].label}.`,
      })
      await loadData(true)
    } catch (err: any) {
      setNotice({
        tone: 'error',
        text: err?.message || 'Не удалось отправить ответ по задаче.',
      })
    } finally {
      setSubmitting(null)
    }
  }

  const handleComment = async () => {
    if (!selectedTask || !commentText.trim()) return

    setCommenting(true)
    setNotice(null)
    try {
      const response = await fetch('/api/operator/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addComment',
          taskId: selectedTask.id,
          content: commentText.trim(),
        }),
      })

      const json = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(json?.error || `Ошибка запроса (${response.status})`)
      }

      setCommentText('')
      setNotice({
        tone: 'success',
        text: 'Комментарий отправлен.',
      })
      await loadData(true)
    } catch (err: any) {
      setNotice({
        tone: 'error',
        text: err?.message || 'Не удалось добавить комментарий.',
      })
    } finally {
      setCommenting(false)
    }
  }

  const navigateTo = (path: string) => {
    router.prefetch(path)
    startTransition(() => {
      router.push(path)
    })
  }

  return (
    <div className="app-shell-layout">
      <Sidebar />
      <main className="app-main">
        <div className="app-page max-w-7xl space-y-5 sm:space-y-6">
          <div className="rounded-[1.7rem] border border-white/8 bg-[radial-gradient(circle_at_top_left,rgba(128,90,213,0.18),transparent_35%),linear-gradient(180deg,rgba(10,18,30,0.98),rgba(8,14,24,0.98))] p-4 shadow-[0_22px_70px_rgba(0,0,0,0.24)] sm:rounded-[2rem] sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-3 text-white">
                  <div className="flex h-11 w-11 items-center justify-center rounded-[1rem] border border-white/10 bg-white/[0.04] sm:h-12 sm:w-12">
                    <SquareKanban className="h-6 w-6 text-[#ffd27b]" />
                  </div>
                  <div>
                    <h1 className="text-xl font-semibold tracking-[-0.04em] sm:text-2xl">Мои задачи</h1>
                    <p className="mt-1 text-sm text-slate-400">Рабочий контур для {operatorName}</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                <Button variant="outline" className="w-full border-white/10 sm:w-auto" onClick={() => navigateTo('/operator-dashboard')}>
                  Назад в кабинет
                </Button>
                <Button variant="outline" className="w-full border-white/10 sm:w-auto" onClick={() => navigateTo('/operator-schedule')}>
                  Перейти в мой график
                </Button>
                <Button variant="outline" onClick={() => loadData(true)} className="w-full gap-2 sm:w-auto">
                  {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Обновить
                </Button>
              </div>
            </div>
          </div>

          {notice ? (
            <div
              className={
                notice.tone === 'success'
                  ? 'rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200'
                  : notice.tone === 'error'
                    ? 'rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200'
                    : 'rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white'
              }
            >
              {notice.text}
            </div>
          ) : null}

          {error ? (
            <Card className="border-rose-500/25 bg-rose-500/10 p-4 text-sm text-rose-200">{error}</Card>
          ) : null}

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[360px_minmax(0,1fr)] xl:gap-6">
            <div className="space-y-4">
              <Card className="border-border bg-card p-4">
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Активные</div>
                    <div className="mt-2 text-2xl font-semibold text-white">{taskGroups.active.length}</div>
                  </div>
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-emerald-300/70">Готово</div>
                    <div className="mt-2 text-2xl font-semibold text-emerald-300">{taskGroups.done.length}</div>
                  </div>
                  <div className="rounded-xl border border-white/8 bg-white/[0.03] px-3 py-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">Архив</div>
                    <div className="mt-2 text-2xl font-semibold text-white">{taskGroups.archived.length}</div>
                  </div>
                </div>
              </Card>

              <Card className="border-border bg-card p-4">
                <div className="mb-3 text-sm font-semibold text-white">Список задач</div>
                <div className="space-y-3">
                  {tasks.map((task) => (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => setSelectedTaskId(task.id)}
                      className={`w-full rounded-[1.25rem] border px-4 py-4 text-left transition-colors ${
                        selectedTask?.id === task.id
                          ? 'border-[#ffd27b]/20 bg-[#ffd27b]/10'
                          : 'border-white/8 bg-white/[0.02] hover:bg-white/[0.04]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white">#{task.task_number} {task.title}</div>
                          <div className="mt-1 text-xs text-slate-400">
                            {STATUS_LABELS[task.status]} • {task.company_name || 'Без компании'}
                          </div>
                        </div>
                        {task.status === 'done' ? (
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-300" />
                        ) : (
                          <Clock3 className="h-4 w-4 shrink-0 text-slate-500" />
                        )}
                      </div>
                      <div className="mt-3 text-xs text-slate-500">Дедлайн: {formatDate(task.due_date)}</div>
                    </button>
                  ))}

                  {!loading && tasks.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/10 px-4 py-8 text-center text-sm text-slate-500">
                      У вас пока нет задач.
                    </div>
                  ) : null}
                </div>
              </Card>
            </div>

            <Card className="border-border bg-card p-4 sm:p-5">
              {loading && !selectedTask ? (
                <div className="flex items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Загрузка задач...
                </div>
              ) : selectedTask ? (
                <div className="space-y-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="text-xs uppercase tracking-[0.18em] text-slate-500">Задача #{selectedTask.task_number}</div>
                      <h2 className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-white">{selectedTask.title}</h2>
                      <p className="mt-2 text-sm text-slate-400">
                        {selectedTask.company_name || 'Без компании'} • Дедлайн: {formatDate(selectedTask.due_date)}
                      </p>
                    </div>
                    <div className="rounded-full border border-white/8 bg-white/[0.04] px-3 py-1 text-xs text-slate-300">
                      {STATUS_LABELS[selectedTask.status]}
                    </div>
                  </div>

                  <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.025] p-4 text-sm leading-6 text-slate-200">
                    {selectedTask.description?.trim() || 'Описание задачи пока не заполнено.'}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    {(['accept', 'need_info', 'blocked', 'already_done', 'complete'] as TaskResponse[]).map((responseType) => (
                      <Button
                        key={responseType}
                        variant="outline"
                        onClick={() => handleResponse(responseType)}
                        disabled={submitting !== null}
                        className="h-auto min-h-[64px] flex-col items-start justify-start gap-1 rounded-[1.2rem] px-4 py-3 text-left"
                      >
                        {submitting === responseType ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                        <span>{RESPONSE_CONFIG[responseType].label}</span>
                        <span className="text-[11px] text-slate-500">{STATUS_LABELS[RESPONSE_CONFIG[responseType].status]}</span>
                      </Button>
                    ))}
                  </div>

                  <div className="rounded-[1.4rem] border border-white/8 bg-white/[0.025] p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-white">
                      <MessageSquare className="h-4 w-4 text-[#ffd27b]" />
                      Комментарии
                    </div>

                    <div className="space-y-3">
                      {taskComments.map((comment) => (
                        <div key={comment.id} className="rounded-xl border border-white/8 bg-black/10 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-medium text-white">{comment.author_name}</div>
                            <div className="text-xs text-slate-500">{formatDateTime(comment.created_at)}</div>
                          </div>
                          <div className="mt-2 text-sm leading-6 text-slate-300">{comment.content}</div>
                        </div>
                      ))}

                      {taskComments.length === 0 ? (
                        <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-center text-sm text-slate-500">
                          Пока нет комментариев по задаче.
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-4 flex flex-col gap-3 md:flex-row">
                      <textarea
                        value={commentText}
                        onChange={(e) => setCommentText(e.target.value)}
                        rows={3}
                        placeholder="Напишите комментарий или уточнение по задаче"
                        className="min-h-[96px] flex-1 rounded-[1.1rem] border border-white/8 bg-black/10 px-4 py-3 text-sm text-white outline-none transition-colors placeholder:text-slate-500 focus:border-[#ffd27b]/25"
                      />
                      <Button onClick={handleComment} disabled={commenting || !commentText.trim()} className="w-full gap-2 self-start md:w-auto">
                        {commenting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        Отправить
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-12 text-center text-sm text-slate-500">
                  Выберите задачу слева.
                </div>
              )}
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
