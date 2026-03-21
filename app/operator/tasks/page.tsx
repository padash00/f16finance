'use client'

import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Clock3, Loader2, MessageSquare, RefreshCw, Send, SquareKanban } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatRuDate } from '@/lib/core/date'

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
  company_name: string | null
  company_code: string | null
  updated_at: string
}
type Comment = {
  id: string
  task_id: string
  content: string
  created_at: string
  author_name: string
  author_type: 'operator' | 'staff'
}
type TasksData = {
  operator: { id: string; name: string; short_name: string | null }
  tasks: Task[]
  comments: Comment[]
}

const responseButtons: Array<{ action: TaskResponse; label: string }> = [
  { action: 'accept', label: 'В работу' },
  { action: 'complete', label: 'Готово' },
  { action: 'need_info', label: 'Нужны детали' },
]

function statusLabel(status: TaskStatus) {
  switch (status) {
    case 'backlog':
      return 'Бэклог'
    case 'todo':
      return 'К выполнению'
    case 'in_progress':
      return 'В работе'
    case 'review':
      return 'На проверке'
    case 'done':
      return 'Готово'
    case 'archived':
      return 'Архив'
    default:
      return status
  }
}

export default function OperatorTasksMobilePage() {
  const [data, setData] = useState<TasksData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [actionLoading, setActionLoading] = useState<string | null>(null)

  const load = async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      const response = await fetch('/api/operator/tasks', { cache: 'no-store' })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка загрузки (${response.status})`)
      setData(json)
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Не удалось загрузить задачи')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const activeTasks = useMemo(
    () => (data?.tasks || []).filter((task) => ['backlog', 'todo', 'in_progress', 'review'].includes(task.status)),
    [data?.tasks],
  )

  const completedTasks = useMemo(() => (data?.tasks || []).filter((task) => task.status === 'done'), [data?.tasks])

  const submitResponse = async (taskId: string, responseType: TaskResponse) => {
    setActionLoading(`${taskId}:${responseType}`)
    setNotice(null)
    try {
      const response = await fetch('/api/operator/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'respondTask',
          taskId,
          response: responseType,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка действия (${response.status})`)
      setNotice('Статус задачи обновлён.')
      await load(true)
    } catch (err: any) {
      setError(err?.message || 'Не удалось обновить задачу')
    } finally {
      setActionLoading(null)
    }
  }

  const submitComment = async (event: FormEvent, taskId: string) => {
    event.preventDefault()
    const content = (commentDrafts[taskId] || '').trim()
    if (!content) return
    setActionLoading(`${taskId}:comment`)
    setNotice(null)
    try {
      const response = await fetch('/api/operator/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'addComment',
          taskId,
          content,
        }),
      })
      const json = await response.json().catch(() => null)
      if (!response.ok) throw new Error(json?.error || `Ошибка комментария (${response.status})`)
      setCommentDrafts((prev) => ({ ...prev, [taskId]: '' }))
      setNotice('Комментарий отправлен.')
      await load(true)
    } catch (err: any) {
      setError(err?.message || 'Не удалось отправить комментарий')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="space-y-4">
      <Card className="border-white/10 bg-white/[0.045] p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-slate-400">Рабочие задачи</div>
            <div className="mt-1 text-xl font-semibold text-white">Что нужно сделать сегодня</div>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Здесь собраны ваши активные задачи. Можно сразу взять задачу в работу, завершить её или написать комментарий руководителю.
            </p>
          </div>
          <div className="rounded-2xl bg-violet-500/15 p-3 text-violet-300">
            <SquareKanban className="h-6 w-6" />
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <Button type="button" variant="outline" className="border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Обновить
          </Button>
        </div>
      </Card>

      {error ? <Card className="border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">{error}</Card> : null}
      {notice ? <Card className="border-emerald-500/25 bg-emerald-500/10 p-4 text-sm text-emerald-200">{notice}</Card> : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-white/10 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.16em] text-slate-500">Активные</div><div className="mt-2 text-2xl font-semibold text-white">{activeTasks.length}</div></Card>
        <Card className="border-white/10 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.16em] text-slate-500">На проверке</div><div className="mt-2 text-2xl font-semibold text-white">{activeTasks.filter((task) => task.status === 'review').length}</div></Card>
        <Card className="border-white/10 bg-white/[0.045] p-4"><div className="text-xs uppercase tracking-[0.16em] text-slate-500">Завершены</div><div className="mt-2 text-2xl font-semibold text-white">{completedTasks.length}</div></Card>
      </div>

      {loading ? (
        <Card className="border-white/10 bg-white/[0.045] p-6 text-slate-300">
          <div className="flex items-center gap-3 text-sm">
            <Loader2 className="h-5 w-5 animate-spin" />
            Загружаю задачи...
          </div>
        </Card>
      ) : null}

      {!loading && activeTasks.length === 0 ? (
        <Card className="border-white/10 bg-white/[0.045] p-6 text-sm text-slate-300">
          Сейчас активных задач нет. Когда руководитель назначит новую задачу, она появится здесь.
        </Card>
      ) : null}

      {!loading && activeTasks.map((task) => {
        const isOpen = expandedId === task.id
        const comments = (data?.comments || []).filter((comment) => comment.task_id === task.id)
        return (
          <Card key={task.id} className="border-white/10 bg-white/[0.045] p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-[0.16em] text-slate-500">Задача #{task.task_number}</div>
                <div className="mt-2 text-lg font-semibold text-white">{task.title}</div>
                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400">
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{statusLabel(task.status)}</span>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{task.priority}</span>
                  {task.company_name ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">{task.company_name}</span> : null}
                  {task.due_date ? <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1">до {formatRuDate(task.due_date, 'full')}</span> : null}
                </div>
              </div>
              <Button type="button" variant="ghost" className="text-slate-300 hover:text-white" onClick={() => setExpandedId(isOpen ? null : task.id)}>
                <MessageSquare className="h-4 w-4" />
                {isOpen ? 'Скрыть' : 'Открыть'}
              </Button>
            </div>

            {task.description ? <p className="mt-4 text-sm leading-6 text-slate-300">{task.description}</p> : null}

            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {responseButtons.map((item) => (
                <Button
                  key={item.action}
                  type="button"
                  variant={item.action === 'complete' ? 'default' : 'outline'}
                  className={item.action === 'complete' ? '' : 'border-white/10 bg-white/[0.03] text-white hover:bg-white/[0.08]'}
                  disabled={!!actionLoading}
                  onClick={() => void submitResponse(task.id, item.action)}
                >
                  {actionLoading === `${task.id}:${item.action}` ? <Loader2 className="h-4 w-4 animate-spin" /> : item.action === 'complete' ? <CheckCircle2 className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  {item.label}
                </Button>
              ))}
            </div>

            {isOpen ? (
              <div className="mt-4 space-y-4 rounded-[1.5rem] border border-white/10 bg-slate-950/40 p-4">
                <div>
                  <div className="text-sm font-medium text-white">Комментарии</div>
                  <div className="mt-3 space-y-3">
                    {comments.length === 0 ? <div className="text-sm text-slate-400">Пока комментариев нет.</div> : null}
                    {comments.map((comment) => (
                      <div key={comment.id} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
                        <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                          <span>{comment.author_name}</span>
                          <span>{new Date(comment.created_at).toLocaleString('ru-RU')}</span>
                        </div>
                        <div className="mt-2 text-sm text-slate-200">{comment.content}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <form onSubmit={(event) => void submitComment(event, task.id)} className="space-y-3">
                  <textarea
                    value={commentDrafts[task.id] || ''}
                    onChange={(event) => setCommentDrafts((prev) => ({ ...prev, [task.id]: event.target.value }))}
                    className="min-h-[96px] w-full rounded-[1.2rem] border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-400/40 focus:outline-none"
                    placeholder="Напишите комментарий по задаче"
                  />
                  <Button type="submit" disabled={!commentDrafts[task.id]?.trim() || !!actionLoading}>
                    {actionLoading === `${task.id}:comment` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Отправить комментарий
                  </Button>
                </form>
              </div>
            ) : null}
          </Card>
        )
      })}

      {!loading && completedTasks.length > 0 ? (
        <Card className="border-white/10 bg-white/[0.045] p-5">
          <div className="text-lg font-semibold text-white">Недавно завершено</div>
          <div className="mt-4 space-y-3">
            {completedTasks.slice(0, 5).map((task) => (
              <div key={task.id} className="rounded-2xl border border-white/10 bg-slate-950/40 p-4">
                <div className="text-sm font-medium text-white">{task.title}</div>
                <div className="mt-1 text-xs text-slate-400">Обновлено: {new Date(task.updated_at).toLocaleString('ru-RU')}</div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  )
}
